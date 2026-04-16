/**
 * Kimi for Coding usage provider (experimental)
 *
 * Community-observed endpoint: https://api.kimi.com/coding/v1/usages
 */

import type { UsageCard, UsageProviderDefinition, UsageWindow } from "../types.ts";
import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import { fetchJsonResponseWithTimeout, getFetchErrorMessage } from "../utils/http.ts";
import { formatRelativeTime } from "../utils/format.ts";

const USAGE_ENDPOINT = "https://api.kimi.com/coding/v1/usages";
const PROVIDER_LABEL = "Kimi for Coding";
const PROVIDER_COMMAND_TITLE = "Usage Kimi";
const USAGE_TIMEOUT_MS = 5000;

interface KimiAuth {
  apiKey: string;
}

interface KimiUsageDetail {
  limit?: string;
  used?: string;
  remaining?: string;
  resetTime?: string;
}

interface KimiRateLimit {
  window?: {
    duration?: number;
    timeUnit?: string;
  };
  detail?: KimiUsageDetail;
}

interface KimiUsageResponse {
  code?: string;
  msg?: string;
  message?: string;
  details?: Array<{
    debug?: {
      reason?: string;
      localizedMessage?: {
        locale?: string;
        message?: string;
      };
    };
  }>;
  user?: {
    region?: string;
    businessId?: string;
    membership?: {
      level?: string;
    };
  };
  usage?: KimiUsageDetail;
  limits?: KimiRateLimit[];
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

function toNumber(value?: string): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function humanizeEnumValue(value: string): string {
  return value
    .replace(/^(LEVEL_|REGION_|TIME_UNIT_)/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDurationLabel(duration?: number, timeUnit?: string): string {
  if (!duration || !timeUnit) {
    return "Rate limit";
  }

  const normalizedUnit = timeUnit.toUpperCase();
  if (normalizedUnit === "TIME_UNIT_MINUTE") {
    const hours = duration / 60;
    return Number.isInteger(hours) && hours > 0 ? `${hours}h` : `${duration}m`;
  }

  if (normalizedUnit === "TIME_UNIT_HOUR") {
    return `${duration}h`;
  }

  if (normalizedUnit === "TIME_UNIT_DAY") {
    return duration === 7 ? "Weekly" : `${duration}d`;
  }

  return `${duration} ${humanizeEnumValue(normalizedUnit)}`;
}

function formatMembershipLevel(level?: string): string | undefined {
  if (!level) {
    return undefined;
  }

  return humanizeEnumValue(level);
}

function toUsageWindow(label: string, detail?: KimiUsageDetail): UsageWindow | undefined {
  if (!detail) {
    return undefined;
  }

  const limit = toNumber(detail.limit);
  const remaining = toNumber(detail.remaining);
  const used = toNumber(detail.used);

  let usedPercent: number | null = null;
  if (limit !== null && remaining !== null && limit > 0) {
    usedPercent = clampPercent(((limit - remaining) / limit) * 100);
  } else if (limit !== null && used !== null && limit > 0) {
    usedPercent = clampPercent((used / limit) * 100);
  } else if (used !== null && used >= 0 && used <= 100) {
    usedPercent = clampPercent(used);
  }

  if (usedPercent === null) {
    return undefined;
  }

  const resetDate = detail.resetTime ? new Date(detail.resetTime) : undefined;
  const validResetDate = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate : undefined;

  return {
    label,
    usedPercent,
    used: used ?? undefined,
    remaining: remaining ?? undefined,
    limit: limit ?? undefined,
    resetTime: validResetDate ? formatRelativeTime(validResetDate) : undefined,
    rawResetAt: validResetDate?.toISOString(),
    source: limit !== null ? "computed" : "endpoint",
  };
}

function buildMainCard(input: {
  windows: UsageWindow[];
  planType?: string;
  extra?: Record<string, string>;
  error?: string;
}): UsageCard[] {
  return [
    {
      providerId: kimiProvider.id,
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

function getKimiApiError(data: KimiUsageResponse | undefined): string | undefined {
  const localizedMessage = data?.details
    ?.map((detail) => detail.debug?.localizedMessage?.message)
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (localizedMessage) {
    return localizedMessage.trim();
  }

  const directMessage = [data?.message, data?.msg]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (directMessage) {
    return directMessage.trim();
  }

  if (typeof data?.code === "string" && data.code.trim().length > 0) {
    return data.code.trim().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  }

  return undefined;
}

async function fetchKimiUsage(auth: KimiAuth): Promise<UsageCard[]> {
  try {
    const { response, data } = await fetchJsonResponseWithTimeout<KimiUsageResponse>(
      USAGE_ENDPOINT,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      },
      USAGE_TIMEOUT_MS,
    );

    if (response.status === 401) {
      return buildMainCard({ windows: [], error: getKimiApiError(data) ?? "API key expired or invalid" });
    }

    if (!response.ok) {
      return buildMainCard({ windows: [], error: getKimiApiError(data) ?? `API error: ${response.status}` });
    }

    if (!data) {
      return buildMainCard({ windows: [], error: "Usage response was empty" });
    }

    const windows: UsageWindow[] = [];
    const extra: Record<string, string> = {};
    const seenLabels = new Set<string>();

    const weeklyWindow = toUsageWindow("Weekly", data.usage);
    if (weeklyWindow) {
      windows.push(weeklyWindow);
      seenLabels.add(weeklyWindow.label);
    }

    for (const limit of data.limits ?? []) {
      const label = getDurationLabel(limit.window?.duration, limit.window?.timeUnit);
      if (seenLabels.has(label)) {
        continue;
      }

      const usageWindow = toUsageWindow(label, limit.detail);
      if (usageWindow) {
        windows.push(usageWindow);
        seenLabels.add(label);
      }
    }

    const planType = formatMembershipLevel(data.user?.membership?.level);

    if (data.user?.region) {
      extra.Region = humanizeEnumValue(data.user.region);
    }

    if (data.user?.businessId) {
      extra.Business = data.user.businessId;
    }

    if (windows.length === 0) {
      return buildMainCard({ windows: [], error: "No parseable quota windows were returned by Kimi" });
    }

    return buildMainCard({
      windows,
      planType,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    });
  } catch (error) {
    return buildMainCard({ windows: [], error: getFetchErrorMessage(error) });
  }
}

function resolveKimiAuth(rawAuth: RawAuthJson): KimiAuth | undefined {
  const kimi = rawAuth["kimi-for-coding"] ?? rawAuth["kimi"];
  if (!kimi) {
    return undefined;
  }

  const apiKey = getStringValue(kimi, "key", "token");
  if (!apiKey) {
    return undefined;
  }

  return { apiKey };
}

export const kimiProvider = {
  id: "kimi",
  label: PROVIDER_LABEL,
  commandTitle: PROVIDER_COMMAND_TITLE,
  order: 40,
  resolveAuth: resolveKimiAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveKimiAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchKimiUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
