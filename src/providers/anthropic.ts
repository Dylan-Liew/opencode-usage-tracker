/**
 * Anthropic usage provider (OAuth)
 *
 * OAuth usage endpoint: GET https://api.anthropic.com/api/oauth/usage
 * Anthropic API key mode does not expose the same subscription usage windows.
 */

import type { UsageCard, UsageProviderDefinition, UsageWindow } from "../types.ts";
import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import { fetchJsonResponseWithTimeout, getFetchErrorMessage } from "../utils/http.ts";
import { formatRelativeTime } from "../utils/format.ts";

const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const PROVIDER_LABEL = "Anthropic";
const PROVIDER_COMMAND_TITLE = "Usage Anthropic";
const USAGE_TIMEOUT_MS = 5000;
const ANTHROPIC_BETA = "oauth-2025-04-20";
const USER_AGENT = "claude-cli/2.1.154 (external, cli)";

interface AnthropicOAuthAuth {
  mode: "oauth";
  accessToken: string;
}

interface AnthropicApiKeyAuth {
  mode: "api";
}

type AnthropicAuth = AnthropicOAuthAuth | AnthropicApiKeyAuth;

interface AnthropicUsageBucket {
  utilization?: unknown;
  resets_at?: unknown;
}

interface AnthropicExtraUsage {
  is_enabled?: unknown;
  monthly_limit?: unknown;
  used_credits?: unknown;
  utilization?: unknown;
  currency?: unknown;
  disabled_reason?: unknown;
  [key: string]: unknown;
}

interface AnthropicUsageResponse {
  five_hour?: AnthropicUsageBucket;
  seven_day?: AnthropicUsageBucket;
  seven_day_oauth_apps?: AnthropicUsageBucket;
  seven_day_opus?: AnthropicUsageBucket;
  seven_day_sonnet?: AnthropicUsageBucket;
  seven_day_cowork?: AnthropicUsageBucket;
  seven_day_omelette?: AnthropicUsageBucket;
  tangelo?: AnthropicUsageBucket;
  iguana_necktie?: AnthropicUsageBucket;
  omelette_promotional?: AnthropicUsageBucket;
  extra_usage?: AnthropicExtraUsage;
  [key: string]: unknown;
}

