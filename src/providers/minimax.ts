/**
 * MiniMax Coding Plan usage provider
 *
 * Community-observed endpoints:
 * - https://api.minimax.io/v1/api/openplatform/coding_plan/remains
 * - https://www.minimax.io/v1/api/openplatform/coding_plan/remains
 */

import type { UsageCard, UsageProviderDefinition, UsageWindow } from "../types.ts";
import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import { fetchJsonResponseWithTimeout, getFetchErrorMessage } from "../utils/http.ts";
import { formatRelativeTime } from "../utils/format.ts";

const ENDPOINTS = [
  "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
  "https://www.minimax.io/v1/api/openplatform/coding_plan/remains",
  "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
  "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
] as const;
const PROVIDER_LABEL = "MiniMax Coding Plan";
const PROVIDER_COMMAND_TITLE = "Usage MiniMax";
const USAGE_TIMEOUT_MS = 5000;

const MODEL_NAME_KEYS = ["model_name", "modelName", "name", "model"];
const INTERVAL_TOTAL_KEYS = ["current_interval_total_count", "currentIntervalTotalCount"];
const INTERVAL_REMAINING_KEYS = [
  "current_interval_usage_count",
  "currentIntervalUsageCount",
  "current_interval_remain_count",
  "currentIntervalRemainCount",
  "current_interval_remaining_count",
  "currentIntervalRemainingCount",
];
const WEEKLY_TOTAL_KEYS = ["current_weekly_total_count", "currentWeeklyTotalCount"];
const WEEKLY_REMAINING_KEYS = ["current_weekly_usage_count", "currentWeeklyUsageCount"];
const INTERVAL_END_KEYS = ["end_time", "endTime", "reset_at", "resetAt"];
const WEEKLY_END_KEYS = ["weekly_end_time", "weeklyEndTime"];
const INTERVAL_REMAINS_MS_KEYS = ["remains_time", "remain_time", "remainsTime", "remainTime"];
const WEEKLY_REMAINS_MS_KEYS = ["weekly_remains_time", "weeklyRemainTime", "weeklyRemainsTime"];
const PERCENT_KEYS = ["used_percent", "usedPercent", "usage_percent", "usagePercent"];
const PLAN_KEYS = ["plan", "plan_type", "planType", "plan_name", "planName"];

interface MinimaxAuth {
  apiKey: string;
  groupId?: string;
}

