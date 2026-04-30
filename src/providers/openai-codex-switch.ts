import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import type { CodexSwitchAccount, CodexSwitchOAuthRecord, CodexSwitchStore, OpenAIChatGPTAuth } from "./openai-types.ts";

function getDataHomePaths(): string[] {
  const home = homedir();
  const paths: string[] = [];

  if (process.env.XDG_DATA_HOME) {
    paths.push(process.env.XDG_DATA_HOME);
  }

  paths.push(join(home, ".local", "share"), join(home, "Library", "Application Support"));
  return paths;
}

function isCodexSwitchOAuthRecord(value: unknown): value is CodexSwitchOAuthRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.type === "oauth" && typeof candidate.access === "string" && candidate.access.length > 0;
}

function isCodexSwitchAccount(value: unknown): value is CodexSwitchAccount {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && isCodexSwitchOAuthRecord(candidate.auth);
}

function isCodexSwitchStore(value: unknown): value is CodexSwitchStore {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.version === 1 && candidate.provider === "openai" && Array.isArray(candidate.accounts);
}

export async function readCodexSwitchAccounts(): Promise<CodexSwitchAccount[]> {
  for (const dataHome of getDataHomePaths()) {
    try {
      const content = await readFile(join(dataHome, "opencode", "codex-switch.json"), "utf-8");
      const parsed = JSON.parse(content) as unknown;
      if (isCodexSwitchStore(parsed)) {
        return parsed.accounts.filter(isCodexSwitchAccount);
      }
    } catch {
      continue;
    }
  }

  return [];
}

export function toOpenAIChatGPTAuth(account: CodexSwitchAccount, index: number): OpenAIChatGPTAuth {
  return {
    mode: "chatgpt",
    accessToken: account.auth.access,
    accountId: account.auth.accountId,
    accountKey: account.id || account.auth.accountId || `account-${index + 1}`,
    accountLabel: account.email ?? account.auth.accountId ?? `Account ${index + 1}`,
  };
}
