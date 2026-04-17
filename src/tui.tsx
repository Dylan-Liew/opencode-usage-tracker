/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ALL_PROVIDERS_SCOPE,
  getProviderCommands,
  getConfiguredProviderScopeOptions,
  getProviderScopeLabelFromValue,
  isProviderScope,
  type ProviderScope,
} from "./providers/index.ts";
import { fetchUsageResult } from "./usage.ts";
import type { UsageCard, UsageResult, UsageWindow } from "./types.ts";
import { getRawAuthJson } from "./utils/auth.ts";

const PLUGIN_ID = "opencode-usage-tracker";
const BAR_LABEL_WIDTH = 10;
const BAR_TRACK_WIDTH = 28;
const BAR_PERCENT_WIDTH = 4;
const USAGE_COMMAND_SHOW = "plugin.usage.show";
const USAGE_COMMAND_OPEN_PICKER = "plugin.usage.open";
const USAGE_COMMAND_OPEN_ALL = "plugin.usage.open.all";

interface UsageMetaRow {
  label: string;
  value: string;
}

interface UsageSectionView {
  key: string;
  kind: NonNullable<UsageCard["sectionKind"]>;
  label?: string;
  note?: string;
  order: number;
  windows: UsageWindow[];
  rows: UsageMetaRow[];
  error?: string;
}

interface UsageProviderView {
  key: string;
  provider: string;
  planType?: string;
  sections: UsageSectionView[];
}

function usageColor(api: TuiPluginApi, percent: number) {
  if (percent >= 90) return api.theme.current.error;
  if (percent >= 75) return api.theme.current.warning;
  return api.theme.current.primary;
}

function metaRows(section: UsageCard): UsageMetaRow[] {
  const rows: UsageMetaRow[] = [];

  for (const window of section.windows) {
    if (window.resetTime) {
      rows.push({ label: `${window.label} resets`, value: window.resetTime });
    }
  }

  for (const [label, value] of Object.entries(section.extra ?? {})) {
    rows.push({ label, value });
  }

  return rows;
}

function buildProviderViews(cards: UsageCard[]): UsageProviderView[] {
  const groupedProviders = new Map<string, UsageProviderView>();

  for (const card of cards) {
    const providerKey = card.providerId;
    const sectionKey = card.sectionId;
    const sectionKind = card.sectionKind;
    const sectionOrder = card.sectionOrder;
    const existingProvider = groupedProviders.get(providerKey);

    if (existingProvider) {
      if (!existingProvider.planType && card.planType) {
        existingProvider.planType = card.planType;
      }

      existingProvider.sections.push({
        key: sectionKey,
        kind: sectionKind,
        label: card.sectionLabel,
        note: card.note,
        order: sectionOrder,
        windows: card.windows,
        rows: metaRows(card),
        error: card.error,
      });

      continue;
    }

    groupedProviders.set(providerKey, {
      key: providerKey,
      provider: card.provider,
      planType: card.planType,
      sections: [
        {
          key: sectionKey,
          kind: sectionKind,
          label: card.sectionLabel,
          note: card.note,
          order: sectionOrder,
          windows: card.windows,
          rows: metaRows(card),
          error: card.error,
        },
      ],
    });
  }

  return [...groupedProviders.values()].map((provider) => ({
    ...provider,
    sections: [...provider.sections].sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      if (left.kind === right.kind) {
        return 0;
      }

      return left.kind === "main" ? -1 : 1;
    }),
  }));
}

function isErroredProvider(provider: UsageProviderView): boolean {
  const hasErrorSection = provider.sections.some((section) => Boolean(section.error));
  const hasSuccessfulContent = provider.sections.some(
    (section) => !section.error && (section.windows.length > 0 || section.rows.length > 0),
  );

  return hasErrorSection && !hasSuccessfulContent;
}

function isOkResult(result: UsageResult): result is Extract<UsageResult, { kind: "ok" }> {
  return result.kind === "ok";
}

function isMessageResult(result: UsageResult): result is Extract<UsageResult, { message: string }> {
  return result.kind !== "ok";
}

function UsageBar(props: { api: TuiPluginApi; window: UsageWindow }) {
  const theme = props.api.theme.current;
  const percent = Math.round(props.window.usedPercent);
  const filledWidth = Math.max(0, Math.min(BAR_TRACK_WIDTH, Math.round((props.window.usedPercent / 100) * BAR_TRACK_WIDTH)));
  const color = usageColor(props.api, props.window.usedPercent);

  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <text fg={theme.text} width={BAR_LABEL_WIDTH}>
        {props.window.label}
      </text>
      <box width={BAR_TRACK_WIDTH} height={1} flexDirection="row" gap={0} backgroundColor={theme.backgroundElement}>
        <Show when={filledWidth > 0}>
          <box width={filledWidth} height={1} backgroundColor={color} />
        </Show>
      </box>
      <text fg={color} attributes={TextAttributes.BOLD} width={BAR_PERCENT_WIDTH}>
        {`${percent}%`.padStart(BAR_PERCENT_WIDTH, " ")}
      </text>
    </box>
  );
}

