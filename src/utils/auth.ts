/**
 * Auth utilities for reading tokens from OpenCode's auth.json
 */

import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export interface RawAuthJsonProvider {
  [key: string]: unknown;
}

export interface RawAuthJson {
  [key: string]: RawAuthJsonProvider | undefined;
}

/**
 * Get possible paths for OpenCode's auth.json
 */
function getAuthJsonPaths(): string[] {
  const home = homedir();
  const xdgDataHome = process.env.XDG_DATA_HOME;
  
  const paths: string[] = [];
  
  if (xdgDataHome) {
    paths.push(join(xdgDataHome, "opencode", "auth.json"));
  }
  
  paths.push(
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, "Library", "Application Support", "opencode", "auth.json"),
  );
  
  return paths;
}

/**
 * Read and parse auth.json from the first available path
 */
export async function getRawAuthJson(): Promise<RawAuthJson | null> {
  const paths = getAuthJsonPaths();
  
  for (const path of paths) {
    try {
      const content = await readFile(path, "utf-8");
      return JSON.parse(content) as RawAuthJson;
    } catch {
      continue;
    }
  }
  
  return null;
}
