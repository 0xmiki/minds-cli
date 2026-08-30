import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { getInstalledMind, listInstalledMinds, MindValidationError, installMind, loadMindDirectory, validateManifest } from "../src/mind.ts";

test("validates the minimum versioned mind manifest", () => {
  const manifest = validateManifest({
    schema_version: 1,
    id: "Claude_Shannon",
    name: "Claude Shannon",
    version: "0.1.0",
    default_language: "en",
    core: "core.md",
    future_field: { preserved: true },
  });
  assert.equal(manifest.id, "Claude_Shannon");
  assert.deepEqual(manifest.future_field, { preserved: true });
});

test("rejects non-Wikipedia-style ids and executable bundle files", async () => {
  assert.throws(() => validateManifest({
    schema_version: 1,
    id: "claude shannon",
    name: "Claude Shannon",
    version: "0.1.0",
    default_language: "en",
    core: "core.md",
  }), MindValidationError);

  const root = await mkdtemp(join(tmpdir(), "minds-invalid-"));
  const directory = join(root, "Claude_Shannon");
  await mkdir(directory);
  await writeFile(join(directory, "mind.json"), JSON.stringify({ schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" }));
  await writeFile(join(directory, "core.md"), "A mind.");
  await writeFile(join(directory, "hook.js"), "throw new Error('no')");
  await assert.rejects(loadMindDirectory(directory), /data-only/);
});

test("installs an immutable copy from a local bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-install-"));
  const source = join(root, "Claude_Shannon");
  const destination = join(root, "installed");
  await mkdir(source);
  await writeFile(join(source, "mind.json"), JSON.stringify({ schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" }));
  await writeFile(join(source, "core.md"), "Original mind.");
  const installed = await installMind(source, destination);
  await writeFile(join(source, "core.md"), "Mutated source.");
  assert.equal(installed.manifest.id, "Claude_Shannon");
  assert.equal(await readFile(join(destination, "Claude_Shannon", "core.md"), "utf8"), "Original mind.");
});

test("accepts a legacy expert manifest and installs it as mind.json", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-legacy-manifest-"));
  const source = join(root, "Claude_Shannon");
  const destination = join(root, "installed");
  await mkdir(source);
  await writeFile(join(source, "expert.json"), JSON.stringify({ schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" }));
  await writeFile(join(source, "core.md"), "A legacy mind.");
  await installMind(source, destination);
  await access(join(destination, "Claude_Shannon", "mind.json"));
  await assert.rejects(access(join(destination, "Claude_Shannon", "expert.json")));
});

test("loads the bundled Friedrich Nietzsche mind", async () => {
  const mind = await loadMindDirectory(resolve("minds/Friedrich_Nietzsche"));
  assert.equal(mind.manifest.id, "Friedrich_Nietzsche");
  assert.equal(mind.manifest.name, "Friedrich Nietzsche");
  assert.match(mind.core, /The thought-production line/);
  assert.match(mind.core, /have an ego/i);
  assert.match(mind.core, /The man behind the polemic/);
});

test("loads the bundled Nikola Tesla mind", async () => {
  const mind = await loadMindDirectory(resolve("minds/Nikola_Tesla"));
  assert.equal(mind.manifest.id, "Nikola_Tesla");
  assert.equal(mind.manifest.name, "Nikola Tesla");
  assert.match(mind.core, /The mental workshop/);
  assert.match(mind.core, /rotating magnetic field/);
  assert.match(mind.core, /The man outside the laboratory/);
});

test("gives Claude Shannon an ordinary human side", async () => {
  const mind = await loadMindDirectory(resolve("minds/Claude_Shannon"));
  assert.equal(mind.manifest.version, "0.2.0");
  assert.match(mind.core, /The person away from the blackboard/);
  assert.match(mind.core, /Ordinary conversation is allowed to stay ordinary/);
});

test("loads Aristotle with inquiry mechanics and ordinary humanity", async () => {
  const mind = await loadMindDirectory(resolve("minds/Aristotle"));
  assert.equal(mind.manifest.id, "Aristotle");
  assert.equal(mind.manifest.name, "Aristotle");
  assert.match(mind.core, /The starting materials/);
  assert.match(mind.core, /endoxa/);
  assert.match(mind.core, /The person outside the lecture/);
  assert.match(mind.core, /Wit is a social virtue/);
});

test("makes bundled minds available without installing copies", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-empty-library-"));
  const minds = await listInstalledMinds(join(root, "minds"));
  assert.deepEqual(minds.map((mind) => mind.manifest.id), [
    "Aristotle",
    "Claude_Shannon",
    "Friedrich_Nietzsche",
    "Nikola_Tesla",
  ]);
  const aristotle = await getInstalledMind(join(root, "minds"), "Aristotle");
  assert.equal(aristotle.manifest.version, "0.1.0");
});

test("lets a newer user-installed mind override its bundled version", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-override-"));
  const directory = join(root, "minds", "Aristotle");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "mind.json"), JSON.stringify({ schema_version: 1, id: "Aristotle", name: "Aristotle", version: "9.0.0", default_language: "en", core: "core.md" }));
  await writeFile(join(directory, "core.md"), "A user-authored future Aristotle.");
  const aristotle = await getInstalledMind(join(root, "minds"), "Aristotle");
  assert.equal(aristotle.manifest.version, "9.0.0");
  assert.match(aristotle.core, /user-authored future/);
});
