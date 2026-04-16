/**
 * OpenAI / Codex usage provider
 *
 * ChatGPT auth usage endpoint: https://chatgpt.com/backend-api/wham/usage
 * OpenAI API key mode does not expose the same subscription usage windows.
 */

import type { UsageCard, UsageProviderDefinition } from "../types.ts";
import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import { formatRelativeTime } from "../utils/format.ts";

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_PROVIDER_NAME = "OpenAI/Codex";

interface OpenAIChatGPTAuth {
  mode: "chatgpt";
  accessToken: string;
  accountId?: string;
}

interface OpenAIApiKeyAuth {
  mode: "api";
  apiKey: string;
}

type OpenAIAuth = OpenAIChatGPTAuth | OpenAIApiKeyAuth;

interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

interface RateLimitBlock {
  primary_window?: RateLimitWindow;
  secondary_window?: RateLimitWindow;
  [key: string]: RateLimitWindow | boolean | undefined;
}

interface AdditionalRateLimit {
  metered_feature?: string;
  limit_name?: string;
  rate_limit?: RateLimitBlock;
}

interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: RateLimitBlock;
  code_review_rate_limit?: RateLimitBlock;
  additional_rate_limits?: AdditionalRateLimit[];
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string;
  };
}

async function fetchOpenAIUsage(auth: OpenAIAuth): Promise<UsageCard[]> {
  if (auth.mode === "api") {
    return [
      {
        providerId: openAIProvider.id,
        provider: OPENAI_PROVIDER_NAME,
        planType: "API key",
        windows: [],
        extra: {
          Auth: "Manual API key",
          Usage: "Subscription usage is only available with ChatGPT login",
          Endpoint: "Skipped in API key mode",
        },
      },
    ];
  }

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (auth.accountId) {
      headers["ChatGPT-Account-Id"] = auth.accountId;
    }

    const response = await fetch(CODEX_USAGE_ENDPOINT, {
      method: "GET",
      headers,
    });

    if (response.status === 401) {
      return [
        {
          providerId: openAIProvider.id,
          provider: OPENAI_PROVIDER_NAME,
          windows: [],
          error: "Token expired or invalid",
        },
      ];
    }

    if (response.status === 403) {
      return [
        {
          providerId: openAIProvider.id,
          provider: OPENAI_PROVIDER_NAME,
          windows: [],
          error: "Access denied (account ID may be required)",
        },
      ];
    }

    if (!response.ok) {
      return [
        {
          providerId: openAIProvider.id,
          provider: OPENAI_PROVIDER_NAME,
          windows: [],
          error: `HTTP ${response.status}`,
        },
      ];
    }

    const data = (await response.json()) as CodexUsageResponse;
    const planType = formatPlanType(data.plan_type);
    const usageCards: UsageCard[] = [];
    const seenProviders = new Set<string>();

    const primaryCard = buildRateLimitCard({
      provider: OPENAI_PROVIDER_NAME,
      planType,
      rateLimit: data.rate_limit,
      credits: data.credits,
      includePlanTypeOnly: true,
    });
    pushUniqueCard(usageCards, seenProviders, primaryCard);

    const codeReviewCard = buildRateLimitCard({
      provider: `${OPENAI_PROVIDER_NAME} - Code review`,
      planType,
      rateLimit: data.code_review_rate_limit,
    });
    pushUniqueCard(usageCards, seenProviders, codeReviewCard);

    for (const additionalLimit of data.additional_rate_limits ?? []) {
      const provider = getAdditionalLimitProviderName(additionalLimit);
      const additionalCard = buildRateLimitCard({
        provider,
        planType,
        rateLimit: additionalLimit.rate_limit,
      });
      pushUniqueCard(usageCards, seenProviders, additionalCard);
    }

    if (usageCards.length > 0) {
      return usageCards;
    }

    return [
      {
        providerId: openAIProvider.id,
        provider: OPENAI_PROVIDER_NAME,
        planType,
        windows: [],
      },
    ];
  } catch (error) {
    return [
      {
        providerId: openAIProvider.id,
        provider: OPENAI_PROVIDER_NAME,
        windows: [],
        error: error instanceof Error ? error.message : "Unknown error",
      },
    ];
  }
}

function buildRateLimitCard(input: {
  provider: string;
  planType?: string;
  rateLimit?: RateLimitBlock;
  credits?: CodexUsageResponse["credits"];
  includePlanTypeOnly?: boolean;
}): UsageCard | null {
  const windows = collectWindows(input.rateLimit);
  const extra = buildCreditsExtra(input.credits);

  if (windows.length === 0 && !extra && !input.includePlanTypeOnly) {
    return null;
  }

  if (!input.planType && windows.length === 0 && !extra) {
    return null;
  }

  return {
    providerId: openAIProvider.id,
    provider: input.provider,
    planType: input.planType,
    windows,
    extra,
  };
}

