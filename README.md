![Usage Tracker in the OpenCode TUI](./docs/images/sample.png)

# OpenCode **Usage Tracker**

Track provider usage inside OpenCode with a native TUI dialog through a simple `/usage` command.

> [!IMPORTANT]
> Version 1.x supports OpenCode v2 only. OpenCode v1 is no longer supported; use the final 0.x release if you must remain on v1.

## Supported Providers

- Codex
- Anthropic
- GitHub Copilot
- MiniMax (new, untested)
- Kimi (new, untested)
- Z.AI Coding Plan

## Install

Recommended:

```bash
opencode plugin -g opencode-usage-tracker
```

Manual install:

For an OpenCode v2 global manual install, add the plugin to `~/.config/opencode/opencode.json`. OpenCode loads its server entrypoint and sends its `tui` entrypoint to the CLI:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-usage-tracker"]
}
```

For a local checkout, use `file:///path/to/opencode-usage-tracker`.

## Try It

Configure a supported provider in OpenCode, then open the tracker with either:

- `/usage`
- Command palette -> `Usage`

If you have multiple supported providers configured, the plugin shows a picker first.

## Notes

- Read-only: the plugin only fetches usage data
- No cache: usage is fetched fresh each time
- More provider support is coming. If you want to help add one, see [`docs/PROVIDERS.md`](./docs/PROVIDERS.md).

## License

MIT
