/**
 * Codex usage provider
 *
 * ChatGPT auth usage endpoint: https://chatgpt.com/backend-api/wham/usage
 * OpenAI API key mode does not expose the same subscription usage windows.
 */

import type { UsageCard, UsageProviderDefinition } from "../types.ts";
import { resolveOpenAIAuth } from "./openai-auth.ts";
import { buildErrorCard } from "./openai-cards.ts";
import { readCodexSwitchAccounts, toOpenAIChatGPTAuth } from "./openai-codex-switch.ts";
import { OPENAI_PROVIDER_ID, OPENAI_PROVIDER_LABEL, type OpenAIAuth } from "./openai-types.ts";
import { fetchChatGPTUsage, getChatGPTProviderMeta } from "./openai-usage-api.ts";

const PROVIDER_COMMAND_TITLE = "Usage Codex";

async function fetchOpenAIUsage(auth: OpenAIAuth): Promise<UsageCard[]> {
  if (auth.mode === "api") {
    return [
      {
        providerId: OPENAI_PROVIDER_ID,
        provider: OPENAI_PROVIDER_LABEL,
        sectionId: "main",
        sectionKind: "main",
        sectionOrder: 10,
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

  return fetchChatGPTUsage(auth);
}

export const openAIProvider = {
  id: OPENAI_PROVIDER_ID,
  label: OPENAI_PROVIDER_LABEL,
  commandTitle: PROVIDER_COMMAND_TITLE,
  order: 10,
  resolveAuth: resolveOpenAIAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveOpenAIAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    if (auth.mode === "chatgpt") {
      const accounts = await readCodexSwitchAccounts();
      if (accounts.length > 1) {
        const settled = await Promise.allSettled(
          accounts.map((account, index) => fetchChatGPTUsage(toOpenAIChatGPTAuth(account, index))),
        );

        return settled.flatMap((result, index) => {
          if (result.status === "fulfilled") {
            return result.value;
          }

          const fallbackAuth = toOpenAIChatGPTAuth(accounts[index]!, index);
          const providerMeta = getChatGPTProviderMeta(fallbackAuth);
          const error = result.reason instanceof Error ? result.reason.message : "Unknown error";
          return [buildErrorCard(providerMeta, error)];
        });
      }
    }

    return fetchOpenAIUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