function collectWindows(rateLimit?: RateLimitBlock): UsageCard["windows"] {
  if (!rateLimit) {
    return [];
  }

  const windows: UsageCard["windows"] = [];
  const primaryWindow = rateLimit.primary_window;
  const secondaryWindow = rateLimit.secondary_window;

  if (primaryWindow) {
    windows.push(toUsageWindow("primary_window", primaryWindow));
  }

  if (secondaryWindow) {
    windows.push(toUsageWindow("secondary_window", secondaryWindow));
  }

  if (windows.length > 0) {
    return windows;
  }

  for (const [key, value] of Object.entries(rateLimit)) {
    if (key === "primary_window" || key === "secondary_window") {
      continue;
    }

    if (isRateLimitWindow(value)) {
      windows.push(toUsageWindow(key, value));
    }
  }

  return windows;
}

function toUsageWindow(key: string, window: RateLimitWindow) {
  const resetDate = getResetTime(window);
  return {
    label: getWindowLabel(key, window),
    usedPercent: window.used_percent,
    resetTime: resetDate ? formatRelativeTime(resetDate) : undefined,
    source: "endpoint" as const,
    rawResetAt: resetDate?.toISOString(),
  };
}

function buildCreditsExtra(credits?: CodexUsageResponse["credits"]): Record<string, string> | undefined {
  if (!credits) {
    return undefined;
  }

  const extra: Record<string, string> = {};

  if (credits.unlimited) {
    extra["Credits remaining"] = "Unlimited";
  } else if (typeof credits.balance === "string") {
    extra["Credits remaining"] = credits.balance;
  }

  return Object.keys(extra).length > 0 ? extra : undefined;
}

function pushUniqueCard(results: UsageCard[], seenProviders: Set<string>, card: UsageCard | null): void {
  if (!card || seenProviders.has(card.provider)) {
    return;
  }

  seenProviders.add(card.provider);
  results.push(card);
}

function getAdditionalLimitProviderName(limit: AdditionalRateLimit): string {
  const rawName = limit.limit_name || limit.metered_feature || "additional_limit";
  return `${OPENAI_PROVIDER_NAME} - ${humanizeAdditionalLimitName(rawName)}`;
}

function getWindowLabel(key: string, window: RateLimitWindow): string {
  if (window.limit_window_seconds) {
    const hours = window.limit_window_seconds / 3600;
    if (hours <= 24) {
      return `${Math.round(hours)}h`;
    }

    const days = hours / 24;
    if (days === 7) {
      return "Weekly";
    }

    return `${Math.round(days)}d`;
  }

  if (key === "primary_window") return "5h";
  if (key === "secondary_window") return "Weekly";

  return humanizeLabel(key) || "Usage";
}

function getResetTime(window: RateLimitWindow): Date | null {
  const now = new Date();

  if (window.reset_after_seconds) {
    return new Date(now.getTime() + window.reset_after_seconds * 1000);
  }

  if (window.reset_at) {
    const timestamp = window.reset_at > 2_000_000_000_000 ? window.reset_at : window.reset_at * 1000;
    return new Date(timestamp);
  }

  return null;
}

function formatPlanType(planType?: string): string | undefined {
  if (!planType) {
    return undefined;
  }

  const normalized = planType.trim().toLowerCase();

  switch (normalized) {
    case "prolite":
      return "Pro 5x";
    case "pro":
      return "Pro 20x";
    default:
      return humanizeLabel(normalized);
  }
}

function humanizeLabel(value: string): string {
  return value
    .replace(/^codex[_\s-]*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeAdditionalLimitName(value: string): string {
  const normalized = value.trim();

  if (/[\s_-]spark$/i.test(normalized) || /^gpt[-_.]?\d/i.test(normalized)) {
    return normalized
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => {
        if (/^gpt$/i.test(part)) return "GPT";
        if (/^codex$/i.test(part)) return "Codex";
        if (/^spark$/i.test(part)) return "Spark";
        if (/^[0-9]+(?:\.[0-9]+)*$/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(" ");
  }

  return humanizeLabel(normalized);
}

function isRateLimitWindow(value: unknown): value is RateLimitWindow {
  return Boolean(
    value &&
      typeof value === "object" &&
      "used_percent" in value &&
      typeof (value as { used_percent?: unknown }).used_percent === "number",
  );
}

function normalizeAuthType(type?: string): string | undefined {
  const normalized = type?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function getStringValue(provider: RawAuthJsonProvider | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = provider?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function resolveOpenAIAuth(rawAuth: RawAuthJson): OpenAIAuth | undefined {
  const openai = rawAuth["openai"] ?? rawAuth["chatgpt"];
  if (!openai) {
    return undefined;
  }

  const authType = normalizeAuthType(typeof openai.type === "string" ? openai.type : undefined);
  const accessToken = getStringValue(openai, "access", "accessToken", "token");
  const apiKey = getStringValue(openai, "key");
  const accountId = getStringValue(openai, "accountId");

  if (authType === "api" && apiKey) {
    return { mode: "api", apiKey };
  }

  if (accessToken) {
    return {
      mode: "chatgpt",
      accessToken,
      accountId,
    };
  }

  if (apiKey) {
    return { mode: "api", apiKey };
  }

  return undefined;
}

export const openAIProvider = {
  id: "openai",
  label: OPENAI_PROVIDER_NAME,
  commandTitle: "Usage OpenAI",
  order: 10,
  resolveAuth: resolveOpenAIAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveOpenAIAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchOpenAIUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
