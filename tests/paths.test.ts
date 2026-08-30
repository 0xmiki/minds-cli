import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPaths } from "../src/paths.ts";

test("renames an installed experts layout to minds", async () => {
  const data = await mkdtemp(join(tmpdir(), "minds-layout-"));
  const legacy = join(data, "experts", "Claude_Shannon");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "expert.json"), "{}");
  await writeFile(join(legacy, "core.md"), "legacy");

  const paths = getPaths(data);
  assert.equal(paths.minds, join(data, "minds"));
  assert.equal(paths.workspaces, join(data, "workspaces"));
  await access(join(paths.minds, "Claude_Shannon", "mind.json"));
  await assert.rejects(access(join(data, "experts")));
});

test("moves the default experts data home to minds", async () => {
  if (process.platform === "darwin" || process.platform === "win32") return;
  const root = await mkdtemp(join(tmpdir(), "minds-home-"));
  const legacy = join(root, "experts", "experts", "Claude_Shannon");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "expert.json"), "{}");
  const previousXdg = process.env.XDG_DATA_HOME;
  const previousMinds = process.env.MINDS_DATA_DIR;
  const previousExperts = process.env.EXPERTS_DATA_DIR;
  process.env.XDG_DATA_HOME = root;
  delete process.env.MINDS_DATA_DIR;
  delete process.env.EXPERTS_DATA_DIR;
  try {
    const paths = getPaths();
    assert.equal(paths.data, join(root, "minds"));
    await access(join(paths.minds, "Claude_Shannon", "mind.json"));
    await assert.rejects(access(join(root, "experts")));
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousXdg;
    if (previousMinds === undefined) delete process.env.MINDS_DATA_DIR;
    else process.env.MINDS_DATA_DIR = previousMinds;
    if (previousExperts === undefined) delete process.env.EXPERTS_DATA_DIR;
    else process.env.EXPERTS_DATA_DIR = previousExperts;
  }
});
