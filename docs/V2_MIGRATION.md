# OpenCode V2 Migration

## What changed

- The package root now exposes the V2 server plugin and native TUI entrypoint.
- OpenCode V1 remains supported through the compiled `tui-v1` export.
- `/usage` opens a responsive provider dialog with usage bars, reset times, credits, and provider errors.
- Usage bars retain the original thresholds: green below 75%, orange from 75% to 89%, and red from 90%.

## Configuration

V2 only needs the package root in `opencode.json`:

```json
{
  "plugins": ["opencode-usage-tracker"]
}
```

V1 keeps the package in `opencode.json` and loads `opencode-usage-tracker/tui-v1` from `tui.json`.

For a local V2 checkout, use an absolute `file:///path/to/opencode-usage-tracker` URL so both the server and TUI can resolve the package.

## Verification

- TypeScript check: `npm test`
- V2 bar tests: `bun test`
- Manually verified with OpenCode 2.0.14
