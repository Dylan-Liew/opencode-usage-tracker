/** @jsxImportSource @opentui/solid */
import { RGBA, TextAttributes } from "@opentui/core";
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ALL_PROVIDERS_SCOPE,
  getConfiguredProviderScopeOptions,
  getProviderScopeLabelFromValue,
  type ProviderScope,
} from "./providers/index.ts";
import type { UsageCard, UsageResult, UsageWindow } from "./types.ts";
import { fetchUsageResult } from "./usage.ts";
import { getRawAuthJson } from "./utils/auth.ts";

const PLUGIN_ID = "opencode-usage-tracker";
const USAGE_COMMAND_SHOW = "plugin.usage.show";
const BAR_LABEL_WIDTH = 10;
const BAR_LABEL_MAX_WIDTH = 18;
const BAR_PERCENT_WIDTH = 4;

interface UsageBarLayout {
  trackWidth: number;
}

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

function getUsageBarLayout(terminalWidth: number): UsageBarLayout {
  return { trackWidth: terminalWidth >= 128 ? 40 : terminalWidth >= 96 ? 28 : 18 };
}

export function getUsageBarSegments(percent: number, width: number): { filled: string; remaining: string } {
  const filledWidth = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width);
  return {
    filled: "█".repeat(filledWidth),
    remaining: "░".repeat(width - filledWidth),
  };
}

export function getUsageBarHue(percent: number): "green" | "orange" | "red" {
  if (percent >= 90) return "red";
  if (percent >= 75) return "orange";
  return "green";
}

function getUsageBarLabelWidth(windows: UsageWindow[]): number {
  return windows.reduce(
    (width, window) => Math.max(width, Math.min(BAR_LABEL_MAX_WIDTH, Math.max(BAR_LABEL_WIDTH, window.label.length))),
    BAR_LABEL_WIDTH,
  );
}

function metaRows(section: UsageCard): UsageMetaRow[] {
  return [
    ...section.windows.flatMap((window) =>
      window.resetTime ? [{ label: `${window.label} resets`, value: window.resetTime }] : [],
    ),
    ...Object.entries(section.extra ?? {}).map(([label, value]) => ({ label, value })),
  ];
}

function buildProviderViews(cards: UsageCard[]): UsageProviderView[] {
  const providers = new Map<string, UsageProviderView>();

  for (const card of cards) {
    const section: UsageSectionView = {
      key: card.sectionId,
      kind: card.sectionKind,
      label: card.sectionLabel,
      note: card.note,
      order: card.sectionOrder,
      windows: card.windows,
      rows: metaRows(card),
      error: card.error,
    };
    const provider = providers.get(card.providerId);
    if (provider) {
      provider.planType ||= card.planType;
      provider.sections.push(section);
    } else {
      providers.set(card.providerId, {
        key: card.providerId,
        provider: card.provider,
        planType: card.planType,
        sections: [section],
      });
    }
  }

  return [...providers.values()].map((provider) => ({
    ...provider,
    sections: provider.sections.sort((left, right) => left.order - right.order || (left.kind === "main" ? -1 : 1)),
  }));
}

function isErroredProvider(provider: UsageProviderView): boolean {
  return (
    provider.sections.some((section) => Boolean(section.error)) &&
    !provider.sections.some((section) => !section.error && (section.windows.length > 0 || section.rows.length > 0))
  );
}

function UsageBar(props: { context: Context; window: UsageWindow; layout: UsageBarLayout; labelWidth: number }) {
  const theme = props.context.theme;
  const percent = Math.max(0, Math.min(100, Math.round(props.window.usedPercent)));
  const tone = props.context.themeMode === "dark" ? 300 : 700;
  const color = theme.hue[getUsageBarHue(percent)][tone];
  const segments = () => getUsageBarSegments(percent, props.layout.trackWidth);

  return (
    <box width="100%" maxWidth="100%" flexDirection="row" alignItems="center" gap={1}>
      <text fg={theme.text.default} width={props.labelWidth} minWidth={BAR_LABEL_WIDTH} maxWidth={BAR_LABEL_MAX_WIDTH} flexShrink={0}>
        {props.window.label}
      </text>
      <box
        width={props.layout.trackWidth}
        flexDirection="row"
        flexShrink={0}
        gap={0}
      >
        <text fg={color}>{segments().filled}</text>
        <text fg={theme.text.subdued}>{segments().remaining}</text>
      </box>
      <text fg={color} attributes={TextAttributes.BOLD} width={BAR_PERCENT_WIDTH} minWidth={BAR_PERCENT_WIDTH} flexShrink={0}>
        {`${percent}%`.padStart(BAR_PERCENT_WIDTH, " ")}
      </text>
    </box>
  );
}

