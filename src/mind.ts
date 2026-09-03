import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InstalledMind, MindManifest } from "./types.ts";

const ID_PATTERN = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DATA_EXTENSIONS = new Set([".json", ".md", ".txt", ".yaml", ".yml"]);

export class MindValidationError extends Error {}

export function bundledMindsDirectory(): string {
  return fileURLToPath(new URL("../minds", import.meta.url));
}

export function validateManifest(value: unknown): MindManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MindValidationError("mind.json must contain a JSON object");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schema_version !== 1 && manifest.schema_version !== 2) {
    throw new MindValidationError("mind.json schema_version must be 1 or 2");
  }
  for (const key of ["id", "name"] as const) {
    if (typeof manifest[key] !== "string" || !manifest[key].trim()) {
      throw new MindValidationError(`mind.json ${key} must be a nonempty string`);
    }
  }
  if (!ID_PATTERN.test(manifest.id as string)) {
    throw new MindValidationError("mind id must use Wikipedia slug syntax");
  }
  if (manifest.schema_version === 1) {
    if (typeof manifest.version !== "string" || !VERSION_PATTERN.test(manifest.version)) {
      throw new MindValidationError("legacy mind version must use semantic version syntax");
    }
    if (typeof manifest.core !== "string" || basename(manifest.core) !== manifest.core || extname(manifest.core) !== ".md") {
      throw new MindValidationError("legacy mind core must name a Markdown file in the bundle root");
    }
  } else {
    if (typeof manifest.language !== "string" || !manifest.language.trim()) {
      throw new MindValidationError("mind.json language must be a nonempty string");
    }
    if (manifest.description !== undefined && (typeof manifest.description !== "string" || !manifest.description.trim())) {
      throw new MindValidationError("mind.json description must be a nonempty string when provided");
    }
  }
  return manifest as unknown as MindManifest;
}

async function assertDataOnly(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new MindValidationError(`symbolic links are not allowed: ${entry.name}`);
    if (entry.isDirectory()) {
      await assertDataOnly(path);
      continue;
    }
    if (!entry.isFile() || !DATA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      throw new MindValidationError(`mind identities are data-only: ${entry.name}`);
    }
  }
}

export async function loadMindDirectory(directory: string): Promise<InstalledMind> {
  const resolved = resolve(directory);
  const manifestFile = existsSync(join(resolved, "mind.json")) ? "mind.json" : "expert.json";
  const raw = await readFile(join(resolved, manifestFile), "utf8").catch(() => {
    throw new MindValidationError(`missing mind.json in ${resolved}`);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MindValidationError("mind.json is not valid JSON");
  }
  const manifest = validateManifest(parsed);
  if (basename(resolved) !== manifest.id) {
    throw new MindValidationError(`folder name must match mind id ${manifest.id}`);
  }
  await assertDataOnly(resolved);
  if (manifest.schema_version === 1) {
    await readFile(join(resolved, manifest.core!), "utf8").catch(() => {
      throw new MindValidationError(`missing legacy core file ${manifest.core}`);
    });
  }
  return { manifest, directory: resolved };
}

async function mindsInDirectory(directory: string): Promise<InstalledMind[]> {
  if (!existsSync(directory)) return [];
  const minds: InstalledMind[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      minds.push(await loadMindDirectory(join(directory, entry.name)));
    } catch {
      // One broken identity should not hide healthy minds.
    }
  }
  return minds;
}

export async function listInstalledMinds(mindsDirectory: string): Promise<InstalledMind[]> {
  const byId = new Map<string, InstalledMind>();
  for (const mind of await mindsInDirectory(bundledMindsDirectory())) byId.set(mind.manifest.id, mind);
  for (const mind of await mindsInDirectory(resolve(mindsDirectory))) byId.set(mind.manifest.id, mind);
  return [...byId.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export async function getInstalledMind(mindsDirectory: string, id: string): Promise<InstalledMind> {
  const mind = (await listInstalledMinds(mindsDirectory)).find((candidate) => candidate.manifest.id === id);
  if (!mind) throw new Error(`No bundled or saved mind named ${id}`);
  return mind;
}

function slugFromSummary(summary: Record<string, unknown>): string {
  const urls = summary.content_urls as { desktop?: { page?: unknown } } | undefined;
  if (typeof urls?.desktop?.page === "string") {
    const slug = decodeURIComponent(new URL(urls.desktop.page).pathname.split("/").pop() ?? "");
    if (ID_PATTERN.test(slug)) return slug;
  }
  const title = typeof summary.title === "string" ? summary.title.replaceAll(" ", "_") : "";
  if (!ID_PATTERN.test(title)) throw new MindValidationError("Wikipedia returned an invalid identity slug");
  return title;
}

export async function addMind(mindsDirectory: string, requestedId: string): Promise<InstalledMind> {
  if (!ID_PATTERN.test(requestedId)) throw new MindValidationError("mind id must use Wikipedia slug syntax");
  const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(requestedId)}`, {
    headers: { "User-Agent": "minds-cli/0.4 (https://github.com/0xmiki/minds-cli)" },
    redirect: "follow",
  });
  if (!response.ok) throw new MindValidationError(`No English Wikipedia page named ${requestedId}`);
  const summary = await response.json() as Record<string, unknown>;
  if (summary.type === "disambiguation") throw new MindValidationError(`${requestedId} is a disambiguation page; use the person's exact page slug`);
  const id = slugFromSummary(summary);
  const manifest: MindManifest = {
    schema_version: 2,
    id,
    name: typeof summary.title === "string" ? summary.title : id.replaceAll("_", " "),
    language: "en",
    ...(typeof summary.description === "string" && summary.description.trim() ? { description: summary.description.trim() } : {}),
  };
  const destination = join(resolve(mindsDirectory), id);
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "mind.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  return loadMindDirectory(destination);
}

export async function removeMind(mindsDirectory: string, id: string): Promise<void> {
  const root = resolve(mindsDirectory);
  const target = resolve(root, id);
  if (!existsSync(target) && existsSync(join(bundledMindsDirectory(), id))) {
    throw new Error(`${id} is bundled with Minds and cannot be removed`);
  }
  if (dirname(target) !== root || basename(target) !== id || !ID_PATTERN.test(id)) {
    throw new Error("Refusing to remove an unresolved mind path");
  }
  const mind = await loadMindDirectory(target);
  if (mind.manifest.id !== id) throw new Error("Refusing to remove an unresolved mind path");
  await rm(target, { recursive: true });
}
