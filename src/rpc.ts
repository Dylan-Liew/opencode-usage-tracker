import { Rpc } from "@opencode/plugin/rpc";

export const usageRpc = Rpc.define({
  id: "opencode-usage-tracker",
  methods: {
    providers: { input: { type: "object", additionalProperties: false }, output: { type: "array", items: { type: "object" } } },
    usage: {
      input: { type: "object", properties: { provider: { type: "string" } }, required: ["provider"], additionalProperties: false },
      output: { type: "object" },
    },
  },
  events: {},
});
