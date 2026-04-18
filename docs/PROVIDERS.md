# Providers

This guide reflects the current provider registry structure and may evolve as provider support expands.

The plugin is registry-driven. In most cases, adding a new provider only needs:

1. a new provider module in `src/providers/`
2. one registration entry in `src/providers/index.ts`

You should not need to change `src/tui.tsx` or `src/usage.ts` for a normal provider addition.

## Step 1: Create A Provider Module

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
      sectionId: "main",
      sectionKind: "main",
      sectionOrder: 10,
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

## Step 2: Register The Provider

Import it in `src/providers/index.ts` and add it to `REGISTERED_PROVIDERS`.

```ts
import { exampleProvider } from "./example.ts";

const REGISTERED_PROVIDERS = [openAIProvider, copilotProvider, exampleProvider] as const;
```

The registry handles:

- picker entries
- hidden command generation
- provider label lookup
- display order via `order`
- configured-provider filtering

## Step 3: Return Clear Cards

Each provider should return `UsageCard[]` shaped for display.

Useful fields:

- `provider`: card title
- `providerId`: stable provider grouping key
- `sectionId`: stable section key inside a provider card
- `sectionKind`: `"main"` or `"special"`
- `sectionOrder`: section render order
- `planType`: right-aligned plan label
- `windows`: progress bars shown in the card
- `extra`: key-value rows under the bars
- `error`: provider-specific failure message

## Step 4: Verify

Run:

```bash
bun run test
```

Then test `/usage` in OpenCode with the provider configured in `auth.json`.
