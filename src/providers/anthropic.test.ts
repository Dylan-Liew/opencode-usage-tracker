import { test, expect, mock, afterEach } from "bun:test";

import { anthropicProvider, normalizeUtilization } from "./anthropic.ts";
import type { RawAuthJson } from "../utils/auth.ts";
import type { UsageCard } from "../types.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface FetchCall {
  url: string;
  init: RequestInit;
}

/**
 * Replace global fetch with a stub that records calls and returns a canned
 * Response. The shared http helper calls `response.text()` then JSON.parse,
 * so we serialize the body unless the status implies an empty body.
 */
function stubFetch(body: unknown, status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = mock(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(status === 204 ? "" : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function headersFrom(init: RequestInit): Headers {
  return new Headers(init.headers as HeadersInit);
}

function mainCard(cards: UsageCard[]): UsageCard {
  const card = cards.find((c) => c.providerId === "anthropic" || c.provider === "Anthropic");
  if (!card) {
    throw new Error("No Anthropic main card found");
  }
  return card;
}

// Minimal valid usage body that produces at least one window so the provider
// does not fall back to the "no parseable windows" error path.
const MINIMAL_BODY = {
  five_hour: { utilization: 0.1, resets_at: null },
};

test("OAuth request contract: url, method, no body, exact headers", async () => {
  const calls = stubFetch(MINIMAL_BODY);
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  await anthropicProvider.fetchFromRawAuth(rawAuth);

  expect(calls.length).toBe(1);
  const { url, init } = calls[0]!;

  expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
  expect(init.method).toBe("GET");
  expect(init.body == null).toBe(true);

  const headers = headersFrom(init);
  expect(headers.get("Authorization")).toBe("Bearer oauth-tok");
  expect(headers.get("Accept")).toBe("application/json, text/plain, */*");
  expect(headers.get("Content-Type")).toBe("application/json");
  expect(headers.get("User-Agent")).toBe("claude-cli/2.1.154 (external, cli)");
  expect(headers.get("anthropic-beta")).toBe("oauth-2025-04-20");

  // No anthropic-version header should be set.
  expect(headers.get("anthropic-version")).toBeNull();
});

test("OAuth token precedence: OAuth in later alias beats API key in earlier alias", async () => {
  const calls = stubFetch(MINIMAL_BODY);
  const rawAuth: RawAuthJson = {
    anthropic: { key: "api-xxx" },
    claude: { access_token: "claude-oauth" },
  };

  await anthropicProvider.fetchFromRawAuth(rawAuth);

  expect(calls.length).toBe(1);
  const auth = headersFrom(calls[0]!.init).get("Authorization");
  expect(auth).toBe("Bearer claude-oauth");
  // The API key string must never leak into the Authorization header.
  expect(auth).not.toContain("api-xxx");
});

test("Response mapping: known buckets become windows, null buckets are skipped", async () => {
  stubFetch({
    five_hour: { utilization: 0.42, resets_at: null },
    seven_day: { utilization: 80, resets_at: null },
    seven_day_opus: null,
  });
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  const cards = await anthropicProvider.fetchFromRawAuth(rawAuth);
  const card = mainCard(cards);

  expect(card.error).toBeUndefined();

  const session = card.windows.find((w) => w.label === "5h");
  const weekly = card.windows.find((w) => w.label === "Weekly");
  const opus = card.windows.find((w) => w.label === "Opus Weekly");

  expect(session?.usedPercent).toBe(42);
  expect(weekly?.usedPercent).toBe(80);
  // Null bucket produces no window.
  expect(opus).toBeUndefined();
});

test("extra_usage (enabled with limit): rendered as a usage bar plus amount row", async () => {
  stubFetch({
    five_hour: { utilization: 0.1, resets_at: null },
    extra_usage: {
      is_enabled: true,
      monthly_limit: 2000,
      used_credits: 500,
      currency: "USD",
      utilization: 0.5,
      disabled_reason: null,
    },
  });
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  const cards = await anthropicProvider.fetchFromRawAuth(rawAuth);
  const card = mainCard(cards);

  expect(card.error).toBeUndefined();

  // Bar: used (500c) / limit (2000c) = 25%, amounts in major units.
  const bar = card.windows.find((w) => w.label === "Extra Usage");
  expect(bar).toBeDefined();
  expect(bar?.usedPercent).toBe(25);
  expect(bar?.used).toBe(5);
  expect(bar?.limit).toBe(20);
  expect(bar?.unit).toBe("USD");

  // Amount row gives the dollar figures the bar can't show.
  expect(card.extra?.["Extra Usage"]).toBe("5.00 / 20.00 USD");
  expect(card.extra?.["Disabled Reason"]).toBeUndefined();
});

test("extra_usage (disabled): shown as a descriptive row, no bar", async () => {
  stubFetch({
    five_hour: { utilization: 0.1, resets_at: null },
    extra_usage: {
      is_enabled: false,
      monthly_limit: null,
      used_credits: null,
      currency: null,
      utilization: null,
      disabled_reason: null,
    },
  });
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  const cards = await anthropicProvider.fetchFromRawAuth(rawAuth);
  const card = mainCard(cards);

  expect(card.windows.find((w) => w.label === "Extra Usage")).toBeUndefined();
  expect(card.extra?.["Extra Usage"]).toBe("Disabled");
});

test("Error mapping: 401 expired/invalid", async () => {
  stubFetch({}, 401);
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  const card = mainCard(await anthropicProvider.fetchFromRawAuth(rawAuth));
  expect(card.error).toBe("OAuth token expired or invalid");
});

test("Error mapping: 403 access denied", async () => {
  stubFetch({}, 403);
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  const card = mainCard(await anthropicProvider.fetchFromRawAuth(rawAuth));
  expect(card.error).toBe("OAuth usage access denied");
});

test("Error mapping: 500 contains HTTP 500", async () => {
  stubFetch({}, 500);
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  const card = mainCard(await anthropicProvider.fetchFromRawAuth(rawAuth));
  expect(card.error).toContain("HTTP 500");
});

test("API-key-only mode: returns explanatory card and makes no fetch call", async () => {
  const calls = stubFetch(MINIMAL_BODY);
  const rawAuth: RawAuthJson = { anthropic: { key: "api-only" } };

  const cards = await anthropicProvider.fetchFromRawAuth(rawAuth);
  const card = mainCard(cards);

  // No network call in API key mode.
  expect(calls.length).toBe(0);
  expect(card.error).toBeUndefined();
  expect(card.planType).toBe("API key");
  expect(card.extra).toBeDefined();
  // Explanatory content indicates OAuth is required for usage.
  expect(JSON.stringify(card.extra)).toContain("OAuth");
});

test("normalizeUtilization: fractions, percents, bounds, and clamping", () => {
  expect(normalizeUtilization(0.42)).toBe(42);
  expect(normalizeUtilization(42)).toBe(42);
  expect(normalizeUtilization(1)).toBe(100);
  expect(normalizeUtilization(0)).toBe(0);
  expect(normalizeUtilization(150)).toBe(100);
});

test("Nested oauth.token precedence: nested OAuth beats API key in earlier alias", async () => {
  const calls = stubFetch(MINIMAL_BODY);
  const rawAuth: RawAuthJson = {
    anthropic: { key: "api-xxx" },
    claude: { oauth: { token: "nested-oauth" } },
  };

  const card = mainCard(await anthropicProvider.fetchFromRawAuth(rawAuth));

  // OAuth mode -> a fetch happened and it is not the API-key explanatory card.
  expect(calls.length).toBe(1);
  expect(card.planType).not.toBe("API key");

  const auth = headersFrom(calls[0]!.init).get("Authorization");
  expect(auth).toBe("Bearer nested-oauth");
  expect(auth).not.toContain("api-xxx");
});

test("Token redaction: thrown header error must not leak the raw token", async () => {
  const token = "secret\nleak";
  // Mirror Bun's header-validation throw, which embeds the offending
  // `Bearer <value>` in the error message, to exercise redactToken.
  globalThis.fetch = mock(async () => {
    throw new Error(`Header has invalid value: 'Bearer ${token}'`);
  }) as unknown as typeof fetch;

  const rawAuth: RawAuthJson = { anthropic: { access: token } };
  const card = mainCard(await anthropicProvider.fetchFromRawAuth(rawAuth));

  expect(typeof card.error).toBe("string");
  // The raw token (and the distinctive "secret" substring) must be scrubbed.
  expect(card.error).not.toContain("secret");
  expect(card.error).not.toContain(token);
  expect(card.error).toContain("[redacted]");
});

test("Exact header set: only the five app-controlled headers, no extras", async () => {
  const calls = stubFetch(MINIMAL_BODY);
  const rawAuth: RawAuthJson = { anthropic: { access: "oauth-tok" } };

  await anthropicProvider.fetchFromRawAuth(rawAuth);

  expect(calls.length).toBe(1);

  const sentKeys = Object.keys(calls[0]!.init.headers as Record<string, string>)
    .map((k) => k.toLowerCase())
    .sort();
  const expectedKeys = ["accept", "anthropic-beta", "authorization", "content-type", "user-agent"];

  expect(sentKeys).toEqual(expectedKeys);
  // Specifically, no anthropic-version header is added.
  expect(sentKeys).not.toContain("anthropic-version");
});
