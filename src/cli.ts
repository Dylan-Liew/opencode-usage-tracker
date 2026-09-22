import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import {
  ALL_PROVIDERS_SCOPE,
  getConfiguredProviderScopeOptions,
  getProviderScopeLabelFromValue,
  type ProviderScope,
} from "./providers/index.ts";
import type { UsageResult } from "./types.ts";
import { fetchUsageResult } from "./usage.ts";
import { getRawAuthJson } from "./utils/auth.ts";
import { formatUsageTable } from "./utils/format.ts";

const PLUGIN_ID = "opencode-usage-tracker";
const USAGE_COMMAND_SHOW = "plugin.usage.show";

function formatResult(result: UsageResult): string {
  return result.kind === "ok" ? formatUsageTable(result.providers) : result.message;
}

async function openUsage(context: Context): Promise<void> {
  const rawAuth = await getRawAuthJson();
  const options = rawAuth ? getConfiguredProviderScopeOptions(rawAuth) : [];
  let provider: ProviderScope = ALL_PROVIDERS_SCOPE;

  if (options.length === 1 && options[0]) {
    provider = options[0].value;
  } else if (options.length > 1) {
    const selected = await context.ui.dialog.select({
      title: "Usage",
      placeholder: "Choose provider",
      options,
    });
    if (!selected) return;
    provider = selected;
  }

  context.ui.toast.show({ message: "Fetching usage data...", variant: "info", duration: 2000 });

  try {
    const result = await fetchUsageResult(provider);
    await context.ui.dialog.alert({
      title: `Usage Tracker — ${getProviderScopeLabelFromValue(result.provider)}`,
      message: formatResult(result),
    });
  } catch (error) {
    await context.ui.dialog.alert({
      title: "Usage Tracker",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    return context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: USAGE_COMMAND_SHOW,
              title: "Usage",
              group: "Plugin",
              palette: true,
              slash: { name: "usage" },
              run: () => openUsage(context),
            },
          ],
        }));
        return null;
      },
    });
  },
});
