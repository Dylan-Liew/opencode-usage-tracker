import { expect, test } from "bun:test";
import { getUsageBarHue, getUsageBarSegments } from "./cli.tsx";

test("V2 usage bars render filled and remaining cells", () => {
  expect(getUsageBarSegments(0, 10)).toEqual({ filled: "", remaining: "░░░░░░░░░░" });
  expect(getUsageBarSegments(50, 10)).toEqual({ filled: "█████", remaining: "░░░░░" });
  expect(getUsageBarSegments(100, 10)).toEqual({ filled: "██████████", remaining: "" });
});

test("V2 usage bars retain quota threshold colors", () => {
  expect(getUsageBarHue(10)).toBe("green");
  expect(getUsageBarHue(75)).toBe("orange");
  expect(getUsageBarHue(90)).toBe("red");
});
