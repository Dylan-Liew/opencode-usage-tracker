/**
 * Z.AI usage provider
 *
 * Community-observed endpoint: GET /api/monitor/usage/quota/limit
 */

import type { UsageCard, UsageProviderDefinition, UsageWindow } from "../types.ts";
import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import { fetchJsonResponseWithTimeout, getFetchErrorMessage } from "../utils/http.ts";
import { formatRelativeTime } from "../utils/format.ts";

const DEFAULT_BASE_HOST = "https://api.z.ai";
const USAGE_ENDPOINT = "/api/monitor/usage/quota/limit";
const PROVIDER_LABEL = "Z.AI";
const PROVIDER_COMMAND_TITLE = "Usage Z.AI";
const USAGE_TIMEOUT_MS = 5000;

interface ZaiAuth {
  accessToken: string;
  baseHost?: string;
}

interface ZaiLimit {
  type?: string;
  unit?: number;
  number?: number;
  usage?: number;
  currentValue?: number;
  percentage?: number;
  nextResetTime?: number;
}

interface ZaiUsageResponse {
  code?: number | string;
  msg?: string;
  success?: boolean;
  data?: {
    code?: number | string;
    msg?: string;
    success?: boolean;
    planName?: string;
    plan?: string;
    plan_type?: string;
    packageName?: string;
    level?: string;
    limits?: ZaiLimit[];
  };
  limits?: ZaiLimit[];
}

interface ZaiLabelState {
  tokenLimitCount: number;
  timeLimitCount: number;
  usedLabels: Set<string>;
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

function normalizeHost(baseHost?: string): string {
  if (!baseHost) {
    return DEFAULT_BASE_HOST;
  }

  const trimmed = baseHost.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return DEFAULT_BASE_HOST;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_BASE_HOST;
  }
}

function getAuthVariants(apiKey: string): string[] {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return [];
  }

  if (/^bearer\s+/i.test(trimmed)) {
    return [trimmed];
  }

  // Z.AI documents Bearer authentication. Keep the raw key as a compatibility
  // fallback for older gateways that accepted it directly.
  return [`Bearer ${trimmed}`, trimmed];
}

function ensureUniqueLabel(baseLabel: string, usedLabels: Set<string>): string {
  if (!usedLabels.has(baseLabel)) {
    usedLabels.add(baseLabel);
    return baseLabel;
  }

  let suffix = 2;
  while (usedLabels.has(`${baseLabel} ${suffix}`)) {
    suffix += 1;
  }

  const uniqueLabel = `${baseLabel} ${suffix}`;
  usedLabels.add(uniqueLabel);
  return uniqueLabel;
}

