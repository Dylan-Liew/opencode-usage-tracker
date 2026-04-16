/**
 * Provider registry - exports all usage providers
 */

import type { UsageProviderDefinition } from "../types.ts";
import type { RawAuthJson } from "../utils/auth.ts";
import { copilotProvider } from "./copilot.ts";
import { openAIProvider } from "./openai.ts";

export const ALL_PROVIDERS_SCOPE = "all" as const;

export interface ProviderOption {
  title: string;
  value: ProviderId;
}

export interface ProviderCommand {
  provider: ProviderId;
  title: string;
  value: string;
}

export interface ProviderScopeOption {
  title: string;
  value: ProviderScope;
}

/**
 * Explicit module registration list.
 *
 * Sorting is automatic from each provider's `order` field, but ESM still needs
 * explicit imports somewhere so the modules are part of the registry.
 */
const REGISTERED_PROVIDERS = [openAIProvider, copilotProvider] as const satisfies readonly UsageProviderDefinition[];

export type ProviderId = (typeof REGISTERED_PROVIDERS)[number]["id"];
export type ProviderScope = ProviderId | typeof ALL_PROVIDERS_SCOPE;

assertProviderRegistry();

function assertProviderRegistry(): void {
  const seenProviderIds = new Set<string>();

  for (const provider of REGISTERED_PROVIDERS) {
    const providerId = String(provider.id);

    if (providerId === ALL_PROVIDERS_SCOPE) {
      throw new Error(`Provider id \"${ALL_PROVIDERS_SCOPE}\" is reserved.`);
    }

    if (!Number.isFinite(provider.order)) {
      throw new Error(`Provider \"${providerId}\" has an invalid order value.`);
    }

    if (seenProviderIds.has(providerId)) {
      throw new Error(`Duplicate provider id \"${providerId}\" detected.`);
    }

    seenProviderIds.add(providerId);
  }
}

export function getProviders(): Array<(typeof REGISTERED_PROVIDERS)[number]> {
  return [...REGISTERED_PROVIDERS].sort((left, right) => left.order - right.order);
}

export function getProviderById(providerId: string): ((typeof REGISTERED_PROVIDERS)[number] | undefined) {
  return getProviders().find((provider) => provider.id === providerId);
}

export function getConfiguredProviders(rawAuth: RawAuthJson): Array<(typeof REGISTERED_PROVIDERS)[number]> {
  return getProviders().filter((provider) => provider.resolveAuth(rawAuth) !== undefined);
}

export function getConfiguredProviderOptions(rawAuth: RawAuthJson): ProviderOption[] {
  return getConfiguredProviders(rawAuth).map((provider) => ({
    title: provider.label,
    value: provider.id,
  }));
}

export function getConfiguredProviderScopeOptions(rawAuth: RawAuthJson): ProviderScopeOption[] {
  const configuredOptions = getConfiguredProviderOptions(rawAuth);

  if (configuredOptions.length <= 1) {
    return configuredOptions;
  }

  return [{ title: "All Providers", value: ALL_PROVIDERS_SCOPE }, ...configuredOptions];
}

export function getProviderCommandValue(providerId: ProviderId): string {
  return `plugin.usage.open.${providerId}`;
}

export function getProviderCommands(): ProviderCommand[] {
  return getProviders().map((provider) => ({
    provider: provider.id,
    title: provider.commandTitle,
    value: getProviderCommandValue(provider.id),
  }));
}

export function isProviderId(value: string): value is ProviderId {
  return getProviderById(value) !== undefined;
}

export function isProviderScope(value: string): value is ProviderScope {
  return value === ALL_PROVIDERS_SCOPE || isProviderId(value);
}

export function getProviderScopeLabel(provider: ProviderScope): string {
  if (provider === ALL_PROVIDERS_SCOPE) {
    return "All Providers";
  }

  return getProviderById(provider)?.label ?? provider;
}

export function getProviderScopeLabelFromValue(provider: string): string {
  return isProviderScope(provider) ? getProviderScopeLabel(provider) : provider;
}
