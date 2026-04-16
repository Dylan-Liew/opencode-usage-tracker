import type { RawAuthJson } from "./utils/auth.ts";

export interface UsageWindow {
  label: string;
  usedPercent: number;
  resetTime?: string;
  limit?: number;
  remaining?: number;
  used?: number;
  unit?: string;
  source?: "endpoint" | "header" | "computed";
  rawResetAt?: string;
}

export interface UsageCard {
  providerId?: string;
  provider: string;
  planType?: string;
  windows: UsageWindow[];
  extra?: Record<string, string>;
  error?: string;
}

export type UsageResult =
  | { kind: "ok"; provider: string | "all"; providers: UsageCard[] }
  | { kind: "empty"; provider: string | "all"; message: string }
  | { kind: "error"; provider: string | "all"; message: string };

export interface UsageProviderDefinition {
  id: string;
  label: string;
  commandTitle: string;
  order: number;
  resolveAuth: (rawAuth: RawAuthJson) => unknown | undefined;
  fetchFromRawAuth: (rawAuth: RawAuthJson) => Promise<UsageCard[]>;
}
