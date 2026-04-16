/**
 * OpenCode Usage Tracker Plugin (server hooks)
 *
 * Handles /usage slash command and opens the TUI command dialog entry
 * exposed by the companion TUI plugin.
 */

import type { Hooks, PluginInput } from "@opencode-ai/plugin";

const HANDLED_SENTINEL = "__USAGE_TRACKER_HANDLED__";
const USAGE_COMMAND_OPEN_PICKER = "plugin.usage.open";

function isUsageCommand(command: string): boolean {
  return command.replace(/^\//, "") === "usage";
}

export async function UsageTrackerPlugin(
  { client }: PluginInput,
): Promise<Hooks> {
  return {
    "command.execute.before": async (input, output) => {
      if (!isUsageCommand(input.command)) {
        return;
      }

      try {
        const result = await client.tui.executeCommand({
          body: { command: USAGE_COMMAND_OPEN_PICKER },
        });

        if (result.error || result.data !== true) {
          await client.tui.showToast({
            body: {
              title: "Usage",
              message: "Usage dialog command was not accepted by the TUI.",
              variant: "warning",
            },
          });
        }
      } catch {
        await client.tui.showToast({
          body: {
            title: "Usage",
            message: "Usage dialog unavailable. Install/load the TUI plugin in tui.json or via `opencode plugin opencode-usage-tracker`.",
            variant: "warning",
          },
        });
      }

      return stopCommandFlow(output);
    },
  };
}

function stopCommandFlow(output: { parts: unknown[] }): void {
  void output;
  throw new Error(HANDLED_SENTINEL);
}
