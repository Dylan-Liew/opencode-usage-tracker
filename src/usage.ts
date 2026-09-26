import {
  ALL_PROVIDERS_SCOPE,
  getConfiguredProviders,
  getProviderById,
  type ProviderScope,
} from "./providers/index.ts";
import type { UsageCard, UsageProviderDefinition, UsageResult } from "./types.ts";
import type { RawAuthJson } from "./utils/auth.ts";

/**
 * Remove keys with `undefined` values from objects (recursively).
 *
 * JSON.stringify drops these keys, but the OpenCode RPC host validates the
 * handler output against the declared JSON schema before serialization and
 * rejects present-but-undefined keys with `rpc.invalid_output`.
 */
function omitUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => omitUndefined(entry)) as T;
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) {
        continue;
      }
      result[key] = omitUndefined(entry);
    }
    return result as T;
  }

  return value;
}

export async function fetchUsageResult(provider: ProviderScope, rawAuth: RawAuthJson): Promise<UsageResult> {
  const configuredProviders = rawAuth ? getConfiguredProviders(rawAuth) : [];

  if (configuredProviders.length === 0) {
    return {
      kind: "empty",
      provider,
      message: "No providers configured. Connect a provider using /connect first.",
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
  rawAuth: RawAuthJson,
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
      results.push(...result.value.map((card) => omitUndefined(card)));
      continue;
    }

    results.push(omitUndefined({
      providerId: definition.id,
      provider: definition.label,
      sectionId: "main",
      sectionKind: "main",
      sectionOrder: 10,
      windows: [],
      error: result.reason instanceof Error ? result.reason.message : "Unknown error",
    }));
  }

  return results;
}
