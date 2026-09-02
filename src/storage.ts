import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { Conversation, Message, MessageRole, MessageStatus, NativeThreadSummary, ResponseMode } from "./types.ts";

interface ConversationRow {
  id: string;
  codex_thread_id: string | null;
  mind_id: string;
  mind_version: string;
  model: string | null;
  response_mode: ResponseMode;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  conversation_id: string;
  mind_id: string | null;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  created_at: string;
}

function conversationFromRow(row: ConversationRow): Conversation {
  return { id: row.id, codexThreadId: row.codex_thread_id ?? null, mindId: row.mind_id, mindVersion: row.mind_version, model: row.model, responseMode: row.response_mode ?? "full", title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function messageFromRow(row: MessageRow): Message {
  return { id: row.id, conversationId: row.conversation_id, mindId: row.mind_id ?? null, role: row.role, content: row.content, status: row.status, createdAt: row.created_at };
}

function columnNames(database: Database, table: string): Set<string> {
  const rows = database.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function migrateLegacySchema(database: Database): void {
  const conversations = columnNames(database, "conversations");
  if (conversations.has("expert_id") && !conversations.has("mind_id")) {
    database.exec("ALTER TABLE conversations RENAME COLUMN expert_id TO mind_id");
  }
  if (conversations.has("expert_version") && !conversations.has("mind_version")) {
    database.exec("ALTER TABLE conversations RENAME COLUMN expert_version TO mind_version");
  }

  const messageSchema = database.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'messages'").get() as { sql: string } | null;
  if (!messageSchema?.sql.includes("'expert'")) return;
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    database.transaction(() => {
      database.exec(`
        CREATE TABLE messages_minds_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          mind_id TEXT,
          role TEXT NOT NULL CHECK (role IN ('user', 'mind')),
          content TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted', 'failed')),
          created_at TEXT NOT NULL
        );
        INSERT INTO messages_minds_migration (id, conversation_id, mind_id, role, content, status, created_at)
        SELECT id, conversation_id,
          CASE WHEN role = 'expert' THEN (SELECT mind_id FROM conversations WHERE conversations.id = messages.conversation_id) ELSE NULL END,
          CASE role WHEN 'expert' THEN 'mind' ELSE role END, content, status, created_at
        FROM messages;
        DROP TABLE messages;
        ALTER TABLE messages_minds_migration RENAME TO messages;
      `);
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

export class ConversationStore {
  readonly database: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    migrateLegacySchema(this.database);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        codex_thread_id TEXT,
        mind_id TEXT NOT NULL,
        mind_version TEXT NOT NULL,
        model TEXT,
        response_mode TEXT NOT NULL DEFAULT 'chat' CHECK (response_mode IN ('full', 'chat')),
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        mind_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('user', 'mind')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted', 'failed')),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id, id);
      DROP INDEX IF EXISTS conversations_expert;
      CREATE INDEX IF NOT EXISTS conversations_mind ON conversations(mind_id, updated_at DESC);
    `);
    if (!columnNames(this.database, "conversations").has("response_mode")) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN response_mode TEXT NOT NULL DEFAULT 'full' CHECK (response_mode IN ('full', 'chat'))");
    }
    if (!columnNames(this.database, "conversations").has("codex_thread_id")) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN codex_thread_id TEXT");
    }
    if (!columnNames(this.database, "messages").has("mind_id")) {
      this.database.exec("ALTER TABLE messages ADD COLUMN mind_id TEXT");
      this.database.exec(`UPDATE messages SET mind_id = (
        SELECT conversations.mind_id FROM conversations WHERE conversations.id = messages.conversation_id
      ) WHERE role = 'mind' AND mind_id IS NULL`);
    }
    this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS conversations_codex_thread ON conversations(codex_thread_id) WHERE codex_thread_id IS NOT NULL");
    this.pruneEmptyConversations();
  }

  close(): void {
    this.database.close();
  }

  createConversation(mindId: string, mindVersion: string, model: string | null = null, responseMode: ResponseMode = "chat"): Conversation {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.database.query(`INSERT INTO conversations (id, mind_id, mind_version, model, response_mode, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`)
      .run(id, mindId, mindVersion, model, responseMode, now, now);
    return this.getConversation(id)!;
  }

  getConversation(id: string): Conversation | null {
    const row = this.database.query("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | null;
    return row ? conversationFromRow(row) : null;
  }

  latestConversation(mindId: string, mindVersion?: string): Conversation | null {
    const row = mindVersion
      ? this.database.query("SELECT * FROM conversations WHERE mind_id = ? AND mind_version = ? ORDER BY updated_at DESC LIMIT 1").get(mindId, mindVersion)
      : this.database.query("SELECT * FROM conversations WHERE mind_id = ? ORDER BY updated_at DESC LIMIT 1").get(mindId);
    return row ? conversationFromRow(row as ConversationRow) : null;
  }

  listConversations(mindId?: string): Conversation[] {
    const rows = mindId
      ? this.database.query("SELECT * FROM conversations WHERE mind_id = ? ORDER BY updated_at DESC").all(mindId)
      : this.database.query("SELECT * FROM conversations ORDER BY updated_at DESC").all();
    return (rows as ConversationRow[]).map(conversationFromRow);
  }

  findByCodexThreadId(threadId: string): Conversation | null {
    const row = this.database.query("SELECT * FROM conversations WHERE codex_thread_id = ?").get(threadId) as ConversationRow | null;
    return row ? conversationFromRow(row) : null;
  }

  setCodexThreadId(conversationId: string, threadId: string): void {
    this.database.query("UPDATE conversations SET codex_thread_id = ? WHERE id = ?").run(threadId, conversationId);
  }

  clearCodexThreadId(conversationId: string): void {
    this.database.query("UPDATE conversations SET codex_thread_id = NULL WHERE id = ?").run(conversationId);
  }

  setConversationMind(conversationId: string, mindId: string, mindVersion: string): void {
    this.database.query("UPDATE conversations SET mind_id = ?, mind_version = ? WHERE id = ?")
      .run(mindId, mindVersion, conversationId);
  }

  upsertNativeThread(thread: NativeThreadSummary, mindVersion: string): Conversation {
    const existing = this.findByCodexThreadId(thread.id);
    if (existing) {
      this.database.query("UPDATE conversations SET title = COALESCE(title, ?), updated_at = ? WHERE id = ?")
        .run(thread.title || null, thread.updatedAt, existing.id);
      return this.getConversation(existing.id)!;
    }
    const id = crypto.randomUUID();
    this.database.query(`INSERT INTO conversations (id, codex_thread_id, mind_id, mind_version, model, response_mode, title, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 'chat', ?, ?, ?)`)
      .run(id, thread.id, thread.mindId, mindVersion, thread.title || null, thread.createdAt, thread.updatedAt);
    return this.getConversation(id)!;
  }

  messages(conversationId: string): Message[] {
    const rows = this.database.query("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id").all(conversationId);
    return (rows as MessageRow[]).map(messageFromRow);
  }

  messageCount(conversationId: string): number {
    const row = this.database.query("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?").get(conversationId) as { count: number };
    return row.count;
  }

  messageCounts(): Map<string, number> {
    const rows = this.database.query("SELECT conversation_id, COUNT(*) AS count FROM messages GROUP BY conversation_id").all() as Array<{ conversation_id: string; count: number }>;
    return new Map(rows.map((row) => [row.conversation_id, row.count]));
  }

  deleteIfEmpty(conversationId: string): void {
    const conversation = this.getConversation(conversationId);
    if (!conversation || conversation.codexThreadId || this.messageCount(conversationId) > 0) return;
    this.database.query("DELETE FROM conversations WHERE id = ?").run(conversationId);
  }

  pruneEmptyConversations(): void {
    this.database.exec(`DELETE FROM conversations
      WHERE codex_thread_id IS NULL
        AND title IS NULL
        AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id)`);
  }

  replaceMessages(conversationId: string, messages: Array<Pick<Message, "role" | "content" | "status" | "createdAt"> & { mindId?: string | null }>): void {
    this.database.transaction(() => {
      this.database.query("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
      const conversation = this.getConversation(conversationId);
      const insert = this.database.query("INSERT INTO messages (conversation_id, mind_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const message of messages) {
        const mindId = message.role === "mind" ? message.mindId ?? conversation?.mindId ?? null : null;
        insert.run(conversationId, mindId, message.role, message.content, message.status, message.createdAt);
      }
      const firstUser = messages.find((message) => message.role === "user")?.content.trim().slice(0, 72) ?? null;
      const updatedAt = messages.at(-1)?.createdAt ?? new Date().toISOString();
      this.database.query("UPDATE conversations SET title = COALESCE(?, title), updated_at = ? WHERE id = ?")
        .run(firstUser, updatedAt, conversationId);
    })();
  }

  addMessage(conversationId: string, role: MessageRole, content: string, status: MessageStatus = "completed", mindId: string | null = null): Message {
    const now = new Date().toISOString();
    const result = this.database.query("INSERT INTO messages (conversation_id, mind_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(conversationId, role === "mind" ? mindId : null, role, content, status, now);
    const existing = this.getConversation(conversationId);
    if (!existing) throw new Error(`Unknown conversation ${conversationId}`);
    const title = existing.title ?? (role === "user" ? content.trim().slice(0, 72) : null);
    this.database.query("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, now, conversationId);
    const row = this.database.query("SELECT * FROM messages WHERE id = ?").get(Number(result.lastInsertRowid));
    return messageFromRow(row as MessageRow);
  }

  setModel(conversationId: string, model: string): void {
    this.database.query("UPDATE conversations SET model = ? WHERE id = ?").run(model, conversationId);
  }

  setResponseMode(conversationId: string, responseMode: ResponseMode): void {
    this.database.query("UPDATE conversations SET response_mode = ? WHERE id = ?")
      .run(responseMode, conversationId);
  }

  setLastMindId(mindId: string): void {
    this.database.query("INSERT INTO app_state (key, value) VALUES ('last_mind_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(mindId);
  }

  lastMindId(): string | null {
    const row = this.database.query("SELECT value FROM app_state WHERE key = 'last_mind_id'").get() as { value: string } | null;
    return row?.value ?? this.listConversations()[0]?.mindId ?? null;
  }
}
