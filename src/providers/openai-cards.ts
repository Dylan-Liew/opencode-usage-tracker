import type { UsageCard } from "../types.ts";
import { formatRelativeTime } from "../utils/format.ts";
import { formatPlanType, humanizeAdditionalLimitName, humanizeLabel, isSparkLimitName, normalizeSectionId } from "./openai-format.ts";
import { OPENAI_PROVIDER_ID, OPENAI_PROVIDER_LABEL, type AdditionalRateLimit, type CodexUsageResponse, type OpenAILimitCard, type OpenAIProviderMeta, type RateLimitBlock, type RateLimitWindow } from "./openai-types.ts";

export function buildUsageCards(data: CodexUsageResponse, providerMeta: OpenAIProviderMeta): UsageCard[] {
  const planType = formatPlanType(data.plan_type);
  const usageCards: OpenAILimitCard[] = [];
  const seenSections = new Set<string>();
  const creditsExtra = buildCreditsExtra(data.credits);

  const primaryCard = buildRateLimitCard({
    sectionId: "main",
    sectionKind: "main",
    sectionOrder: 10,
    planType,
    rateLimit: data.rate_limit,
    extra: creditsExtra,
    providerMeta,
  });
  pushUniqueCard(usageCards, seenSections, 10, primaryCard);

  const codeReviewCard = buildRateLimitCard({
    sectionId: "code-review",
    sectionKind: "special",
    sectionLabel: "Code Review",
    sectionOrder: 30,
    planType,
    rateLimit: data.code_review_rate_limit,
    providerMeta,
  });
  pushUniqueCard(usageCards, seenSections, 30, codeReviewCard);

  for (const [index, additionalLimit] of (data.additional_rate_limits ?? []).entries()) {
    const meta = getAdditionalLimitCardMeta(additionalLimit);
    const additionalCard = buildRateLimitCard({
      sectionId: meta.sectionId,
      sectionKind: "special",
      sectionLabel: meta.sectionLabel,
      sectionOrder: meta.order ?? 40 + index,
      planType,
      rateLimit: additionalLimit.rate_limit,
      providerMeta,
    });
    pushUniqueCard(usageCards, seenSections, meta.order ?? 40 + index, additionalCard);
  }

  if (usageCards.length > 0) {
    return usageCards
      .sort((left, right) => left.order - right.order)
      .map((entry) => entry.card)
      .filter(isUsageCard);
  }

  return [
    {
      providerId: providerMeta.providerId,
      provider: providerMeta.provider,
      sectionId: "main",
      sectionKind: "main",
      sectionOrder: 10,
      planType,
      windows: [],
      extra: creditsExtra,
    },
  ];
}

export function buildErrorCard(providerMeta: OpenAIProviderMeta, error: string): UsageCard {
  return {
    providerId: providerMeta.providerId,
    provider: providerMeta.provider,
    sectionId: "main",
    sectionKind: "main",
    sectionOrder: 10,
    windows: [],
    error,
  };
}

function buildRateLimitCard(input: {
  sectionId: string;
  sectionKind: UsageCard["sectionKind"];
  sectionLabel?: string;
  sectionOrder: number;
  note?: string;
  planType?: string;
  rateLimit?: RateLimitBlock;
  extra?: Record<string, string>;
  providerMeta?: OpenAIProviderMeta;
}): UsageCard | null {
  const windows = collectWindows(input.rateLimit);

  if (windows.length === 0 && !hasExtraRows(input.extra) && !input.note) {
    return null;
  }

  return {
    providerId: input.providerMeta?.providerId ?? OPENAI_PROVIDER_ID,
    provider: input.providerMeta?.provider ?? OPENAI_PROVIDER_LABEL,
    sectionId: input.sectionId,
    sectionKind: input.sectionKind,
    sectionLabel: input.sectionLabel,
    sectionOrder: input.sectionOrder,
    note: input.note,
    planType: input.planType,
    windows,
    extra: input.extra,
  };
}

function buildCreditsExtra(credits?: CodexUsageResponse["credits"]): Record<string, string> | undefined {
  if (!credits) {
    return undefined;
  }

  const extra: Record<string, string> = {};
  if (credits.unlimited) {
    extra.Credits = "Unlimited";
  } else if (typeof credits.balance === "string") {
    extra.Credits = credits.balance;
  }

  return hasExtraRows(extra) ? extra : undefined;
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

function pushUniqueCard(results: OpenAILimitCard[], seenSections: Set<string>, order: number, card: UsageCard | null): void {
  const key = card?.sectionId ?? `section-${order}`;

  if (!card || seenSections.has(key)) {
    return;
  }

  seenSections.add(key);
  results.push({ order, card });
}

function getAdditionalLimitCardMeta(limit: AdditionalRateLimit): {
  sectionId: string;
  sectionLabel: string;
  order?: number;
} {
  const rawName = limit.limit_name || limit.metered_feature || "additional_limit";
  const humanizedName = humanizeAdditionalLimitName(rawName);

  if (isSparkLimitName(rawName)) {
    return {
      sectionId: `additional-${normalizeSectionId(rawName)}`,
      sectionLabel: humanizedName,
      order: 20,
    };
  }

  return {
    sectionId: `additional-${normalizeSectionId(rawName)}`,
    sectionLabel: humanizedName,
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

function isUsageCard(value: UsageCard | null): value is UsageCard {
  return value !== null;
}

function hasExtraRows(extra?: Record<string, string>): boolean {
  return Boolean(extra && Object.keys(extra).length > 0);
}

function isRateLimitWindow(value: unknown): value is RateLimitWindow {
  return Boolean(
    value &&
      typeof value === "object" &&
      "used_percent" in value &&
      typeof (value as { used_percent?: unknown }).used_percent === "number",
  );
}
