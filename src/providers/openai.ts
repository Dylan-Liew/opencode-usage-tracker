/**
 * OpenAI / Codex usage provider
 *
 * ChatGPT auth usage endpoint: https://chatgpt.com/backend-api/wham/usage
 * OpenAI API key mode does not expose the same subscription usage windows.
 */

import type { UsageCard, UsageProviderDefinition } from "../types.ts";
import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import { fetchJsonResponseWithTimeout, getFetchErrorMessage } from "../utils/http.ts";
import { formatRelativeTime } from "../utils/format.ts";

const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const OPENAI_PROVIDER_NAME = "OpenAI/Codex";
const OPENAI_USAGE_TIMEOUT_MS = 5000;

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

type OpenAILimitCard = {
  order: number;
  card: UsageCard | null;
};

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

    const { response, data } = await fetchJsonResponseWithTimeout<CodexUsageResponse>(
      CODEX_USAGE_ENDPOINT,
      {
        method: "GET",
        headers,
      },
      OPENAI_USAGE_TIMEOUT_MS,
    );

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

    if (!data) {
      return [
        {
          providerId: openAIProvider.id,
          provider: OPENAI_PROVIDER_NAME,
          windows: [],
          error: "Usage response was empty",
        },
      ];
    }

    const planType = formatPlanType(data.plan_type);
    const usageCards: OpenAILimitCard[] = [];
    const seenProviders = new Set<string>();

    const primaryCard = buildRateLimitCard({
      provider: `${OPENAI_PROVIDER_NAME} - Primary quota`,
      description: "Main OpenAI/Codex quota.",
      planType,
      rateLimit: data.rate_limit,
    });
    pushUniqueCard(usageCards, seenProviders, 10, primaryCard);

    const codeReviewCard = buildRateLimitCard({
      provider: `${OPENAI_PROVIDER_NAME} - Code review`,
      description: "Separate code review quota.",
      planType,
      rateLimit: data.code_review_rate_limit,
    });
    pushUniqueCard(usageCards, seenProviders, 30, codeReviewCard);

    for (const [index, additionalLimit] of (data.additional_rate_limits ?? []).entries()) {
      const meta = getAdditionalLimitCardMeta(additionalLimit);
      const additionalCard = buildRateLimitCard({
        provider: meta.provider,
        description: meta.description,
        planType,
        rateLimit: additionalLimit.rate_limit,
      });
      pushUniqueCard(usageCards, seenProviders, meta.order ?? 40 + index, additionalCard);
    }

    const creditsCard = buildCreditsCard(data.credits, planType);
    pushUniqueCard(usageCards, seenProviders, 90, creditsCard);

    if (usageCards.length > 0) {
      return usageCards
        .sort((left, right) => left.order - right.order)
        .map((entry) => entry.card)
        .filter(isUsageCard);
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
        error: getFetchErrorMessage(error),
      },
    ];
  }
}

function buildRateLimitCard(input: {
  provider: string;
  description?: string;
  planType?: string;
  rateLimit?: RateLimitBlock;
}): UsageCard | null {
  const windows = collectWindows(input.rateLimit);

  if (windows.length === 0) {
    return null;
  }

  return {
    providerId: openAIProvider.id,
    provider: input.provider,
    description: input.description,
    planType: input.planType,
    windows,
  };
}

function buildCreditsCard(credits?: CodexUsageResponse["credits"], planType?: string): UsageCard | null {
  if (!credits) {
    return null;
  }

  const extra: Record<string, string> = {};
  if (credits.unlimited) {
    extra.Remaining = "Unlimited";
  } else if (typeof credits.balance === "string") {
    extra.Remaining = credits.balance;
  }

  if (Object.keys(extra).length === 0) {
    return null;
  }

  return {
    providerId: openAIProvider.id,
    provider: `${OPENAI_PROVIDER_NAME} - Credits`,
    description: "Credits can be used beyond your included plan quota.",
    planType,
    windows: [],
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

function pushUniqueCard(results: OpenAILimitCard[], seenProviders: Set<string>, order: number, card: UsageCard | null): void {
  if (!card || seenProviders.has(card.provider)) {
    return;
  }

  seenProviders.add(card.provider);
  results.push({ order, card });
}

function getAdditionalLimitCardMeta(limit: AdditionalRateLimit): {
  provider: string;
  description?: string;
  order?: number;
} {
  const rawName = limit.limit_name || limit.metered_feature || "additional_limit";
  const humanizedName = humanizeAdditionalLimitName(rawName);

  if (isSparkLimitName(rawName)) {
    return {
      provider: `${OPENAI_PROVIDER_NAME} - ${humanizedName}`,
      description: "Separate Spark quota.",
      order: 20,
    };
  }

  return {
    provider: `${OPENAI_PROVIDER_NAME} - ${humanizedName}`,
  };
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

function isSparkLimitName(value: string): boolean {
  return /(^|[\s_-])spark$/i.test(value.trim()) || /codex[\s_-]*spark/i.test(value);
}

function isUsageCard(value: UsageCard | null): value is UsageCard {
  return value !== null;
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
