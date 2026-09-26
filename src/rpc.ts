import { Rpc } from "@opencode/plugin/rpc";

export const usageRpc = Rpc.define({
  id: "opencode-usage-tracker",
  methods: {
    providers: { input: { type: "object", additionalProperties: false }, output: { type: "array", items: { type: "object" } } },
    usage: {
      input: { type: "object", properties: { provider: { type: "string" } }, required: ["provider"], additionalProperties: false },
      output: {
        type: "object",
        properties: {
          kind: { type: "string" },
          provider: { type: "string" },
          message: { type: "string" },
          providers: { type: "array", items: { type: "object" } },
        },
      },
    },
  },
  events: {},
});
