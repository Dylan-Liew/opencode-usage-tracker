/**
 * GitHub Copilot usage provider
 *
 * Uses GitHub's internal Copilot API to get plan and quota info.
 */

import type { UsageCard, UsageProviderDefinition } from "../types.ts";
import type { RawAuthJson } from "../utils/auth.ts";
import { formatRelativeTime } from "../utils/format.ts";

const COPILOT_USER_ENDPOINT = "https://api.github.com/copilot_internal/user";
const COPILOT_PROVIDER_NAME = "GitHub Copilot";

interface QuotaSnapshot {
  quota_id: string;
  remaining: number;
  entitlement: number;
  percent_remaining: number;
  unlimited: boolean;
  overage_count?: number;
  overage_permitted?: boolean;
}

interface CopilotUserResponse {
  login?: string;
  copilot_plan?: string;
  access_type_sku?: string;
  chat_enabled?: boolean;
  quota_reset_date?: string;
  quota_reset_date_utc?: string;
  quota_snapshots?: Record<string, QuotaSnapshot>;
}

async function fetchCopilotUsage(accessToken: string): Promise<UsageCard[]> {
  try {
    const response = await fetch(COPILOT_USER_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/json",
        "Editor-Version": "vscode/1.96.2",
        "X-Github-Api-Version": "2025-04-01",
        "User-Agent": "opencode-usage-tracker/1.0.0",
      },
    });

    if (!response.ok) {
      return [
        {
          providerId: copilotProvider.id,
          provider: COPILOT_PROVIDER_NAME,
          windows: [],
          error: `API error: ${response.status}`,
        },
      ];
    }

    const data = (await response.json()) as CopilotUserResponse;

    const windows: UsageCard["windows"] = [];
    const extra: Record<string, string> = {};

    let resetDate: Date | undefined;
    if (data.quota_reset_date_utc) {
      resetDate = new Date(data.quota_reset_date_utc);
    } else if (data.quota_reset_date) {
      resetDate = new Date(`${data.quota_reset_date}T00:00:00Z`);
    }

    const resetTimeStr = resetDate ? formatRelativeTime(resetDate) : undefined;

    if (data.quota_snapshots) {
      const premium = data.quota_snapshots["premium_interactions"];

      if (premium && !premium.unlimited && premium.entitlement > 0) {
        const used = premium.entitlement - premium.remaining;
        const usedPercent = (used / premium.entitlement) * 100;

        windows.push({
          label: "Premium",
          usedPercent,
          used,
          remaining: premium.remaining,
          limit: premium.entitlement,
          unit: "requests",
          resetTime: resetTimeStr,
          source: "endpoint",
          rawResetAt: resetDate?.toISOString(),
        });

        extra["Requests"] = `${used}/${premium.entitlement} used`;
        extra["Remaining"] = `${premium.remaining} requests`;
      }

      const chat = data.quota_snapshots["chat"];
      if (chat && !chat.unlimited && chat.entitlement > 0) {
        const used = chat.entitlement - chat.remaining;
        const usedPercent = (used / chat.entitlement) * 100;

        windows.push({
          label: "Chat",
          usedPercent,
          used,
          remaining: chat.remaining,
          limit: chat.entitlement,
          unit: "requests",
          source: "endpoint",
        });
      }
    }

    if (windows.length === 0) {
      extra.Status = "Unlimited";
    }

    let planType = data.copilot_plan || "Free";
    if (data.access_type_sku === "free_educational_quota") {
      planType = "Education";
    } else if (planType === "individual") {
      planType = "Pro";
    }

    return [
      {
        providerId: copilotProvider.id,
        provider: COPILOT_PROVIDER_NAME,
        planType,
        windows,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      },
    ];
  } catch (error) {
    return [
      {
        providerId: copilotProvider.id,
        provider: COPILOT_PROVIDER_NAME,
        windows: [],
        error: error instanceof Error ? error.message : "Unknown error",
      },
    ];
  }
}

function resolveCopilotAuth(rawAuth: RawAuthJson): string | undefined {
  const copilot = rawAuth["copilot"] ?? rawAuth["github-copilot"];
  if (!copilot) {
    return undefined;
  }

  for (const key of ["access", "accessToken", "token"]) {
    const value = copilot[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

export const copilotProvider = {
  id: "copilot",
  label: COPILOT_PROVIDER_NAME,
  commandTitle: "Usage Copilot",
  order: 20,
  resolveAuth: resolveCopilotAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveCopilotAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchCopilotUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
