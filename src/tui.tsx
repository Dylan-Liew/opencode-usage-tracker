/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createEffect, For, Show } from "solid-js";
import {
  ALL_PROVIDERS_SCOPE,
  getProviderCommands,
  getProviderScopeOptions,
  getProviderScopeLabelFromValue,
  isProviderScope,
  type ProviderScope,
} from "./providers/index.ts";
import { fetchUsageResult } from "./usage.ts";
import type { UsageCard, UsageResult, UsageWindow } from "./types.ts";

const PLUGIN_ID = "opencode-usage-tracker";
const BAR_WIDTH = 24;
const USAGE_COMMAND_SHOW = "plugin.usage.show";
const USAGE_COMMAND_OPEN_PICKER = "plugin.usage.open";
const USAGE_COMMAND_OPEN_ALL = "plugin.usage.open.all";

const PICKER_OPTIONS = getProviderScopeOptions();

function usageColor(api: TuiPluginApi, percent: number) {
  if (percent >= 90) return api.theme.current.error;
  if (percent >= 75) return api.theme.current.warning;
  return api.theme.current.primary;
}

function metaRows(provider: UsageCard): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];

  for (const window of provider.windows) {
    if (window.resetTime) {
      rows.push({ label: `${window.label} resets`, value: window.resetTime });
    }
  }

  for (const [label, value] of Object.entries(provider.extra ?? {})) {
    rows.push({ label, value });
  }

  return rows;
}

function isOkResult(result: UsageResult): result is Extract<UsageResult, { kind: "ok" }> {
  return result.kind === "ok";
}

function isMessageResult(result: UsageResult): result is Extract<UsageResult, { message: string }> {
  return result.kind !== "ok";
}

function UsageBar(props: { api: TuiPluginApi; window: UsageWindow }) {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round((props.window.usedPercent / 100) * BAR_WIDTH)));
  const empty = BAR_WIDTH - filled;
  const color = usageColor(props.api, props.window.usedPercent);

  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <text fg={props.api.theme.current.text} width={10}>
        {props.window.label}
      </text>
      <box flexDirection="row" gap={0}>
        <text fg={color}>{"█".repeat(filled)}</text>
        <text fg={props.api.theme.current.border}>{"░".repeat(empty)}</text>
      </box>
      <text fg={color} attributes={TextAttributes.BOLD}>
        {`${Math.round(props.window.usedPercent)}%`}
      </text>
    </box>
  );
}

function ProviderCard(props: { api: TuiPluginApi; provider: UsageCard }) {
  const theme = props.api.theme.current;
  const rows = metaRows(props.provider);
  const lastWindowIndex = props.provider.windows.length - 1;

  return (
    <box
      flexDirection="column"
      gap={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background}
      borderColor={theme.border}
      borderStyle="rounded"
    >
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.provider.provider}
        </text>
        <Show when={props.provider.planType}>
          <text fg={theme.textMuted}>{props.provider.planType}</text>
        </Show>
      </box>

      <Show
        when={!props.provider.error}
        fallback={<text fg={theme.error}>{props.provider.error}</text>}
      >
        <box flexDirection="column" gap={0}>
          <For each={props.provider.windows}>
            {(window, index) => (
              <box paddingBottom={index() === lastWindowIndex ? 1 : 1}>
                <UsageBar api={props.api} window={window} />
              </box>
            )}
          </For>
          <Show when={rows.length > 0}>
            <box flexDirection="column" gap={0}>
              <For each={rows}>
                {(row) => (
                  <box flexDirection="row" justifyContent="space-between" gap={2}>
                    <text fg={theme.textMuted}>{row.label}</text>
                    <text fg={theme.text}>{row.value}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <Show when={props.provider.windows.length === 0 && rows.length === 0}>
            <text fg={theme.textMuted}>No usage windows reported.</text>
          </Show>
        </box>
      </Show>
    </box>
  );
}

function UsageDialog(props: { api: TuiPluginApi; result: UsageResult }) {
  const dimensions = useTerminalDimensions();
  const theme = props.api.theme.current;
  const okResult = () => (isOkResult(props.result) ? props.result : undefined);
  const messageResult = () => (isMessageResult(props.result) ? props.result : undefined);

  createEffect(() => {
    const width = dimensions().width;
    if (width >= 128) {
      props.api.ui.dialog.setSize("xlarge");
      return;
    }
    if (width >= 96) {
      props.api.ui.dialog.setSize("large");
      return;
    }
    props.api.ui.dialog.setSize("medium");
  });

  return (
    <box gap={0} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              Usage Tracker
            </text>
            <text fg={theme.textMuted}>{getProviderScopeLabelFromValue(props.result.provider)}</text>
          </box>
          <text fg={theme.textMuted} onMouseUp={() => props.api.ui.dialog.clear()}>
            esc
          </text>
        </box>
      </box>

      <scrollbox paddingLeft={4} paddingRight={4} maxHeight={Math.max(12, Math.floor(dimensions().height * 0.49))}>
        <Show when={okResult()}>
          <box flexDirection="column" gap={0}>
            <For each={okResult()?.providers ?? []}>{(provider) => <ProviderCard api={props.api} provider={provider} />}</For>
          </box>
        </Show>
        <Show when={messageResult()}>
          <box
            padding={1}
            backgroundColor={RGBA.fromInts(0, 0, 0, 0)}
            borderColor={theme.border}
            borderStyle="rounded"
          >
            <text fg={messageResult()?.kind === "error" ? theme.error : theme.textMuted}>
              {messageResult()?.message ?? ""}
            </text>
          </box>
        </Show>
      </scrollbox>
    </box>
  );
}

function openResultDialog(api: TuiPluginApi, result: UsageResult): void {
  api.ui.dialog.replace(() => <UsageDialog api={api} result={result} />);
}

function openPicker(api: TuiPluginApi): void {
  const DialogSelect = api.ui.DialogSelect;
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="Usage"
      placeholder="Choose provider"
      options={PICKER_OPTIONS}
      onSelect={(option) => {
        api.ui.dialog.clear();

        if (!isProviderScope(option.value)) {
          api.ui.toast({
            message: `Unknown provider: ${option.value}`,
            variant: "error",
            duration: 2500,
          });
          return;
        }

        void openUsage(api, option.value);
      }}
    />
  ));
}

async function openUsage(api: TuiPluginApi, provider: ProviderScope): Promise<void> {
  api.ui.toast({
    message: "Fetching usage data...",
    variant: "info",
    duration: 2000,
  });

  try {
    const result = await fetchUsageResult(provider);
    openResultDialog(api, result);
  } catch (error) {
    openResultDialog(api, {
      kind: "error",
      provider,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    {
      title: "Usage",
      value: USAGE_COMMAND_SHOW,
      category: "Plugin",
      slash: { name: "usage" },
      onSelect: () => {
        openPicker(api);
      },
    },
    {
      title: "Usage",
      value: USAGE_COMMAND_OPEN_ALL,
      category: "Plugin",
      hidden: true,
      onSelect: () => {
        void openUsage(api, ALL_PROVIDERS_SCOPE);
      },
    },
    {
      title: "Usage Select",
      value: USAGE_COMMAND_OPEN_PICKER,
      category: "Plugin",
      hidden: true,
      onSelect: () => {
        openPicker(api);
      },
    },
    ...getProviderCommands().map(({ provider, title, value }) => ({
      title,
      value,
      category: "Plugin" as const,
      hidden: true,
      onSelect: () => {
        void openUsage(api, provider);
      },
    })),
  ]);
};

const module: TuiPluginModule & { id: string } = {
  id: PLUGIN_ID,
  tui,
};

export default module;
