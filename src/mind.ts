import { cp, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MindManifest, InstalledMind } from "./types.ts";

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
  if (manifest.schema_version !== 1) {
    throw new MindValidationError("mind.json schema_version must be 1");
  }
  for (const key of ["id", "name", "version", "default_language", "core"] as const) {
    if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
      throw new MindValidationError(`mind.json ${key} must be a nonempty string`);
    }
  }
  if (!ID_PATTERN.test(manifest.id as string)) {
    throw new MindValidationError("mind id must use Wikipedia slug syntax");
  }
  if (!VERSION_PATTERN.test(manifest.version as string)) {
    throw new MindValidationError("mind version must use semantic version syntax");
  }
  const core = manifest.core as string;
  if (basename(core) !== core || extname(core) !== ".md") {
    throw new MindValidationError("mind core must name a Markdown file in the bundle root");
  }
  return manifest as unknown as MindManifest;
}

async function assertDataOnly(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new MindValidationError(`symbolic links are not allowed: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      await assertDataOnly(path);
      continue;
    }
    if (!entry.isFile() || !DATA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      throw new MindValidationError(`mind bundles are data-only: ${entry.name}`);
    }
  }
}

export async function loadMindDirectory(directory: string): Promise<InstalledMind> {
  const resolved = resolve(directory);
  const manifestPath = existsSync(join(resolved, "mind.json")) ? "mind.json" : "expert.json";
  const raw = await readFile(join(resolved, manifestPath), "utf8").catch(() => {
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
  const core = await readFile(join(resolved, manifest.core), "utf8").catch(() => {
    throw new MindValidationError(`missing core file ${manifest.core}`);
  });
  if (core.trim().length === 0) {
    throw new MindValidationError("core.md must not be empty");
  }
  return { manifest, directory: resolved, core };
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const [core, prerelease] = value.split("-", 2);
    return { numbers: core!.split(".").map((part) => Number(part)), prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

async function mindsInDirectory(directory: string): Promise<InstalledMind[]> {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const minds: InstalledMind[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      minds.push(await loadMindDirectory(join(directory, entry.name)));
    } catch {
      // One broken directory should not hide healthy minds.
    }
  }
  return minds;
}

export async function listInstalledMinds(mindsDirectory: string): Promise<InstalledMind[]> {
  const byId = new Map<string, InstalledMind>();
  for (const mind of await mindsInDirectory(bundledMindsDirectory())) byId.set(mind.manifest.id, mind);
  for (const mind of await mindsInDirectory(resolve(mindsDirectory))) {
    const existing = byId.get(mind.manifest.id);
    if (!existing || compareVersions(mind.manifest.version, existing.manifest.version) >= 0) {
      byId.set(mind.manifest.id, mind);
    }
  }
  return [...byId.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

export async function getInstalledMind(mindsDirectory: string, id: string): Promise<InstalledMind> {
  const candidates: InstalledMind[] = [];
  for (const directory of [join(bundledMindsDirectory(), id), join(resolve(mindsDirectory), id)]) {
    try {
      candidates.push(await loadMindDirectory(directory));
    } catch {
      // Try the other source before reporting the missing mind.
    }
  }
  if (candidates.length === 0) throw new Error(`No bundled or installed mind named ${id}`);
  return candidates.reduce((selected, candidate) =>
    compareVersions(candidate.manifest.version, selected.manifest.version) >= 0 ? candidate : selected,
  );
}

export async function resolveMindSource(source: string): Promise<string> {
  const local = resolve(source);
  if (existsSync(local)) return local;
  const bundled = join(bundledMindsDirectory(), source);
  if (existsSync(bundled)) return bundled;
  throw new Error(`No bundled or local mind named ${source}`);
}

export async function installMind(source: string, mindsDirectory: string): Promise<InstalledMind> {
  const sourceDirectory = await resolveMindSource(source);
  const mind = await loadMindDirectory(sourceDirectory);
  await mkdir(mindsDirectory, { recursive: true });
  const destination = join(resolve(mindsDirectory), mind.manifest.id);
  const staging = `${destination}.installing-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await cp(sourceDirectory, staging, { recursive: true, errorOnExist: true });
  const legacyManifest = join(staging, "expert.json");
  const manifest = join(staging, "mind.json");
  if (!existsSync(manifest) && existsSync(legacyManifest)) await rename(legacyManifest, manifest);
  await rm(destination, { recursive: true, force: true });
  await rename(staging, destination);
  return loadMindDirectory(destination);
}

export async function removeMind(mindsDirectory: string, id: string): Promise<void> {
  const root = resolve(mindsDirectory);
  const target = resolve(root, id);
  if (!existsSync(target) && existsSync(join(bundledMindsDirectory(), id))) {
    throw new Error(`${id} is bundled with Minds and cannot be removed`);
  }
  const mind = await loadMindDirectory(target);
  if (mind.manifest.id !== id || dirname(target) !== root) {
    throw new Error("Refusing to remove an unresolved mind path");
  }
  await rm(target, { recursive: true });
}