function buildLabel(limit: ZaiLimit, state: ZaiLabelState): string {
  const type = limit.type;

  if (type === "TOKENS_LIMIT" || type === "CREDIT_LIMIT") {
    state.tokenLimitCount += 1;

    if (limit.unit === 3 && limit.number === 5) {
      return ensureUniqueLabel("5h", state.usedLabels);
    }
    if (limit.unit === 6 && (limit.number === 1 || limit.number === 7)) {
      return ensureUniqueLabel("Weekly", state.usedLabels);
    }

    if (state.tokenLimitCount === 1) {
      return ensureUniqueLabel("5h", state.usedLabels);
    }
    if (state.tokenLimitCount === 2) {
      return ensureUniqueLabel("Weekly", state.usedLabels);
    }

    return ensureUniqueLabel("Tokens", state.usedLabels);
  }

  if (type === "TIME_LIMIT") {
    state.timeLimitCount += 1;

    if (limit.unit === 5 && limit.number === 1) {
      return ensureUniqueLabel("MCP", state.usedLabels);
    }

    if (state.timeLimitCount === 1) {
      return ensureUniqueLabel("MCP", state.usedLabels);
    }

    return ensureUniqueLabel("Time", state.usedLabels);
  }

  if (limit.unit === 3 && limit.number === 5) {
    return ensureUniqueLabel("5h", state.usedLabels);
  }

  if (limit.unit === 6 && (limit.number === 1 || limit.number === 7)) {
    return ensureUniqueLabel("Weekly", state.usedLabels);
  }

  if (limit.unit === 5 && limit.number === 1) {
    return ensureUniqueLabel("MCP", state.usedLabels);
  }

  return ensureUniqueLabel(type || "Usage", state.usedLabels);
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parsePercentage(limit: ZaiLimit): { percent: number; source: UsageWindow["source"] } {
  if (typeof limit.percentage === "number" && Number.isFinite(limit.percentage)) {
    return { percent: clampPercent(limit.percentage), source: "endpoint" };
  }

  if (typeof limit.currentValue === "number" && typeof limit.usage === "number" && limit.usage > 0) {
    return {
      percent: clampPercent((limit.currentValue / limit.usage) * 100),
      source: "computed",
    };
  }

  return { percent: 0, source: "computed" };
}

function parseResetTime(limit: ZaiLimit): { resetTime?: string; rawResetAt?: string } {
  if (typeof limit.nextResetTime !== "number" || !Number.isFinite(limit.nextResetTime)) {
    return {};
  }

  const milliseconds = limit.nextResetTime > 10_000_000_000
    ? limit.nextResetTime
    : limit.nextResetTime * 1000;
  const resetDate = new Date(milliseconds);

  if (Number.isNaN(resetDate.getTime())) {
    return {};
  }

  return {
    resetTime: formatRelativeTime(resetDate),
    rawResetAt: resetDate.toISOString(),
  };
}

function readLimits(response: ZaiUsageResponse | undefined): ZaiLimit[] {
  const limits = response?.data?.limits ?? response?.limits;
  return Array.isArray(limits) ? limits : [];
}

function parseCodeValue(value: number | string | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function getZaiApiMessage(response: ZaiUsageResponse | undefined): string | undefined {
  const message = response?.msg ?? response?.data?.msg;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : undefined;
}

function getZaiApiError(response: ZaiUsageResponse | undefined): string | undefined {
  const success = response?.success ?? response?.data?.success;
  const code = parseCodeValue(response?.code ?? response?.data?.code);
  const message = getZaiApiMessage(response);

  if (success === false) {
    return message ?? (code !== undefined ? `API error: ${code}` : "API request failed");
  }

  if (code !== undefined && code !== 0 && code !== 200) {
    return message ? `API error (${code}): ${message}` : `API error: ${code}`;
  }

  return undefined;
}

function getZaiPlanType(response: ZaiUsageResponse | undefined): string | undefined {
  const candidates = [
    response?.data?.planName,
    response?.data?.plan,
    response?.data?.plan_type,
    response?.data?.packageName,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const level = response?.data?.level?.trim();
  return level ? `${level.charAt(0).toUpperCase()}${level.slice(1)}` : undefined;
}

function compareZaiLimits(left: ZaiLimit, right: ZaiLimit): number {
  const quotaTypes = new Set(["TOKENS_LIMIT", "CREDIT_LIMIT"]);
  if (quotaTypes.has(left.type ?? "") && quotaTypes.has(right.type ?? "")) {
    const leftReset = typeof left.nextResetTime === "number" ? left.nextResetTime : Number.POSITIVE_INFINITY;
    const rightReset = typeof right.nextResetTime === "number" ? right.nextResetTime : Number.POSITIVE_INFINITY;
    return leftReset - rightReset;
  }

  return 0;
}

function buildMainCard(input: { windows: UsageWindow[]; planType?: string; error?: string }): UsageCard[] {
  return [
    {
      providerId: zaiProvider.id,
      provider: PROVIDER_LABEL,
      sectionId: "main",
      sectionKind: "main",
      sectionOrder: 10,
      planType: input.planType,
      windows: input.windows,
      error: input.error,
    },
  ];
}

async function fetchZaiUsage(auth: ZaiAuth): Promise<UsageCard[]> {
  try {
    const variants = getAuthVariants(auth.accessToken);
    if (variants.length === 0) {
      return buildMainCard({ windows: [], error: "No API key found" });
    }

    const url = `${normalizeHost(auth.baseHost)}${USAGE_ENDPOINT}`;
    let result: { response: Response; data?: ZaiUsageResponse } | undefined;

    for (const token of variants) {
      const current = await fetchJsonResponseWithTimeout<ZaiUsageResponse>(
        url,
        {
          method: "GET",
          headers: {
            Authorization: token,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
        USAGE_TIMEOUT_MS,
      );

      result = current;
      if (current.response.status !== 401 && current.response.status !== 403) {
        break;
      }
    }

    if (!result) {
      return buildMainCard({ windows: [], error: "No response from Z.AI usage endpoint" });
    }

    if (result.response.status === 401) {
      return buildMainCard({ windows: [], error: "API key invalid" });
    }

    if (result.response.status === 403) {
      return buildMainCard({ windows: [], error: "API access denied" });
    }

    if (!result.response.ok) {
      return buildMainCard({ windows: [], error: `HTTP ${result.response.status}` });
    }

    const apiError = getZaiApiError(result.data);
    if (apiError) {
      return buildMainCard({ windows: [], error: apiError });
    }

    const limits = readLimits(result.data).sort(compareZaiLimits);
    const windows: UsageWindow[] = [];
    const labelState: ZaiLabelState = {
      tokenLimitCount: 0,
      timeLimitCount: 0,
      usedLabels: new Set<string>(),
    };

    for (const limit of limits) {
      if (!limit || typeof limit !== "object") {
        continue;
      }

      const label = buildLabel(limit, labelState);
      const { percent, source } = parsePercentage(limit);
      const { resetTime, rawResetAt } = parseResetTime(limit);

      windows.push({
        label,
        usedPercent: percent,
        resetTime,
        rawResetAt,
        source,
      });
    }

    windows.sort((left, right) => {
      if (left.label === "5h") {
        return -1;
      }
      if (right.label === "5h") {
        return 1;
      }
      return 0;
    });

    if (windows.length === 0) {
      return buildMainCard({
        windows: [],
        error: "No quota data returned by Z.AI. The coding plan may be inactive or expired.",
      });
    }

    return buildMainCard({
      windows,
      planType: getZaiPlanType(result.data),
    });
  } catch (error) {
    return buildMainCard({ windows: [], error: getFetchErrorMessage(error) });
  }
}

function resolveZaiAuth(rawAuth: RawAuthJson): ZaiAuth | undefined {
  const zai = rawAuth["zai-coding-plan"] ?? rawAuth["zai"] ?? rawAuth["z-ai"];
  if (!zai) {
    return undefined;
  }

  const accessToken = getStringValue(zai, "access", "accessToken", "key", "token");
  if (!accessToken) {
    return undefined;
  }

  return {
    accessToken,
    baseHost: getStringValue(zai, "baseHost", "baseDomain", "apiHost", "host", "baseUrl", "endpoint"),
  };
}

export const zaiProvider = {
  id: "zai",
  label: PROVIDER_LABEL,
  commandTitle: PROVIDER_COMMAND_TITLE,
  order: 50,
  resolveAuth: resolveZaiAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveZaiAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchZaiUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
