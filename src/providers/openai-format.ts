export function humanizeLabel(value: string): string {
  return value
    .replace(/^codex[_\s-]*/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeSectionId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

export function formatPlanType(planType?: string): string | undefined {
  if (!planType) {
    return undefined;
  }

  const normalized = planType.trim().toLowerCase();

  switch (normalized) {
    case "prolite":
      return "Pro 5x";
    case "pro":
      return "Pro 20x";
    default:
      return humanizeLabel(normalized);
  }
}

export function humanizeAdditionalLimitName(value: string): string {
  const normalized = value.trim();

  if (/[\s_-]spark$/i.test(normalized) || /^gpt[-_.]?\d/i.test(normalized)) {
    return normalized
      .split(/[_-]+/)
      .filter(Boolean)
      .map((part) => {
        if (/^gpt$/i.test(part)) return "GPT";
        if (/^codex$/i.test(part)) return "Codex";
        if (/^spark$/i.test(part)) return "Spark";
        if (/^[0-9]+(?:\.[0-9]+)*$/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      })
      .join(" ");
  }

  return humanizeLabel(normalized);
}

export function isSparkLimitName(value: string): boolean {
  return /(^|[\s_-])spark$/i.test(value.trim()) || /codex[\s_-]*spark/i.test(value);
}
