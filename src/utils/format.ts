/**
 * Formatting utilities for usage display
 */

import type { UsageCard } from "../types.ts";

const PROGRESS_BAR_WIDTH = 14;
const BOX_WIDTH = 49;

/**
 * Create a progress bar string
 * @param percent - Usage percentage (0-100)
 * @returns Progress bar like "████████░░░░░░ 78%"
 */
export function progressBar(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * PROGRESS_BAR_WIDTH);
  const empty = PROGRESS_BAR_WIDTH - filled;
  
  const filledChar = "█";
  const emptyChar = "░";
  
  const bar = filledChar.repeat(filled) + emptyChar.repeat(empty);
  const percentStr = `${Math.round(clamped)}%`.padStart(4);
  
  return `${bar} ${percentStr}`;
}

/**
 * Get color indicator based on usage percentage
 */
export function getUsageIndicator(percent: number): string {
  if (percent >= 90) return "[CRITICAL]";
  if (percent >= 75) return "[HIGH]";
  if (percent >= 50) return "[MODERATE]";
  return "";
}

/**
 * Pad a string to fit within the box
 */
function padLine(content: string, width: number = BOX_WIDTH - 4): string {
  if (content.length >= width) {
    return content.substring(0, width);
  }
  return content + " ".repeat(width - content.length);
}

/**
 * Format a single provider's usage data
 */
function formatProvider(data: UsageCard): string[] {
  const lines: string[] = [];
  
  // Provider header with plan type
  const header = data.planType 
    ? `${data.provider} (${data.planType})`
    : data.provider;
  lines.push(`│ ${padLine(header)} │`);
  
  if (data.error) {
    lines.push(`│ ${padLine(`  Error: ${data.error}`)} │`);
    return lines;
  }
  
  // Usage windows
  for (const window of data.windows) {
    const indicator = getUsageIndicator(window.usedPercent);
    const label = `  ${window.label}:`.padEnd(12);
    const bar = progressBar(window.usedPercent);
    const line = `${label}${bar} ${indicator}`.trim();
    lines.push(`│ ${padLine(line)} │`);
  }
  
  // Reset times (on separate lines)
  for (const window of data.windows) {
    if (window.resetTime) {
      lines.push(`│ ${padLine(`  ${window.label} Resets: ${window.resetTime}`)} │`);
    }
  }
  
  // Extra info (requests, cost, etc.)
  if (data.extra) {
    for (const [key, value] of Object.entries(data.extra)) {
      lines.push(`│ ${padLine(`  ${key}: ${value}`)} │`);
    }
  }
  
  return lines;
}

/**
 * Format all provider usage data into a table
 */
export function formatUsageTable(providers: UsageCard[]): string {
  const topBorder = "╭" + "─".repeat(BOX_WIDTH - 2) + "╮";
  const bottomBorder = "╰" + "─".repeat(BOX_WIDTH - 2) + "╯";
  const separator = "├" + "─".repeat(BOX_WIDTH - 2) + "┤";
  const title = "│" + "AI Provider Usage".padStart((BOX_WIDTH - 2 + 17) / 2).padEnd(BOX_WIDTH - 2) + "│";
  
  const lines: string[] = [topBorder, title, separator];
  
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    if (!provider) continue;
    
    lines.push(...formatProvider(provider));
    
    if (i < providers.length - 1) {
      lines.push(separator);
    }
  }
  
  lines.push(bottomBorder);
  
  return lines.join("\n");
}

/**
 * Format a relative time string with date in local timezone
 */
export function formatRelativeTime(date: Date, options?: { includeDate?: boolean }): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const includeDate = options?.includeDate ?? true;
  
  // Format date as DD/MM/YY in local timezone
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  const dateStr = `${day}/${month}/${year}`;
  const hours24 = date.getHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours24 >= 12 ? "PM" : "AM";
  const timeStr = `${hours12}:${minutes} ${period}`;

  const timestamp = includeDate ? `${dateStr} ${timeStr}` : timeStr;

  if (diffMs < 0) {
    return `expired (${timestamp})`;
  }
  
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  let relative: string;
  
  if (diffDay > 0) {
    const remainingHours = diffHour % 24;
    relative = remainingHours > 0 ? `${diffDay}d ${remainingHours}h` : `${diffDay}d`;
  } else if (diffHour > 0) {
    const remainingMin = diffMin % 60;
    relative = remainingMin > 0 ? `${diffHour}h ${remainingMin}m` : `${diffHour}h`;
  } else if (diffMin > 0) {
    relative = `${diffMin}m`;
  } else {
    relative = `${diffSec}s`;
  }
  
  return `${relative} (${timestamp})`;
}

/**
 * Format a simple error message
 */
export function formatError(message: string): string {
  return `╭${"─".repeat(BOX_WIDTH - 2)}╮
│${padLine(" Error: " + message, BOX_WIDTH - 2)}│
╰${"─".repeat(BOX_WIDTH - 2)}╯`;
}

/**
 * Format a "no providers" message
 */
export function formatNoProviders(): string {
  return `╭${"─".repeat(BOX_WIDTH - 2)}╮
│${" ".repeat(BOX_WIDTH - 2)}│
│${"No providers configured".padStart((BOX_WIDTH - 2 + 22) / 2).padEnd(BOX_WIDTH - 2)}│
│${" ".repeat(BOX_WIDTH - 2)}│
│${"Add tokens to auth.json:".padStart((BOX_WIDTH - 2 + 23) / 2).padEnd(BOX_WIDTH - 2)}│
│${"~/.local/share/opencode/auth.json".padStart((BOX_WIDTH - 2 + 33) / 2).padEnd(BOX_WIDTH - 2)}│
│${" ".repeat(BOX_WIDTH - 2)}│
╰${"─".repeat(BOX_WIDTH - 2)}╯`;
}
