import { Plugin } from "@opencode/plugin";
import type { Plugin as PluginTypes } from "@opencode/plugin";
import { usageRpc } from "./rpc.ts";
import { getConfiguredProviderScopeOptions, isProviderScope } from "./providers/index.ts";
import { fetchUsageResult } from "./usage.ts";
import type { RawAuthJson } from "./utils/auth.ts";

export async function readCredentials(ctx: PluginTypes.Context): Promise<RawAuthJson> {
  const result: RawAuthJson = {};
  for (const integration of (await ctx.integration.list()).data) {
    try {
      const connection = await ctx.integration.connection.active(integration.id);
      if (!connection) continue;
      const value = await ctx.integration.connection.resolve(connection);
      if (!value) continue;
      result[integration.id] = value.type === "key"
        ? { type: "api", key: value.key, ...value.metadata }
        : { ...value, ...value.metadata, accountId: value.metadata?.accountID };
    } catch {
      // An unavailable optional integration must not hide usage for connected providers.
    }
  }
  return result;
}

export default Plugin.define({
  id: "opencode-usage-tracker",
  async setup(ctx) {
    await ctx.rpc.register(usageRpc, {
      providers: async () => getConfiguredProviderScopeOptions(await readCredentials(ctx)),
      usage: async (input) => {
        const { provider } = input as { provider: string };
        if (!isProviderScope(provider)) throw new Error("Unknown usage provider");
        return fetchUsageResult(provider, await readCredentials(ctx));
      },
    });
  },
});
