import { ALL_PROVIDERS_SCOPE } from "./constants.ts";
import {
  getConfiguredProviders,
  getProviderById,
  type ProviderScope,
} from "./providers/index.ts";
import type { UsageCard, UsageProviderDefinition, UsageResult } from "./types.ts";
import { getRawAuthJson } from "./utils/auth.ts";

export async function fetchUsageResult(provider: ProviderScope): Promise<UsageResult> {
  const rawAuth = await getRawAuthJson();
  const configuredProviders = rawAuth ? getConfiguredProviders(rawAuth) : [];

  if (configuredProviders.length === 0) {
    return {
      kind: "empty",
      provider,
      message: "No providers configured. Add tokens to auth.json first.",
    };
  }

  if (provider !== ALL_PROVIDERS_SCOPE && !getProviderById(provider)) {
    return {
      kind: "error",
      provider,
      message: `Unknown provider: ${provider}`,
    };
  }

  const selectedProviders =
    provider === ALL_PROVIDERS_SCOPE
      ? configuredProviders
      : configuredProviders.filter((definition) => definition.id === provider);

  if (selectedProviders.length === 0) {
    return {
      kind: "error",
      provider,
      message: `Provider not configured: ${provider}`,
    };
  }

  const usageData = await fetchUsageData(rawAuth!, selectedProviders);

  if (usageData.length === 0) {
    return {
      kind: "empty",
      provider,
      message: "No usage data available.",
    };
  }

  return {
    kind: "ok",
    provider,
    providers: usageData,
  };
}

async function fetchUsageData(
  rawAuth: NonNullable<Awaited<ReturnType<typeof getRawAuthJson>>>,
  providers: UsageProviderDefinition[],
): Promise<UsageCard[]> {
  const results: UsageCard[] = [];
  const settled = await Promise.allSettled(
    providers.map((definition) => definition.fetchFromRawAuth(rawAuth)),
  );

  for (const [index, result] of settled.entries()) {
    const definition = providers[index];
    if (!definition) {
      continue;
    }

    if (result.status === "fulfilled") {
      results.push(...result.value);
      continue;
    }

    results.push({
      providerId: definition.id,
      provider: definition.label,
      windows: [],
      error: result.reason instanceof Error ? result.reason.message : "Unknown error",
    });
  }

  return results;
}
