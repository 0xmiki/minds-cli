import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";

export interface MindsPaths {
  data: string;
  minds: string;
  database: string;
  workspaces: string;
}

function dataDirectory(name: "minds" | "experts"): string {
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", name);
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), name);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), name);
}

export function migrateLegacyLayout(data: string): void {
  const legacyMinds = join(data, "experts");
  const minds = join(data, "minds");
  if (!existsSync(minds) && existsSync(legacyMinds)) renameSync(legacyMinds, minds);
  if (!existsSync(minds)) return;
  for (const entry of readdirSync(minds, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(minds, entry.name);
    const legacyManifest = join(directory, "expert.json");
    const manifest = join(directory, "mind.json");
    if (!existsSync(manifest) && existsSync(legacyManifest)) renameSync(legacyManifest, manifest);
  }
}

export function migrateLegacyDataHome(data: string, legacyData: string): void {
  if (!existsSync(data) && existsSync(legacyData)) {
    mkdirSync(dirname(data), { recursive: true });
    renameSync(legacyData, data);
  }
  migrateLegacyLayout(data);
}

export function getPaths(dataOverride = process.env.MINDS_DATA_DIR ?? process.env.EXPERTS_DATA_DIR): MindsPaths {
  const data = dataOverride ?? dataDirectory("minds");
  if (!dataOverride) migrateLegacyDataHome(data, dataDirectory("experts"));
  else migrateLegacyLayout(data);
  return {
    data,
    minds: join(data, "minds"),
    database: join(data, "conversations.sqlite3"),
    workspaces: join(data, "workspaces"),
  };
}
