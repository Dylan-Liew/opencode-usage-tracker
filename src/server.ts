import type { Hooks, PluginInput, PluginModule } from "@opencode-ai/plugin";

/**
 * Server-side bridge for `/usage`.
 *
 * The TUI owns the actual usage UI, but we keep a thin server hook so older
 * installs and non-TUI command paths can still forward `/usage` into the TUI
 * command when available.
 */
const HANDLED_SENTINEL = "__USAGE_TRACKER_HANDLED__";
const USAGE_COMMAND_OPEN_PICKER = "plugin.usage.open";

function isUsageCommand(command: string): boolean {
  return command.replace(/^\//, "") === "usage";
}

export async function UsageTrackerPlugin({ client }: PluginInput): Promise<Hooks> {
  return {
    "command.execute.before": async (input, output) => {
      if (!isUsageCommand(input.command)) {
        return;
      }

      let result;
      try {
        result = await client.tui.executeCommand({
          body: { command: USAGE_COMMAND_OPEN_PICKER },
        });
      } catch {
        throw new Error(
          "Usage dialog unavailable. Make sure an OpenCode TUI session is running and the usage plugin is loaded.",
        );
      }

      if (result.error || result.data !== true) {
        const message = "Usage dialog could not be opened by the TUI. Ensure the TUI plugin is loaded and try again.";

        await client.tui.showToast({
          body: {
            title: "Usage",
            message,
            variant: "warning",
          },
        });

        throw new Error(message);
      }

      return stopCommandFlow(output);
    },
  };
}

function stopCommandFlow(output: { parts: unknown[] }): void {
  void output;
  throw new Error(HANDLED_SENTINEL);
}

const module: PluginModule & { id: string } = {
  id: "opencode-usage-tracker",
  server: UsageTrackerPlugin,
};

export default module;