interface BaseResp {
  status_code?: unknown;
  status_msg?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
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

function pickValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | null {
  return toNumber(pickValue(record, keys));
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  return toStringValue(pickValue(record, keys));
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function normalizePercentage(value: number): number {
  const normalized = value <= 1 ? value * 100 : value;
  return clampPercent(normalized);
}

function parseStatusCode(value: unknown): number | null {
  const status = toNumber(value);
  return status === null ? null : Math.trunc(status);
}

function parseResetTime(value: unknown, key: string): Date | undefined {
  const raw = toNumber(value);
  if (raw === null || raw <= 0) {
    return undefined;
  }

  const lower = key.toLowerCase();

  if (lower.includes("at") || lower.includes("expires") || lower.includes("reset")) {
    if (raw > 10_000_000_000) {
      return new Date(raw > 10_000_000_000_000 ? raw : raw * 1000);
    }

    return new Date(raw * 1000);
  }

  if (lower.includes("remain")) {
    return new Date(Date.now() + raw);
  }

  if (raw > 10_000_000_000) {
    return new Date(raw);
  }

  return new Date(Date.now() + raw);
}

function extractModelRemains(data: Record<string, unknown>): unknown[] {
  const rootArray = pickValue(data, ["model_remains", "modelRemains"]);
  if (Array.isArray(rootArray) && rootArray.length > 0) {
    return rootArray;
  }

  const nestedData = pickValue(data, ["data"]);
  if (isRecord(nestedData)) {
    const nestedArray = pickValue(nestedData, ["model_remains", "modelRemains"]);
    if (Array.isArray(nestedArray) && nestedArray.length > 0) {
      return nestedArray;
    }
  }

  return [];
}

function parseModelLabel(index: number, record: Record<string, unknown>): string {
  return pickString(record, MODEL_NAME_KEYS) ?? `Model ${index + 1}`;
}

function parseModelPercent(record: Record<string, unknown>): number | null {
  const directPercent = pickNumber(record, PERCENT_KEYS);
  if (directPercent !== null) {
    return normalizePercentage(directPercent);
  }

  return null;
}

function getStatusCode(payload: Record<string, unknown>): number | null {
  const baseResp = pickValue(payload, ["base_resp"]);
  if (isRecord(baseResp)) {
    return parseStatusCode((baseResp as BaseResp).status_code);
  }

  return parseStatusCode(pickValue(payload, ["status_code"]));
}

function getStatusMessage(payload: Record<string, unknown>): string | undefined {
  const baseResp = pickValue(payload, ["base_resp"]);
  if (isRecord(baseResp)) {
    const message = toStringValue((baseResp as BaseResp).status_msg);
    if (message) {
      return message;
    }
  }

  return undefined;
}

function buildEndpoints(groupId?: string): string[] {
  const suffix = groupId ? `?GroupId=${encodeURIComponent(groupId)}` : "";
  return ENDPOINTS.map((endpoint) => `${endpoint}${suffix}`);
}

function buildMainCard(input: {
  windows: UsageWindow[];
  planType?: string;
  extra?: Record<string, string>;
  error?: string;
}): UsageCard[] {
  return [
    {
      providerId: minimaxProvider.id,
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

function parseMinimaxPayload(data: Record<string, unknown>): {
  windows?: UsageWindow[];
  planType?: string;
  extra?: Record<string, string>;
  error?: string;
} {
  const baseStatusCode = getStatusCode(data);
  if (baseStatusCode !== null && baseStatusCode !== 0) {
    return {
      error: `MiniMax API error (${baseStatusCode}): ${getStatusMessage(data) ?? "request failed"}`,
    };
  }

  const modelRows = extractModelRemains(data);
  if (modelRows.length === 0) {
    return { error: "No model_remains data in MiniMax response" };
  }

  const windows: UsageWindow[] = [];
  const extra: Record<string, string> = {};
  const modelNames = new Set<string>();

  for (let index = 0; index < modelRows.length; index++) {
    const row = modelRows[index];
    if (!isRecord(row)) {
      continue;
    }

    const modelLabel = parseModelLabel(index, row);
    const modelName = pickString(row, MODEL_NAME_KEYS);
    if (modelName) {
      modelNames.add(modelName);
    }

    let addedWindowForRow = false;

    const intervalTotal = pickNumber(row, INTERVAL_TOTAL_KEYS);
    const intervalRemaining = pickNumber(row, INTERVAL_REMAINING_KEYS);
    if (intervalTotal !== null && intervalRemaining !== null && intervalTotal > 0) {
      const used = Math.max(0, intervalTotal - intervalRemaining);
      const intervalEndKey = INTERVAL_END_KEYS.find((key) => key in row);
      const intervalResetDate = intervalEndKey
        ? parseResetTime(row[intervalEndKey], intervalEndKey)
        : (() => {
            const remainKey = INTERVAL_REMAINS_MS_KEYS.find((key) => key in row);
            return remainKey ? parseResetTime(row[remainKey], remainKey) : undefined;
          })();

      windows.push({
        label: modelRows.length > 1 ? `${modelLabel} 5h` : "5h",
        usedPercent: normalizePercentage((used / intervalTotal) * 100),
        used,
        remaining: Math.max(0, intervalRemaining),
        limit: intervalTotal,
        unit: "requests",
        resetTime: intervalResetDate ? formatRelativeTime(intervalResetDate) : undefined,
        source: "computed",
        rawResetAt: intervalResetDate?.toISOString(),
      });

      extra[modelRows.length > 1 ? `${modelLabel} 5h remaining` : "5h remaining"] = `${Math.max(0, intervalRemaining)}/${intervalTotal}`;
      addedWindowForRow = true;
    }

    const weeklyTotal = pickNumber(row, WEEKLY_TOTAL_KEYS);
    const weeklyRemaining = pickNumber(row, WEEKLY_REMAINING_KEYS);
    if (weeklyTotal !== null && weeklyRemaining !== null && weeklyTotal > 0) {
      const used = Math.max(0, weeklyTotal - weeklyRemaining);
      const weeklyEndKey = WEEKLY_END_KEYS.find((key) => key in row);
      const weeklyResetDate = weeklyEndKey
        ? parseResetTime(row[weeklyEndKey], weeklyEndKey)
        : (() => {
            const remainKey = WEEKLY_REMAINS_MS_KEYS.find((key) => key in row);
            return remainKey ? parseResetTime(row[remainKey], remainKey) : undefined;
          })();

      windows.push({
        label: modelRows.length > 1 ? `${modelLabel} weekly` : "Weekly",
        usedPercent: normalizePercentage((used / weeklyTotal) * 100),
        used,
        remaining: Math.max(0, weeklyRemaining),
        limit: weeklyTotal,
        unit: "requests",
        resetTime: weeklyResetDate ? formatRelativeTime(weeklyResetDate) : undefined,
        source: "computed",
        rawResetAt: weeklyResetDate?.toISOString(),
      });

      extra[modelRows.length > 1 ? `${modelLabel} weekly remaining` : "Weekly remaining"] = `${Math.max(0, weeklyRemaining)}/${weeklyTotal}`;
      addedWindowForRow = true;
    }

    const directPercent = parseModelPercent(row);
    if (!addedWindowForRow && directPercent !== null) {
      windows.push({
        label: modelRows.length > 1 ? modelLabel : "Usage",
        usedPercent: directPercent,
        source: "endpoint",
      });
    }
  }

  if (windows.length === 0) {
    return { error: "No parseable quota windows were returned by MiniMax" };
  }

  const names = [...modelNames].filter(Boolean);
  if (names.length === 1) {
    extra.Model = names[0] ?? "";
  } else if (names.length > 1) {
    extra.Models = names.join(", ");
  }

  const nestedData = pickValue(data, ["data"]);
  const planSource = isRecord(nestedData) ? nestedData : data;

  return {
    windows,
    planType: pickString(planSource, PLAN_KEYS),
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

async function fetchMinimaxUsage(auth: MinimaxAuth): Promise<UsageCard[]> {
  let lastError = "Failed to fetch MiniMax usage data";

  for (const endpoint of buildEndpoints(auth.groupId)) {
    try {
      const { response, data } = await fetchJsonResponseWithTimeout<unknown>(
        endpoint,
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

      if (response.status === 401 || response.status === 403) {
        lastError = "API key expired or invalid";
        continue;
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }

      if (!isRecord(data)) {
        lastError = "Unexpected MiniMax response format";
        continue;
      }

      const parsed = parseMinimaxPayload(data);
      if (!parsed.error && parsed.windows) {
        return buildMainCard({
          windows: parsed.windows,
          planType: parsed.planType,
          extra: parsed.extra,
        });
      }

      if (parsed.error) {
        lastError = parsed.error;
      }
    } catch (error) {
      lastError = getFetchErrorMessage(error);
    }
  }

  return buildMainCard({ windows: [], error: lastError });
}

function resolveMinimaxAuth(rawAuth: RawAuthJson): MinimaxAuth | undefined {
  const minimax = rawAuth["minimax-coding-plan"] ?? rawAuth["minimax"];
  if (!minimax) {
    return undefined;
  }

  const apiKey = getStringValue(minimax, "key", "access", "accessToken", "token");
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    groupId: getStringValue(minimax, "groupId", "group_id"),
  };
}

export const minimaxProvider = {
  id: "minimax",
  label: PROVIDER_LABEL,
  commandTitle: PROVIDER_COMMAND_TITLE,
  order: 30,
  resolveAuth: resolveMinimaxAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveMinimaxAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchMinimaxUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
