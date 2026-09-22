import { Plugin } from "@opencode/plugin";

import { UsageTrackerPlugin } from "./src/server.ts";

export { UsageTrackerPlugin };

export default {
  ...Plugin.define({
    id: "opencode-usage-tracker",
    setup() {},
  }),
  server: UsageTrackerPlugin,
};
