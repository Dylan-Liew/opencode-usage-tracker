import type { UsageCard } from "../types.ts";

export const OPENAI_PROVIDER_ID = "openai";
export const OPENAI_PROVIDER_LABEL = "Codex";

export interface OpenAIChatGPTAuth {
  mode: "chatgpt";
  accessToken: string;
  accountId?: string;
  accountKey?: string;
  accountLabel?: string;
}

export interface OpenAIApiKeyAuth {
  mode: "api";
  apiKey: string;
}

export type OpenAIAuth = OpenAIChatGPTAuth | OpenAIApiKeyAuth;

export interface CodexSwitchOAuthRecord {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
}

export interface CodexSwitchAccount {
  id: string;
  email?: string;
  auth: CodexSwitchOAuthRecord;
}

export interface CodexSwitchStore {
  version: 1;
  provider: "openai";
  accounts: CodexSwitchAccount[];
}

export interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

export interface RateLimitBlock {
  primary_window?: RateLimitWindow;
  secondary_window?: RateLimitWindow;
  [key: string]: RateLimitWindow | boolean | undefined;
}

export interface AdditionalRateLimit {
  metered_feature?: string;
  limit_name?: string;
  rate_limit?: RateLimitBlock;
}

export interface CodexUsageResponse {
  plan_type?: string;
  rate_limit?: RateLimitBlock;
  code_review_rate_limit?: RateLimitBlock;
  additional_rate_limits?: AdditionalRateLimit[];
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: string;
  };
}

export interface OpenAIProviderMeta {
  providerId: string;
  provider: string;
}

export type OpenAILimitCard = {
  order: number;
  card: UsageCard | null;
};
