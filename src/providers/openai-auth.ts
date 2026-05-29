import type { RawAuthJson, RawAuthJsonProvider } from "../utils/auth.ts";
import type { OpenAIAuth } from "./openai-types.ts";

function normalizeAuthType(type?: string): string | undefined {
  const normalized = type?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function getStringValue(provider: RawAuthJsonProvider | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = provider?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

export function resolveOpenAIAuth(rawAuth: RawAuthJson): OpenAIAuth | undefined {
  const openai = rawAuth["openai"] ?? rawAuth["chatgpt"];
  if (!openai) {
    return undefined;
  }

  const authType = normalizeAuthType(typeof openai.type === "string" ? openai.type : undefined);
  const accessToken = getStringValue(openai, "access", "accessToken", "token");
  const apiKey = getStringValue(openai, "key");
  const accountId = getStringValue(openai, "accountId");

  if (authType === "api" && apiKey) {
    return { mode: "api", apiKey };
  }

  if (accessToken) {
    return {
      mode: "chatgpt",
      accessToken,
      accountId,
    };
  }

  if (apiKey) {
    return { mode: "api", apiKey };
  }

  return undefined;
}