function SectionBlock(props: { context: Context; section: UsageSectionView; barLayout: UsageBarLayout }) {
  const theme = props.context.theme;
  const labelWidth = createMemo(() => getUsageBarLabelWidth(props.section.windows));

  return (
    <box width="100%" maxWidth="100%" flexDirection="column" gap={0}>
      <Show when={props.section.label}>
        <box flexDirection="column" paddingBottom={1}>
          <text fg={theme.text.default} attributes={TextAttributes.BOLD}>{props.section.label}</text>
        </box>
      </Show>
      <Show when={props.section.note}>
        <text fg={theme.text.subdued} paddingBottom={1}>{props.section.note}</text>
      </Show>
      <Show
        when={!props.section.error}
        fallback={<text fg={theme.text.feedback.error.default}>{props.section.error}</text>}
      >
        <box flexDirection="column" gap={0}>
          <For each={props.section.windows}>
            {(window) => (
              <box width="100%" maxWidth="100%" paddingBottom={1}>
                <UsageBar context={props.context} window={window} layout={props.barLayout} labelWidth={labelWidth()} />
              </box>
            )}
          </For>
          <Show when={props.section.rows.length > 0}>
            <box flexDirection="column" gap={0}>
              <For each={props.section.rows}>
                {(row) => (
                  <box flexDirection="row" justifyContent="space-between" gap={2}>
                    <text fg={theme.text.subdued}>{row.label}</text>
                    <text fg={theme.text.default}>{row.value}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
          <Show when={props.section.windows.length === 0 && props.section.rows.length === 0}>
            <text fg={theme.text.subdued}>No usage data reported.</text>
          </Show>
        </box>
      </Show>
    </box>
  );
}

function ProviderCard(props: { context: Context; provider: UsageProviderView; barLayout: UsageBarLayout }) {
  const theme = props.context.theme;
  return (
    <box
      width="100%"
      maxWidth="100%"
      flexDirection="column"
      gap={0}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.background.default}
      borderColor={theme.border.default}
      borderStyle="rounded"
    >
      <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>{props.provider.provider}</text>
        <Show when={props.provider.planType}>
          <text fg={theme.text.subdued}>{props.provider.planType}</text>
        </Show>
      </box>
      <box width="100%" maxWidth="100%" flexDirection="column" gap={1}>
        <For each={props.provider.sections}>
          {(section) => <SectionBlock context={props.context} section={section} barLayout={props.barLayout} />}
        </For>
      </box>
    </box>
  );
}

function UsageDialog(props: { context: Context; result: UsageResult }) {
  const dimensions = useTerminalDimensions();
  const theme = props.context.theme;
  const [showErroredProviders, setShowErroredProviders] = createSignal(false);
  const okResult = () => (props.result.kind === "ok" ? props.result : undefined);
  const messageResult = () => (props.result.kind !== "ok" ? props.result : undefined);
  const isAllProvidersView = () => props.result.provider === ALL_PROVIDERS_SCOPE;
  const providerViews = createMemo(() => (okResult() ? buildProviderViews(okResult()!.providers) : []));
  const hiddenErroredProviders = createMemo(() =>
    isAllProvidersView() ? providerViews().filter(isErroredProvider) : [],
  );
  const visibleProviderViews = createMemo(() =>
    !isAllProvidersView() || showErroredProviders()
      ? providerViews()
      : providerViews().filter((provider) => !isErroredProvider(provider)),
  );
  const onlyHiddenErroredProviders = createMemo(
    () => !showErroredProviders() && visibleProviderViews().length === 0 && hiddenErroredProviders().length > 0,
  );
  const barLayout = createMemo(() => getUsageBarLayout(dimensions().width));

  props.context.keymap.layer(() => ({
    commands: [
      {
        bind: "h",
        enabled: () => Boolean(okResult() && isAllProvidersView() && hiddenErroredProviders().length),
        run() {
          setShowErroredProviders((current) => !current);
        },
      },
    ],
  }));

  createEffect(() => {
    props.context.ui.dialog.set({
      size: dimensions().width >= 128 ? "xlarge" : dimensions().width >= 96 ? "large" : "medium",
    });
  });

  return (
    <box gap={0} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" gap={1}>
            <text fg={theme.text.default} attributes={TextAttributes.BOLD}>Usage Tracker</text>
            <text fg={theme.text.subdued}>{getProviderScopeLabelFromValue(props.result.provider)}</text>
          </box>
          <text fg={theme.text.subdued} onMouseUp={() => props.context.ui.dialog.clear()}>esc</text>
        </box>
      </box>

      <Show when={okResult() && isAllProvidersView() && hiddenErroredProviders().length > 0 && !showErroredProviders()}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <box paddingLeft={1} paddingRight={1} backgroundColor={RGBA.fromInts(0, 0, 0, 0)} borderColor={theme.text.feedback.error.default} borderStyle="rounded">
            <text fg={theme.text.feedback.error.default}>
              {`${hiddenErroredProviders().length} provider(s) hidden — unable to fetch quota. Press h to show.`}
            </text>
          </box>
        </box>
      </Show>
      <Show when={okResult() && isAllProvidersView() && hiddenErroredProviders().length > 0 && showErroredProviders()}>
        <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
          <text fg={theme.text.subdued}>{`Showing ${hiddenErroredProviders().length} errored provider(s). Press h to hide.`}</text>
        </box>
      </Show>

      <scrollbox paddingLeft={4} paddingRight={4} maxHeight={Math.max(12, Math.floor(dimensions().height * 0.49))}>
        <Show when={okResult()}>
          <box width="100%" maxWidth="100%" flexDirection="column" gap={1}>
            <Show when={onlyHiddenErroredProviders()}>
              <box padding={1} backgroundColor={RGBA.fromInts(0, 0, 0, 0)} borderColor={theme.border.default} borderStyle="rounded">
                <text fg={theme.text.subdued}>All visible providers are hidden. Press h to show errored providers.</text>
              </box>
            </Show>
            <For each={visibleProviderViews()}>
              {(provider) => <ProviderCard context={props.context} provider={provider} barLayout={barLayout()} />}
            </For>
          </box>
        </Show>
        <Show when={messageResult()}>
          <box padding={1} backgroundColor={RGBA.fromInts(0, 0, 0, 0)} borderColor={theme.border.default} borderStyle="rounded">
            <text fg={messageResult()?.kind === "error" ? theme.text.feedback.error.default : theme.text.subdued}>
              {messageResult()?.message ?? ""}
            </text>
          </box>
        </Show>
      </scrollbox>
    </box>
  );
}

function openResultDialog(context: Context, result: UsageResult): void {
  context.ui.dialog.show(() => <UsageDialog context={context} result={result} />);
}

async function openUsage(context: Context, provider: ProviderScope): Promise<void> {
  context.ui.toast.show({ message: "Fetching usage data...", variant: "info", duration: 2000 });
  try {
    openResultDialog(context, await fetchUsageResult(provider));
  } catch (error) {
    openResultDialog(context, {
      kind: "error",
      provider,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function openPicker(context: Context): Promise<void> {
  const rawAuth = await getRawAuthJson();
  const options = rawAuth ? getConfiguredProviderScopeOptions(rawAuth) : [];
  if (options.length < 2) {
    await openUsage(context, options[0]?.value ?? ALL_PROVIDERS_SCOPE);
    return;
  }
  const provider = await context.ui.dialog.select({ title: "Usage", placeholder: "Choose provider", options });
  if (provider) await openUsage(context, provider);
}

function Commands(props: { context: Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: USAGE_COMMAND_SHOW,
        title: "Usage",
        group: "Plugin",
        palette: true,
        slash: { name: "usage" },
        run: () => openPicker(props.context),
      },
    ],
  }));
  return null;
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup(context) {
    return context.ui.slot({ append: "app", render: () => <Commands context={context} /> });
  },
});
