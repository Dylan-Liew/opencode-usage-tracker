import { afterEach, expect, mock, test } from "bun:test";

import type { UsageCard } from "../types.ts";
import type { RawAuthJson } from "../utils/auth.ts";
import { zaiProvider } from "./zai.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

interface FetchCall {
  url: string;
  init: RequestInit;
}

function stubFetch(body: unknown, status = 200): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = mock(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return calls;
}

function mainCard(cards: UsageCard[]): UsageCard {
  const card = cards.find((candidate) => candidate.providerId === "zai");
  if (!card) {
    throw new Error("No Z.AI usage card found");
  }
  return card;
}

const LIVE_RESPONSE_SHAPE = {
  code: 200,
  msg: "Operation successful",
  data: {
    limits: [
      {
        type: "CREDIT_LIMIT",
        unit: 3,
        number: 5,
        usage: 28_000,
        currentValue: 0,
        remaining: 28_000,
        percentage: 0,
      },
      {
        type: "CREDIT_LIMIT",
        unit: 6,
        number: 1,
        usage: 140_000,
        currentValue: 4_652,
        remaining: 135_347,
        percentage: 3,
        nextResetTime: 1_788_349_029_978,
      },
    ],
    level: "max",
  },
  success: true,
};

test("request uses the documented Z.AI endpoint and Bearer authentication", async () => {
  const calls = stubFetch(LIVE_RESPONSE_SHAPE);
  const rawAuth: RawAuthJson = { "zai-coding-plan": { type: "api", key: "zai-key" } };

  await zaiProvider.fetchFromRawAuth(rawAuth);

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://api.z.ai/api/monitor/usage/quota/limit");
  expect(calls[0]!.init.method).toBe("GET");
  expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer zai-key");
  expect(new Headers(calls[0]!.init.headers).get("Accept")).toBe("application/json");
});

test("maps current CREDIT_LIMIT payload into session and weekly windows", async () => {
  stubFetch(LIVE_RESPONSE_SHAPE);
  const rawAuth: RawAuthJson = { "zai-coding-plan": { key: "zai-key" } };

  const card = mainCard(await zaiProvider.fetchFromRawAuth(rawAuth));
  const session = card.windows.find((window) => window.label === "5h");
  const weekly = card.windows.find((window) => window.label === "Weekly");

  expect(card.error).toBeUndefined();
  expect(card.planType).toBe("Max");
  expect(session?.usedPercent).toBe(0);
  expect(weekly?.usedPercent).toBe(3);
  expect(weekly?.rawResetAt).toBe(new Date(1_788_349_029_978).toISOString());
  expect(card.extra).toBeUndefined();
});

test("already-prefixed Bearer tokens are not prefixed twice", async () => {
  const calls = stubFetch(LIVE_RESPONSE_SHAPE);
  const rawAuth: RawAuthJson = { zai: { accessToken: "Bearer existing-token" } };

  await zaiProvider.fetchFromRawAuth(rawAuth);

  expect(calls).toHaveLength(1);
  expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe("Bearer existing-token");
});

test("maps authentication failures to a provider error", async () => {
  stubFetch({}, 401);
  const rawAuth: RawAuthJson = { "z-ai": { token: "bad-token" } };

  const card = mainCard(await zaiProvider.fetchFromRawAuth(rawAuth));

  expect(card.error).toBe("API key invalid");
  expect(card.windows).toHaveLength(0);
});
