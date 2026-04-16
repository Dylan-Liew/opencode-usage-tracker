# OpenCode Usage Tracker

Track provider usage inside OpenCode with a native TUI dialog.

## Supported Providers

Only the providers below are currently supported in this repo.

| Provider | Auth | Usage shown |
| --- | --- | --- |
| OpenAI/Codex | ChatGPT login or API key | ChatGPT login: primary quota, Spark quota when present, code review quota, credits. API key: informational card only. |
| GitHub Copilot | OAuth token from OpenCode auth | Premium/chat quota snapshots, remaining usage, reset time. |

## Installation

### Automatic install from npm

Recommended:

```bash
opencode plugin opencode-usage-tracker
```

This installs the npm package and wires it into OpenCode.

### Manual install from npm

Add the npm package name to both configs so the TUI plugin and the server bridge
are both loaded.

`opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-usage-tracker"]
}
```

`tui.json`

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-usage-tracker"]
}
```

## Usage

Open the tracker with either:

- `/usage`
- Command palette → `Usage`

Behavior depends on how many supported providers are configured in your
OpenCode `auth.json`:

- 0 configured: show the empty-state message
- 1 configured: open that provider directly
- 2+ configured: show the provider picker

## Authentication

The plugin reads credentials from OpenCode's `auth.json`.

- Linux: `~/.local/share/opencode/auth.json`
- macOS: `~/Library/Application Support/opencode/auth.json`

OpenCode populates this file when you connect providers through its normal auth
flow.

### OpenAI/Codex modes

- **ChatGPT login**: fetches Codex usage from `https://chatgpt.com/backend-api/wham/usage`
- **API key**: shows an informational card only, because ChatGPT subscription
  quota data does not apply to direct API-key usage

## Adding More Providers

The plugin is now registry-driven. To add a provider, you should only need:

1. a new provider module in `src/providers/`
2. one registration entry in `src/providers/index.ts`

You should **not** need to change `src/tui.tsx` or `src/usage.ts` for a normal
new provider.

### Step 1: Create a provider module

Add a new file such as `src/providers/example.ts`.

Each provider exports a definition that satisfies `UsageProviderDefinition`.

```ts
import type { UsageCard, UsageProviderDefinition } from "../types.ts";
import type { RawAuthJson } from "../utils/auth.ts";

type ExampleAuth = {
  apiKey: string;
};

function resolveExampleAuth(rawAuth: RawAuthJson): ExampleAuth | undefined {
  const example = rawAuth["example"];
  if (!example) {
    return undefined;
  }

  const apiKey = typeof example.key === "string" ? example.key.trim() : "";
  return apiKey ? { apiKey } : undefined;
}

async function fetchExampleUsage(auth: ExampleAuth): Promise<UsageCard[]> {
  return [
    {
      providerId: exampleProvider.id,
      provider: "Example Provider",
      planType: "Pro",
      windows: [
        {
          label: "Monthly",
          usedPercent: 42,
        },
      ],
    },
  ];
}

export const exampleProvider = {
  id: "example",
  label: "Example Provider",
  commandTitle: "Usage Example",
  order: 30,
  resolveAuth: resolveExampleAuth,
  fetchFromRawAuth: async (rawAuth) => {
    const auth = resolveExampleAuth(rawAuth);
    if (!auth) {
      throw new Error("Provider not configured");
    }

    return fetchExampleUsage(auth);
  },
} as const satisfies UsageProviderDefinition;
```

### Step 2: Register the provider

Import it in `src/providers/index.ts` and add it to `REGISTERED_PROVIDERS`.

```ts
import { exampleProvider } from "./example.ts";

const REGISTERED_PROVIDERS = [openAIProvider, copilotProvider, exampleProvider] as const;
```

The registry then handles:

- picker entries
- hidden command generation
- provider label lookup
- display order via `order`
- configured-provider filtering

### Step 3: Return clear cards

Each provider should return `UsageCard[]` shaped for display.

Useful fields:

- `provider`: card title
- `description`: short muted subtitle under the title
- `planType`: right-aligned plan label
- `windows`: progress bars shown in the card
- `extra`: key-value rows under the bars
- `error`: provider-specific failure message

### Step 4: Verify

Run:

```bash
bun run test
```

Then test `/usage` in OpenCode with the provider configured in `auth.json`.

## Notes

- Read-only: the plugin only fetches usage data
- No cache: usage is fetched fresh each time

## License

MIT
