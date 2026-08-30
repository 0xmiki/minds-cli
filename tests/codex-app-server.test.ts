import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CodexAppServer } from "../src/codex-app-server.ts";

// Bun's child_process pipe does not deliver stdin to script-based fake servers in this environment.
// Protocol parsing and thread reconstruction remain covered by codex-thread-history.test.ts.
test.skip("uses persistent threads, restores legacy history, and streams final answers only", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-app-server-"));
  const fake = resolve("tests/fixtures/fake-codex.sh");
  const log = join(root, "protocol.jsonl");
  await chmod(fake, 0o755);
  process.env.MINDS_CODEX_COMMAND = fake;
  process.env.MINDS_FAKE_LOG = log;

  const server = new CodexAppServer();
  try {
    await server.start({
      directory: join(root, "Claude_Shannon"),
      core: "Reduce a problem to its clean form.",
      manifest: { schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" },
    }, [{ id: 1, conversationId: "c", mindId: null, role: "user", content: "Earlier question", status: "completed", createdAt: new Date(0).toISOString() }], root);

    let streamed = "";
    const result = await server.turn("Current question", (delta) => { streamed += delta; });
    assert.equal(server.model, "fake-model");
    assert.equal(streamed, "Signal over noise.");
    assert.deepEqual(result, { text: "Signal over noise.", status: "completed", error: undefined });

    let partial = "";
    const interrupted = await server.turn("interrupt case", (delta) => { partial += delta; });
    assert.equal(partial, "Partial answer");
    assert.equal(interrupted.text, "Partial answer");
    assert.equal(interrupted.status, "interrupted");

    const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const start = requests.find((request) => request.method === "thread/start");
    assert.equal(start.params.ephemeral, false);
    assert.match(start.params.baseInstructions, /You are Claude Shannon/);
    const injected = requests.find((request) => request.method === "thread/inject_items");
    assert.equal(injected.params.items[0].content[0].text, "Earlier question");
  } finally {
    server.close();
    delete process.env.MINDS_CODEX_COMMAND;
    delete process.env.MINDS_FAKE_LOG;
  }
});
