import { expect, test } from "bun:test";
import { getUsageBarSegments } from "./cli.tsx";

test("V2 usage bars render filled and remaining cells", () => {
  expect(getUsageBarSegments(0, 10)).toEqual({ filled: "", remaining: "░░░░░░░░░░" });
  expect(getUsageBarSegments(50, 10)).toEqual({ filled: "█████", remaining: "░░░░░" });
  expect(getUsageBarSegments(100, 10)).toEqual({ filled: "██████████", remaining: "" });
});