function SectionBlock(props: { api: TuiPluginApi; section: UsageSectionView }) {
  const theme = props.api.theme.current;

  return (
    <box flexDirection="column" gap={0}>
      <Show when={props.section.label}>
        <box flexDirection="column" paddingBottom={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.section.label}
          </text>
        </box>
      </Show>
      <Show when={props.section.note}>
        <text fg={theme.textMuted} paddingBottom={1}>
          {props.section.note}
        </text>
      </Show>

      <Show when={!props.section.error} fallback={<text fg={theme.error}>{props.section.error}</text>}>
        <box flexDirection="column" gap={0}>
          <For each={props.section.windows}>
            {(window) => (
              <box paddingBottom={1}>
                <UsageBar api={props.api} window={window} />
              </box>
            )}
          </For>

          <Show when={props.section.rows.length > 0}>
            <box flexDirection="column" gap={0}>
              <For each={props.section.rows}>
                {(row) => (
                  <box flexDirection="row" justifyContent="space-between" gap={2}>
                    <text fg={theme.textMuted}>{row.label}</text>
                    <text fg={theme.text}>{row.value}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>

          <Show when={props.section.windows.length === 0 && props.section.rows.length === 0}>
            <text fg={theme.textMuted}>No usage data reported.</text>
          </Show>
        </box>
      </Show>
    </box>
  );
}

function ProviderCard(props: { api: TuiPluginApi; provider: UsageProviderView }) {
  const theme = props.api.theme.current;

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

      <box flexDirection="column" gap={1}>
        <For each={props.provider.sections}>{(section) => <SectionBlock api={props.api} section={section} />}</For>
      </box>
    </box>
  );
}

function UsageDialog(props: { api: TuiPluginApi; result: UsageResult }) {
  const dimensions = useTerminalDimensions();
  const theme = props.api.theme.current;
  const [showErroredProviders, setShowErroredProviders] = createSignal(false);
  const okResult = () => (isOkResult(props.result) ? props.result : undefined);
  const messageResult = () => (isMessageResult(props.result) ? props.result : undefined);
  const isAllProvidersView = () => props.result.provider === ALL_PROVIDERS_SCOPE;
  const providerViews = createMemo(() => {
    const result = okResult();
    return result ? buildProviderViews(result.providers) : [];
  });
  const hiddenErroredProviders = createMemo(() => {
    if (!isAllProvidersView()) {
      return [] as UsageProviderView[];
    }

    return providerViews().filter(isErroredProvider);
  });
  const visibleProviderViews = createMemo(() => {
    if (!isAllProvidersView() || showErroredProviders()) {
      return providerViews();
    }

    return providerViews().filter((provider) => !isErroredProvider(provider));
  });
  const onlyHiddenErroredProviders = createMemo(
    () => !showErroredProviders() && visibleProviderViews().length === 0 && hiddenErroredProviders().length > 0,
  );

  useKeyboard((event) => {
    if (!okResult() || !isAllProvidersView()) {
      return;
    }

    if (event.eventType !== "press" || event.repeated) {
      return;
    }

    if (event.ctrl || event.meta || event.option || event.shift || event.name !== "h") {
      return;
    }

    if (hiddenErroredProviders().length === 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setShowErroredProviders((current) => !current);
  });

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

      <Show when={okResult() && isAllProvidersView() && hiddenErroredProviders().length > 0 && !showErroredProviders()}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            backgroundColor={RGBA.fromInts(0, 0, 0, 0)}
            borderColor={theme.error}
            borderStyle="rounded"
          >
            <text fg={theme.error}>
              {`${hiddenErroredProviders().length} provider(s) hidden — unable to fetch quota. Press h to show.`}
            </text>
          </box>
        </box>
      </Show>

      <Show when={okResult() && isAllProvidersView() && hiddenErroredProviders().length > 0 && showErroredProviders()}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text fg={theme.textMuted}>{`Showing ${hiddenErroredProviders().length} errored provider(s). Press h to hide.`}</text>
        </box>
      </Show>

      <scrollbox paddingLeft={4} paddingRight={4} maxHeight={Math.max(12, Math.floor(dimensions().height * 0.49))}>
        <Show when={okResult()}>
          <box flexDirection="column" gap={1}>
            <Show when={onlyHiddenErroredProviders()}>
              <box
                padding={1}
                backgroundColor={RGBA.fromInts(0, 0, 0, 0)}
                borderColor={theme.border}
                borderStyle="rounded"
              >
                <text fg={theme.textMuted}>All visible providers are hidden. Press h to show errored providers.</text>
              </box>
            </Show>
            <For each={visibleProviderViews()}>{(provider) => <ProviderCard api={props.api} provider={provider} />}</For>
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

async function openPicker(api: TuiPluginApi): Promise<void> {
  const rawAuth = await getRawAuthJson();
  const options = rawAuth ? getConfiguredProviderScopeOptions(rawAuth) : [];

  if (options.length === 0) {
    await openUsage(api, ALL_PROVIDERS_SCOPE);
    return;
  }

  if (options.length === 1) {
    const onlyOption = options[0];
    if (!onlyOption) {
      return;
    }

    await openUsage(api, onlyOption.value);
    return;
  }

  const DialogSelect = api.ui.DialogSelect;
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="Usage"
      placeholder="Choose provider"
      options={options}
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
        void openPicker(api);
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
        void openPicker(api);
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
