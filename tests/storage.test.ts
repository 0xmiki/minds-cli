import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Database } from "bun:sqlite";
import { ConversationStore } from "../src/storage.ts";

test("persists runtime metadata and completed messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-storage-"));
  const store = new ConversationStore(join(root, "conversations.sqlite3"));
  const conversation = store.createConversation("Claude_Shannon", "identity", "test-model", "chat");
  store.addMessage(conversation.id, "user", "What is information?");
  store.addMessage(conversation.id, "mind", "A reduction in uncertainty.", "completed", "Claude_Shannon");
  store.addMessage(conversation.id, "mind", "discarded", "interrupted", "Claude_Shannon");

  const latest = store.latestConversation("Claude_Shannon", "identity");
  assert.equal(latest?.id, conversation.id);
  assert.equal(latest?.title, "What is information?");
  assert.equal(latest?.model, "test-model");
  assert.equal(latest?.responseMode, "chat");
  assert.equal(latest?.codexThreadId, null);
  assert.equal(latest?.appVersion, "0.4.0");
  assert.equal(latest?.promptContract, 3);
  store.setCodexThreadId(conversation.id, "codex-thread-1");
  assert.equal(store.findByCodexThreadId("codex-thread-1")?.id, conversation.id);
  const activityTime = store.getConversation(conversation.id)?.updatedAt;
  store.setResponseMode(conversation.id, "full");
  assert.equal(store.getConversation(conversation.id)?.responseMode, "full");
  store.setLastMindId("Claude_Shannon");
  assert.equal(store.lastMindId(), "Claude_Shannon");
  const blank = store.createConversation("Claude_Shannon", "0.1.0");
  store.deleteIfEmpty(blank.id);
  assert.equal(store.getConversation(blank.id), null);
  assert.deepEqual(store.messages(conversation.id).map((message) => message.status), ["completed", "completed", "interrupted"]);
  assert.deepEqual(store.messages(conversation.id).map((message) => message.mindId), [null, "Claude_Shannon", "Claude_Shannon"]);
  assert.equal(store.messageCounts().get(conversation.id), 3);
  store.setConversationMind(conversation.id, "Nikola_Tesla");
  assert.equal(store.getConversation(conversation.id)?.mindId, "Nikola_Tesla");
  assert.equal(store.getConversation(conversation.id)?.updatedAt, activityTime);
  store.close();
});

test("migrates expert columns and roles without losing conversations", async () => {
  const root = await mkdtemp(join(tmpdir(), "minds-legacy-storage-"));
  const path = join(root, "conversations.sqlite3");
  const legacy = new Database(path, { create: true });
  legacy.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      expert_id TEXT NOT NULL,
      expert_version TEXT NOT NULL,
      model TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'expert')),
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted', 'failed')),
      created_at TEXT NOT NULL
    );
    INSERT INTO conversations VALUES ('legacy', 'Claude_Shannon', '0.1.0', 'test-model', 'Old question', '2026-01-01', '2026-01-01');
    INSERT INTO messages (conversation_id, role, content, status, created_at) VALUES
      ('legacy', 'user', 'Old question', 'completed', '2026-01-01'),
      ('legacy', 'expert', 'Old answer', 'completed', '2026-01-01');
  `);
  legacy.close();

  const store = new ConversationStore(path);
  const conversation = store.getConversation("legacy");
  assert.equal(conversation?.mindId, "Claude_Shannon");
  assert.equal(conversation?.mindVersion, "0.1.0");
  assert.equal(conversation?.responseMode, "full");
  assert.equal(conversation?.codexThreadId, null);
  assert.deepEqual(store.messages("legacy").map((message) => [message.role, message.content]), [
    ["user", "Old question"],
    ["mind", "Old answer"],
  ]);
  assert.equal(store.messages("legacy")[1]?.mindId, "Claude_Shannon");
  const columns = store.database.query("PRAGMA table_info(conversations)").all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === "expert_id"), false);
  assert.equal(columns.some((column) => column.name === "mind_id"), true);
  assert.equal(columns.some((column) => column.name === "response_mode"), true);
  assert.equal(columns.some((column) => column.name === "codex_thread_id"), true);
  const messageColumns = store.database.query("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  assert.equal(messageColumns.some((column) => column.name === "mind_id"), true);
  store.close();
});
