import { jsxDEV as jsxDEV_7x81h0kn } from "@opentui/solid/jsx-dev-runtime";
import { RGBA, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ALL_PROVIDERS_SCOPE,
  getProviderCommands,
  getConfiguredProviderScopeOptions,
  getProviderScopeLabelFromValue,
  isProviderScope
} from "./providers/index.ts";
import { fetchUsageResult } from "./usage.ts";
import { getRawAuthJson } from "./utils/auth.ts";
const PLUGIN_ID = "opencode-usage-tracker";
const BAR_LABEL_WIDTH = 10;
const BAR_LABEL_MAX_WIDTH = 18;
const BAR_PERCENT_WIDTH = 4;
const BAR_TRACK_MIN_WIDTH = 12;
const USAGE_COMMAND_SHOW = "plugin.usage.show";
const USAGE_COMMAND_OPEN_PICKER = "plugin.usage.open";
const USAGE_COMMAND_OPEN_ALL = "plugin.usage.open.all";
function getUsageBarLayout(terminalWidth) {
  if (terminalWidth >= 128) {
    return {
      trackWidth: "60%",
      trackMinWidth: 18
    };
  }
  if (terminalWidth >= 96) {
    return {
      trackWidth: "56%",
      trackMinWidth: 16
    };
  }
  return {
    trackWidth: "52%",
    trackMinWidth: BAR_TRACK_MIN_WIDTH
  };
}
function getUsageBarLabelWidth(windows) {
  return windows.reduce((maxWidth, window) => {
    const nextWidth = Math.min(BAR_LABEL_MAX_WIDTH, Math.max(BAR_LABEL_WIDTH, window.label.length));
    return Math.max(maxWidth, nextWidth);
  }, BAR_LABEL_WIDTH);
}
function usageColor(api, percent) {
  if (percent >= 90)
    return api.theme.current.error;
  if (percent >= 75)
    return api.theme.current.warning;
  return api.theme.current.primary;
}
function metaRows(section) {
  const rows = [];
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
function buildProviderViews(cards) {
  const groupedProviders = new Map;
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
        error: card.error
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
          error: card.error
        }
      ]
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
    })
  }));
}
function isErroredProvider(provider) {
  const hasErrorSection = provider.sections.some((section) => Boolean(section.error));
  const hasSuccessfulContent = provider.sections.some((section) => !section.error && (section.windows.length > 0 || section.rows.length > 0));
  return hasErrorSection && !hasSuccessfulContent;
}
function isOkResult(result) {
  return result.kind === "ok";
}
function isMessageResult(result) {
  return result.kind !== "ok";
}
function UsageBar(props) {
  const theme = props.api.theme.current;
  const percent = Math.max(0, Math.min(100, Math.round(props.window.usedPercent)));
  const color = usageColor(props.api, percent);
  return /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
    width: "100%",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
    children: [
      /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
        fg: theme.text,
        width: props.labelWidth,
        minWidth: BAR_LABEL_WIDTH,
        maxWidth: BAR_LABEL_MAX_WIDTH,
        flexShrink: 0,
        children: props.window.label
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
        width: props.layout.trackWidth,
        minWidth: props.layout.trackMinWidth,
        maxWidth: "100%",
        height: 1,
        flexDirection: "row",
        flexShrink: 1,
        gap: 0,
        backgroundColor: theme.backgroundElement,
        children: /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
          when: percent > 0,
          children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
            width: `${percent}%`,
            height: 1,
            backgroundColor: color
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
        fg: color,
        attributes: TextAttributes.BOLD,
        width: BAR_PERCENT_WIDTH,
        minWidth: BAR_PERCENT_WIDTH,
        flexShrink: 0,
        children: `${percent}%`.padStart(BAR_PERCENT_WIDTH, " ")
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function SectionBlock(props) {
  const theme = props.api.theme.current;
  const labelWidth = createMemo(() => getUsageBarLabelWidth(props.section.windows));
  return /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
    width: "100%",
    maxWidth: "100%",
    flexDirection: "column",
    gap: 0,
    children: [
      /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
        when: props.section.label,
        children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
          flexDirection: "column",
          paddingBottom: 1,
          children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
            fg: theme.text,
            attributes: TextAttributes.BOLD,
            children: props.section.label
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
        when: props.section.note,
        children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
          fg: theme.textMuted,
          paddingBottom: 1,
          children: props.section.note
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
        when: !props.section.error,
        fallback: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
          fg: theme.error,
          children: props.section.error
        }, undefined, false, undefined, this),
        children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
          flexDirection: "column",
          gap: 0,
          children: [
            /* @__PURE__ */ jsxDEV_7x81h0kn(For, {
              each: props.section.windows,
              children: (window) => /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
                width: "100%",
                maxWidth: "100%",
                paddingBottom: 1,
                children: /* @__PURE__ */ jsxDEV_7x81h0kn(UsageBar, {
                  api: props.api,
                  window,
                  layout: props.barLayout,
                  labelWidth: labelWidth()
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
              when: props.section.rows.length > 0,
              children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
                flexDirection: "column",
                gap: 0,
                children: /* @__PURE__ */ jsxDEV_7x81h0kn(For, {
                  each: props.section.rows,
                  children: (row) => /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 2,
                    children: [
                      /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                        fg: theme.textMuted,
                        children: row.label
                      }, undefined, false, undefined, this),
                      /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                        fg: theme.text,
                        children: row.value
                      }, undefined, false, undefined, this)
                    ]
                  }, undefined, true, undefined, this)
                }, undefined, false, undefined, this)
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
              when: props.section.windows.length === 0 && props.section.rows.length === 0,
              children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                fg: theme.textMuted,
                children: "No usage data reported."
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function ProviderCard(props) {
  const theme = props.api.theme.current;
  return /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
    width: "100%",
    maxWidth: "100%",
    flexDirection: "column",
    gap: 0,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    backgroundColor: theme.background,
    borderColor: theme.border,
    borderStyle: "rounded",
    children: [
      /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
        flexDirection: "row",
        justifyContent: "space-between",
        paddingBottom: 1,
        children: [
          /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
            fg: theme.text,
            attributes: TextAttributes.BOLD,
            children: props.provider.provider
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
            when: props.provider.planType,
            children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
              fg: theme.textMuted,
              children: props.provider.planType
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
        width: "100%",
        maxWidth: "100%",
        flexDirection: "column",
        gap: 1,
        children: /* @__PURE__ */ jsxDEV_7x81h0kn(For, {
          each: props.provider.sections,
          children: (section) => /* @__PURE__ */ jsxDEV_7x81h0kn(SectionBlock, {
            api: props.api,
            section,
            barLayout: props.barLayout
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function UsageDialog(props) {
  const dimensions = useTerminalDimensions();
  const theme = props.api.theme.current;
  const [showErroredProviders, setShowErroredProviders] = createSignal(false);
  const okResult = () => isOkResult(props.result) ? props.result : undefined;
  const messageResult = () => isMessageResult(props.result) ? props.result : undefined;
  const isAllProvidersView = () => props.result.provider === ALL_PROVIDERS_SCOPE;
  const providerViews = createMemo(() => {
    const result = okResult();
    return result ? buildProviderViews(result.providers) : [];
  });
  const hiddenErroredProviders = createMemo(() => {
    if (!isAllProvidersView()) {
      return [];
    }
    return providerViews().filter(isErroredProvider);
  });
  const visibleProviderViews = createMemo(() => {
    if (!isAllProvidersView() || showErroredProviders()) {
      return providerViews();
    }
    return providerViews().filter((provider) => !isErroredProvider(provider));
  });
  const onlyHiddenErroredProviders = createMemo(() => !showErroredProviders() && visibleProviderViews().length === 0 && hiddenErroredProviders().length > 0);
  const barLayout = createMemo(() => getUsageBarLayout(dimensions().width));
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
  return /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
    gap: 0,
    paddingBottom: 1,
    children: [
      /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
        paddingLeft: 4,
        paddingRight: 4,
        paddingBottom: 1,
        children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
          flexDirection: "row",
          justifyContent: "space-between",
          children: [
            /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
              flexDirection: "row",
              gap: 1,
              children: [
                /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                  fg: theme.text,
                  attributes: TextAttributes.BOLD,
                  children: "Usage Tracker"
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                  fg: theme.textMuted,
                  children: getProviderScopeLabelFromValue(props.result.provider)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this),
            /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
              fg: theme.textMuted,
              onMouseUp: () => props.api.ui.dialog.clear(),
              children: "esc"
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
        when: okResult() && isAllProvidersView() && hiddenErroredProviders().length > 0 && !showErroredProviders(),
        children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
          paddingLeft: 4,
          paddingRight: 4,
          paddingBottom: 1,
          children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 0,
            paddingBottom: 0,
            backgroundColor: RGBA.fromInts(0, 0, 0, 0),
            borderColor: theme.error,
            borderStyle: "rounded",
            children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
              fg: theme.error,
              children: `${hiddenErroredProviders().length} provider(s) hidden \u2014 unable to fetch quota. Press h to show.`
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
        when: okResult() && isAllProvidersView() && hiddenErroredProviders().length > 0 && showErroredProviders(),
        children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
          paddingLeft: 4,
          paddingRight: 4,
          paddingBottom: 1,
          children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
            fg: theme.textMuted,
            children: `Showing ${hiddenErroredProviders().length} errored provider(s). Press h to hide.`
          }, undefined, false, undefined, this)
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV_7x81h0kn("scrollbox", {
        paddingLeft: 4,
        paddingRight: 4,
        maxHeight: Math.max(12, Math.floor(dimensions().height * 0.49)),
        children: [
          /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
            when: okResult(),
            children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
              width: "100%",
              maxWidth: "100%",
              flexDirection: "column",
              gap: 1,
              children: [
                /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
                  when: onlyHiddenErroredProviders(),
                  children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
                    padding: 1,
                    backgroundColor: RGBA.fromInts(0, 0, 0, 0),
                    borderColor: theme.border,
                    borderStyle: "rounded",
                    children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                      fg: theme.textMuted,
                      children: "All visible providers are hidden. Press h to show errored providers."
                    }, undefined, false, undefined, this)
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV_7x81h0kn(For, {
                  each: visibleProviderViews(),
                  children: (provider) => /* @__PURE__ */ jsxDEV_7x81h0kn(ProviderCard, {
                    api: props.api,
                    provider,
                    barLayout: barLayout()
                  }, undefined, false, undefined, this)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV_7x81h0kn(Show, {
            when: messageResult(),
            children: /* @__PURE__ */ jsxDEV_7x81h0kn("box", {
              padding: 1,
              backgroundColor: RGBA.fromInts(0, 0, 0, 0),
              borderColor: theme.border,
              borderStyle: "rounded",
              children: /* @__PURE__ */ jsxDEV_7x81h0kn("text", {
                fg: messageResult()?.kind === "error" ? theme.error : theme.textMuted,
                children: messageResult()?.message ?? ""
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function openResultDialog(api, result) {
  api.ui.dialog.replace(() => /* @__PURE__ */ jsxDEV_7x81h0kn(UsageDialog, {
    api,
    result
  }, undefined, false, undefined, this));
}
async function openPicker(api) {
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
  api.ui.dialog.replace(() => /* @__PURE__ */ jsxDEV_7x81h0kn(DialogSelect, {
    title: "Usage",
    placeholder: "Choose provider",
    options,
    onSelect: (option) => {
      api.ui.dialog.clear();
      if (!isProviderScope(option.value)) {
        api.ui.toast({
          message: `Unknown provider: ${option.value}`,
          variant: "error",
          duration: 2500
        });
        return;
      }
      openUsage(api, option.value);
    }
  }, undefined, false, undefined, this));
}
async function openUsage(api, provider) {
  api.ui.toast({
    message: "Fetching usage data...",
    variant: "info",
    duration: 2000
  });
  try {
    const result = await fetchUsageResult(provider);
    openResultDialog(api, result);
  } catch (error) {
    openResultDialog(api, {
      kind: "error",
      provider,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
const tui = async (api) => {
  api.command.register(() => [
    {
      title: "Usage",
      value: USAGE_COMMAND_SHOW,
      category: "Plugin",
      slash: { name: "usage" },
      onSelect: () => {
        openPicker(api);
      }
    },
    {
      title: "Usage",
      value: USAGE_COMMAND_OPEN_ALL,
      category: "Plugin",
      hidden: true,
      onSelect: () => {
        openUsage(api, ALL_PROVIDERS_SCOPE);
      }
    },
    {
      title: "Usage Select",
      value: USAGE_COMMAND_OPEN_PICKER,
      category: "Plugin",
      hidden: true,
      onSelect: () => {
        openPicker(api);
      }
    },
    ...getProviderCommands().map(({ provider, title, value }) => ({
      title,
      value,
      category: "Plugin",
      hidden: true,
      onSelect: () => {
        openUsage(api, provider);
      }
    }))
  ]);
};
const module = {
  id: PLUGIN_ID,
  tui
};
export default module;