const KNOWN_BUCKETS: ReadonlyArray<{ key: keyof AnthropicUsageResponse; label: string }> = [
  { key: "five_hour", label: "5h" },
  { key: "seven_day", label: "Weekly" },
  { key: "seven_day_oauth_apps", label: "OAuth Apps Weekly" },
  { key: "seven_day_opus", label: "Opus Weekly" },
  { key: "seven_day_sonnet", label: "Sonnet Weekly" },
  { key: "seven_day_cowork", label: "Cowork Weekly" },
  { key: "seven_day_omelette", label: "Omelette Weekly" },
  { key: "tangelo", label: "Tangelo" },
  { key: "iguana_necktie", label: "Iguana Necktie" },
  { key: "omelette_promotional", label: "Omelette Promotional" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize a utilization value to a 0..100 percentage.
 *
 * Values in (0, 1] are treated as fractions and scaled to percent. Values > 1
 * are treated as already being a percentage. The result is clamped to 0..100.
 * Exported for testing.
 */
export function normalizeUtilization(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  let percent = value;
  if (value > 0 && value <= 1) {
    percent = value * 100;
  }

  return Math.max(0, Math.min(100, percent));
}

function getStringValue(provider: RawAuthJsonProvider | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = provider?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function getNestedOAuthToken(provider: RawAuthJsonProvider | undefined): string | undefined {
  const oauth = provider?.["oauth"];
  if (!isRecord(oauth)) {
    return undefined;
  }

  return getStringValue(oauth as RawAuthJsonProvider, "access", "accessToken", "access_token", "token");
}

function getOAuthToken(provider: RawAuthJsonProvider | undefined): string | undefined {
  if (!provider) {
    return undefined;
  }

  return getStringValue(provider, "access", "accessToken", "access_token", "token") ?? getNestedOAuthToken(provider);
}

function getApiKey(provider: RawAuthJsonProvider | undefined): string | undefined {
  return getStringValue(provider, "key", "apiKey");
}

/**
 * Redact the bearer token from an error message.
 *
 * Bun can include the offending header value (`Bearer <token>`) in thrown error
 * messages, so any caught error string must be scrubbed before it is surfaced in
 * a usage card. Uses literal string replacement (not regex) to avoid issues with
 * special characters inside the token.
 */
function redactToken(message: string, token?: string): string {
  if (!token) {
    return message;
  }

  return message.split(`Bearer ${token}`).join("[redacted]").split(token).join("[redacted]");
}

function buildMainCard(input: {
  windows: UsageWindow[];
  planType?: string;
  extra?: Record<string, string>;
  error?: string;
}): UsageCard[] {
  return [
    {
      providerId: anthropicProvider.id,
      provider: PROVIDER_LABEL,
      sectionId: "main",
      sectionKind: "main",
      sectionOrder: 10,
      planType: input.planType,
      windows: input.windows,
      extra: input.extra,
      error: input.error,
    },
  ];
}

function parseResetAt(value: unknown): { resetTime?: string; rawResetAt?: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {};
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {};
  }

  return {
    resetTime: formatRelativeTime(date),
    rawResetAt: date.toISOString(),
  };
}

function buildUsageWindow(label: string, bucket: unknown): UsageWindow | undefined {
  if (!isRecord(bucket)) {
    return undefined;
  }

  const utilization = bucket.utilization;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) {
    return undefined;
  }

  const { resetTime, rawResetAt } = parseResetAt(bucket.resets_at);

  return {
    label,
    usedPercent: normalizeUtilization(utilization),
    resetTime,
    rawResetAt,
    source: "endpoint",
  };
}

function buildExtraUsageRows(extraUsage: unknown): Record<string, string> {
  const rows: Record<string, string> = {};

  if (!isRecord(extraUsage)) {
    return rows;
  }

  const currency = typeof extraUsage.currency === "string" && extraUsage.currency.trim().length > 0
    ? extraUsage.currency.trim()
    : undefined;
  const currencySuffix = currency ? ` ${currency}` : "";

  if (typeof extraUsage.is_enabled === "boolean") {
    rows["Extra Usage"] = extraUsage.is_enabled ? "Enabled" : "Disabled";
  }

  if (typeof extraUsage.monthly_limit === "number" && Number.isFinite(extraUsage.monthly_limit)) {
    rows["Monthly Limit"] = `${extraUsage.monthly_limit}${currencySuffix}`;
  }

  if (typeof extraUsage.used_credits === "number" && Number.isFinite(extraUsage.used_credits)) {
    rows["Used Credits"] = `${extraUsage.used_credits}${currencySuffix}`;
  }

  if (typeof extraUsage.utilization === "number" && Number.isFinite(extraUsage.utilization)) {
    rows["Extra Usage Used"] = `${normalizeUtilization(extraUsage.utilization)}%`;
  }

  if (typeof extraUsage.disabled_reason === "string" && extraUsage.disabled_reason.trim().length > 0) {
    rows["Disabled Reason"] = extraUsage.disabled_reason.trim();
  }

  return rows;
}

async function fetchAnthropicUsage(auth: AnthropicAuth): Promise<UsageCard[]> {
  if (auth.mode === "api") {
    return [
      {
        providerId: anthropicProvider.id,
        provider: PROVIDER_LABEL,
        sectionId: "main",
        sectionKind: "main",
        sectionOrder: 10,
        planType: "API key",
        windows: [],
        extra: {
          Auth: "Manual API key",
          Usage: "Subscription usage is only available with Claude OAuth login",
          Endpoint: "/api/oauth/usage is not available in API key mode",
        },
      },
    ];
  }

  try {
    const { response, data } = await fetchJsonResponseWithTimeout<AnthropicUsageResponse>(
      USAGE_ENDPOINT,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "anthropic-beta": ANTHROPIC_BETA,
        },
      },
      USAGE_TIMEOUT_MS,
    );

    if (response.status === 401) {
      return buildMainCard({ windows: [], error: "OAuth token expired or invalid" });
    }

    if (response.status === 403) {
      return buildMainCard({ windows: [], error: "OAuth usage access denied" });
    }

    if (!response.ok) {
      return buildMainCard({ windows: [], error: `HTTP ${response.status}` });
    }

    if (data === undefined) {
      return buildMainCard({ windows: [], error: "Usage response was empty" });
    }

    if (!isRecord(data)) {
      return buildMainCard({ windows: [], error: "Unexpected Anthropic response format" });
    }

    const windows: UsageWindow[] = [];
    for (const { key, label } of KNOWN_BUCKETS) {
      const usageWindow = buildUsageWindow(label, data[key]);
      if (usageWindow) {
        windows.push(usageWindow);
      }
    }

    const extra = buildExtraUsageRows(data.extra_usage);
    const hasExtra = Object.keys(extra).length > 0;

    if (windows.length === 0 && !hasExtra) {
      return buildMainCard({ windows: [], error: "No parseable Anthropic usage windows were returned" });
    }

    return buildMainCard({
      windows,
      extra: hasExtra ? extra : undefined,
    });
  } catch (error) {
    const message = redactToken(getFetchErrorMessage(error), auth.accessToken);
    return buildMainCard({ windows: [], error: message });
  }
}

function resolveAnthropicAuth(rawAuth: RawAuthJson): AnthropicAuth | undefined {
  const aliases = [rawAuth["anthropic"], rawAuth["claude"], rawAuth["claude-code"]];

  // Pass 1: OAuth access token wins across all aliases, in priority order.
  for (const alias of aliases) {
    const accessToken = getOAuthToken(alias);
    if (accessToken) {
      return { mode: "oauth", accessToken };
    }
  }

  // Pass 2: only mark as configured via API key when no OAuth token exists.
  for (const alias of aliases) {
    if (getApiKey(alias)) {
      return { mode: "api" };
    }
  }

  return undefined;
}

export const anthropicProvider = {
  id: "anthropic",
  label: PROVIDER_LABEL,
  commandTitle: PROVIDER_COMMAND_TITLE,
  order: 15,
  resolveAuth: resolveAnthropicAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveAnthropicAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchAnthropicUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
