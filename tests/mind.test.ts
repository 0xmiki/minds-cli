import { afterEach, expect, test } from "bun:test";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addMind, getInstalledMind, listInstalledMinds, loadMindDirectory, MindValidationError, removeMind, validateManifest } from "../src/mind.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test("validates a minimal identity manifest", () => {
  expect(validateManifest({
    schema_version: 2,
    id: "Claude_Shannon",
    name: "Claude Shannon",
    language: "en",
    description: "American mathematician and electrical engineer",
  })).toMatchObject({ id: "Claude_Shannon", name: "Claude Shannon" });
});

test("rejects invalid identity records and executable files", async () => {
  expect(() => validateManifest({ schema_version: 2, id: "claude shannon", name: "Claude Shannon", language: "en" })).toThrow(MindValidationError);
  const root = await mkdtemp(join(tmpdir(), "minds-invalid-"));
  const directory = join(root, "Claude_Shannon");
  await mkdir(directory);
  await writeFile(join(directory, "mind.json"), JSON.stringify({ schema_version: 2, id: "Claude_Shannon", name: "Claude Shannon", language: "en" }));
  await writeFile(join(directory, "hook.js"), "throw new Error('no')");
  await expect(loadMindDirectory(directory)).rejects.toThrow(/data-only/);
});

test("keeps legacy core bundles readable without using them as v2 identity data", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-legacy-"));
  const directory = join(root, "Claude_Shannon");
  await mkdir(directory);
  await writeFile(join(directory, "expert.json"), JSON.stringify({ schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.2.0", default_language: "en", core: "core.md" }));
  await writeFile(join(directory, "core.md"), "Legacy behavioral context.");
  const mind = await loadMindDirectory(directory);
  expect(mind.manifest.schema_version).toBe(1);
  expect(mind).not.toHaveProperty("core");
});

test("loads the four featured identities without core files", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-featured-"));
  const minds = await listInstalledMinds(join(root, "minds"));
  expect(minds.map((mind) => mind.manifest.id)).toEqual([
    "Aristotle",
    "Claude_Shannon",
    "Friedrich_Nietzsche",
    "Nikola_Tesla",
  ]);
  for (const mind of minds) {
    expect(mind.manifest.schema_version).toBe(2);
    await expect(access(join(mind.directory, "core.md"))).rejects.toThrow();
  }
});

test("adds a canonical Wikipedia identity to the local library", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-add-"));
  globalThis.fetch = (async () => new Response(JSON.stringify({
    type: "standard",
    title: "Albert Einstein",
    description: "German-born theoretical physicist",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Albert_Einstein" } },
  }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const mind = await addMind(join(root, "minds"), "Albert_Einstein");
  expect(mind.manifest).toMatchObject({ id: "Albert_Einstein", name: "Albert Einstein", language: "en" });
  expect(await getInstalledMind(join(root, "minds"), "Albert_Einstein")).toMatchObject({ directory: mind.directory });
  await removeMind(join(root, "minds"), "Albert_Einstein");
  await expect(access(mind.directory)).rejects.toThrow();
});

test("a saved identity overrides featured display metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-override-"));
  const directory = join(root, "minds", "Aristotle");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "mind.json"), JSON.stringify({ schema_version: 2, id: "Aristotle", name: "Aristotle of Stagira", language: "en" }));
  const aristotle = await getInstalledMind(join(root, "minds"), "Aristotle");
  expect(aristotle.manifest.name).toBe("Aristotle of Stagira");
  expect(resolve(aristotle.directory)).toBe(resolve(directory));
});
