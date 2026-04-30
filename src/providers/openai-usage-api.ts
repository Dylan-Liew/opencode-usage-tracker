import type { UsageCard } from "../types.ts";
import { fetchJsonResponseWithTimeout, getFetchErrorMessage } from "../utils/http.ts";
import { buildErrorCard, buildUsageCards } from "./openai-cards.ts";
import { normalizeSectionId } from "./openai-format.ts";
import { OPENAI_PROVIDER_ID, OPENAI_PROVIDER_LABEL, type CodexUsageResponse, type OpenAIChatGPTAuth, type OpenAIProviderMeta } from "./openai-types.ts";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_TIMEOUT_MS = 5000;

export function getChatGPTProviderMeta(auth: OpenAIChatGPTAuth): OpenAIProviderMeta {
  if (!auth.accountKey && !auth.accountLabel) {
    return { providerId: OPENAI_PROVIDER_ID, provider: OPENAI_PROVIDER_LABEL };
  }

  const accountKey = normalizeSectionId(auth.accountKey ?? auth.accountLabel ?? "account");
  const accountLabel = auth.accountLabel ?? auth.accountId ?? "Account";
  return {
    providerId: `${OPENAI_PROVIDER_ID}:${accountKey}`,
    provider: `${OPENAI_PROVIDER_LABEL} (${accountLabel})`,
  };
}

export async function fetchChatGPTUsage(auth: OpenAIChatGPTAuth): Promise<UsageCard[]> {
  const providerMeta = getChatGPTProviderMeta(auth);

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
      USAGE_ENDPOINT,
      {
        method: "GET",
        headers,
      },
      USAGE_TIMEOUT_MS,
    );

    if (response.status === 401) {
      return [buildErrorCard(providerMeta, "Token expired or invalid")];
    }

    if (response.status === 403) {
      return [buildErrorCard(providerMeta, "Access denied (account ID may be required)")];
    }

    if (!response.ok) {
      return [buildErrorCard(providerMeta, `HTTP ${response.status}`)];
    }

    if (!data) {
      return [buildErrorCard(providerMeta, "Usage response was empty")];
    }

    return buildUsageCards(data, providerMeta);
  } catch (error) {
    return [buildErrorCard(providerMeta, getFetchErrorMessage(error))];
  }
}
