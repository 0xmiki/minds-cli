import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import type { InstalledMind, Message, MessageStatus, NativeThreadSummary, ResponseMode } from "./types.ts";
import { buildMindPrompt, historyItems } from "./prompt.ts";

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface TurnResult {
  text: string;
  status: "completed" | "interrupted" | "failed";
  error?: string;
}

export interface ThreadStartResult {
  threadId: string;
  messages: Array<Pick<Message, "role" | "content" | "status" | "createdAt">>;
}

interface ActiveTurn {
  threadId: string;
  turnId: string;
  phases: Map<string, string | null>;
  streamed: Map<string, string>;
  completed: Map<string, string>;
  onDelta(delta: string): void;
  resolve(result: TurnResult): void;
  reject(error: Error): void;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function messagesFromThread(value: unknown): Array<Pick<Message, "role" | "content" | "status" | "createdAt">> {
  const thread = record(value);
  if (!thread || !Array.isArray(thread.turns)) return [];
  const messages: Array<Pick<Message, "role" | "content" | "status" | "createdAt">> = [];
  for (const turnValue of thread.turns) {
    const turn = record(turnValue);
    if (!turn || !Array.isArray(turn.items)) continue;
    const status: MessageStatus = turn.status === "failed" ? "failed" : turn.status === "interrupted" ? "interrupted" : "completed";
    const timestamp = typeof turn.completedAt === "number"
      ? turn.completedAt
      : typeof turn.startedAt === "number" ? turn.startedAt : Date.now() / 1_000;
    const createdAt = new Date(timestamp * 1_000).toISOString();
    for (const itemValue of turn.items) {
      const item = record(itemValue);
      if (item?.type === "userMessage" && Array.isArray(item.content)) {
        const content = item.content
          .map(record)
          .filter((part): part is Record<string, unknown> => part?.type === "text" && typeof part.text === "string")
          .map((part) => part.text as string)
          .join("\n")
          .trim();
        if (content) messages.push({ role: "user", content, status: "completed", createdAt });
      }
      if (item?.type === "agentMessage" && typeof item.text === "string" && (item.phase === "final_answer" || item.phase == null)) {
        const content = item.text.trim();
        if (content) messages.push({ role: "mind", content, status, createdAt });
      }
    }
  }
  return messages;
}

export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private activeTurn: ActiveTurn | null = null;
  private bufferedTurnNotifications: JsonRpcNotification[] = [];
  private stderr = "";
  private threadId: string | null = null;
  private selectedModel: string | null = null;
  private threadNameSet = false;

  get model(): string | null {
    return this.selectedModel;
  }

  get hasThread(): boolean {
    return this.threadId !== null;
  }

  async prepare(workspace: string): Promise<void> {
    if (!this.child) await this.connect(workspace);
  }

  async start(
    mind: InstalledMind,
    history: Message[],
    workspace: string,
    model?: string,
    responseMode: ResponseMode = "chat",
    resumeThreadId?: string,
    ephemeral = false,
    identityHandoff = false,
  ): Promise<ThreadStartResult> {
    if (!this.child) await this.connect(workspace);
    const instructions = buildMindPrompt(mind, responseMode, identityHandoff);
    const response = resumeThreadId
      ? record(await this.request("thread/resume", {
          threadId: resumeThreadId,
          model: model ?? null,
          cwd: workspace,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          baseInstructions: instructions,
        }))
      : record(await this.request("thread/start", {
          model: model ?? null,
          cwd: workspace,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          baseInstructions: instructions,
          ephemeral,
          threadSource: "minds-cli",
        }));
    let thread = record(response?.thread);
    if (!thread || typeof thread.id !== "string") {
      throw new Error(`Codex app-server returned an invalid thread/${resumeThreadId ? "resume" : "start"} response`);
    }
    this.threadId = thread.id;
    this.selectedModel = typeof response?.model === "string" ? response.model : model ?? null;
    this.threadNameSet = typeof thread.name === "string" && thread.name.trim() !== "" || typeof thread.preview === "string" && thread.preview.trim() !== "";

    if (resumeThreadId && (!Array.isArray(thread.turns) || thread.turns.length === 0)) {
      const read = record(await this.request("thread/read", { threadId: resumeThreadId, includeTurns: true }));
      thread = record(read?.thread) ?? thread;
    }

    if (!resumeThreadId) {
      const items = historyItems(history);
      if (items.length > 0) {
        await this.request("thread/inject_items", { threadId: this.threadId, items });
        const firstUser = history.find((message) => message.role === "user")?.content.trim();
        if (firstUser) {
          await this.request("thread/name/set", { threadId: this.threadId, name: firstUser.slice(0, 72) }).catch(() => undefined);
          this.threadNameSet = true;
        }
      }
    }
    return { threadId: this.threadId, messages: resumeThreadId ? messagesFromThread(thread) : [] };
  }

  private async connect(workspace: string): Promise<void> {
    if (this.child) throw new Error("Codex app-server is already running");
    const child = spawn(process.env.MINDS_CODEX_COMMAND ?? process.env.EXPERTS_CODEX_COMMAND ?? "codex", ["app-server", "--stdio"], {
      cwd: workspace,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8_000);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      const detail = this.stderr.trim();
      this.failAll(new Error(`Codex app-server exited ${signal ?? code ?? "unexpectedly"}${detail ? `: ${detail}` : ""}`));
      this.child = null;
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "minds", title: "minds", version: "0.3.1" },
      capabilities: null,
    });
    this.notify("initialized");

  }

  async listThreads(workspaces: Array<{ mindId: string; workspace: string }>): Promise<NativeThreadSummary[]> {
    if (!this.child) {
      const firstWorkspace = workspaces[0]?.workspace;
      if (!firstWorkspace) return [];
      await this.connect(firstWorkspace);
    }
    const mindByWorkspace = new Map(workspaces.map((item) => [resolve(item.workspace), item.mindId]));
    const result: NativeThreadSummary[] = [];
    let cursor: string | null = null;
    do {
      const response = record(await this.request("thread/list", {
        limit: 50,
        cursor,
        cwd: [...mindByWorkspace.keys()],
        sourceKinds: ["appServer"],
        sortKey: "recency_at",
        sortDirection: "desc",
      }));
      const threads = Array.isArray(response?.data) ? response.data : [];
      for (const value of threads) {
        const thread = record(value);
        if (!thread || typeof thread.id !== "string" || thread.ephemeral === true || typeof thread.cwd !== "string") continue;
        const mindId = mindByWorkspace.get(resolve(thread.cwd));
        if (!mindId) continue;
        const createdAt = new Date((typeof thread.createdAt === "number" ? thread.createdAt : Date.now() / 1_000) * 1_000).toISOString();
        const updatedAt = new Date((typeof thread.recencyAt === "number" ? thread.recencyAt : typeof thread.updatedAt === "number" ? thread.updatedAt : Date.now() / 1_000) * 1_000).toISOString();
        const title = typeof thread.name === "string" && thread.name.trim()
          ? thread.name.trim()
          : typeof thread.preview === "string" ? thread.preview.trim().slice(0, 72) : "";
        result.push({ id: thread.id, mindId, title, createdAt, updatedAt });
      }
      cursor = typeof response?.nextCursor === "string" ? response.nextCursor : null;
    } while (cursor);
    return result;
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.child) throw new Error("Codex app-server is not connected");
    await this.request("thread/delete", { threadId });
  }

  async turn(text: string, onDelta: (delta: string) => void): Promise<TurnResult> {
    if (!this.threadId) throw new Error("Codex thread has not started");
    if (this.activeTurn) throw new Error("A mind turn is already running");
    const response = record(await this.request("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text, text_elements: [] }],
    }));
    const turn = record(response?.turn);
    if (!turn || typeof turn.id !== "string") {
      throw new Error("Codex app-server returned an invalid turn/start response");
    }
    return new Promise<TurnResult>((resolve, reject) => {
      this.activeTurn = {
        threadId: this.threadId!,
        turnId: turn.id as string,
        phases: new Map(),
        streamed: new Map(),
        completed: new Map(),
        onDelta,
        resolve: (result) => {
          if (!this.threadNameSet) {
            this.threadNameSet = true;
            void this.request("thread/name/set", { threadId: this.threadId, name: text.trim().slice(0, 72) }).catch(() => undefined);
          }
          resolve(result);
        },
        reject,
      };
      const buffered = this.bufferedTurnNotifications.splice(0);
      for (const notification of buffered) this.handleNotification(notification);
    });
  }

  async interrupt(): Promise<void> {
    const active = this.activeTurn;
    if (!active) return;
    await this.request("turn/interrupt", { threadId: active.threadId, turnId: active.turnId });
  }

  close(): void {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this.failAll(new Error("Codex app-server closed"));
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write({ method, id, params });
      } catch (cause) {
        this.pending.delete(id);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      }
    });
  }

  private notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  private write(message: unknown): void {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server is not available");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
    } catch {
      return;
    }
    if ("id" in message && typeof message.id === "number" && !("method" in message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "Codex app-server request failed"));
      else pending.resolve(message.result);
      return;
    }
    if ("method" in message && typeof message.id === "number") {
      this.write({ id: message.id, error: { code: -32601, message: `Unsupported server request ${message.method}` } });
      return;
    }
    if ("method" in message) this.handleNotification(message);
  }

  private handleNotification(message: JsonRpcNotification): void {
    const active = this.activeTurn;
    const params = record(message.params);
    const nestedTurn = record(params?.turn);
    const notificationTurnId = typeof params?.turnId === "string"
      ? params.turnId
      : typeof nestedTurn?.id === "string" ? nestedTurn.id : null;
    if (!active) {
      if (notificationTurnId && (message.method.startsWith("item/") || message.method === "turn/completed")) {
        this.bufferedTurnNotifications.push(message);
      }
      return;
    }
    if (!params || notificationTurnId !== active.turnId) return;

    if (message.method === "item/started") {
      const item = record(params.item);
      if (item?.type === "agentMessage" && typeof item.id === "string") {
        active.phases.set(item.id, typeof item.phase === "string" ? item.phase : null);
      }
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      const itemId = typeof params.itemId === "string" ? params.itemId : null;
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (itemId && delta && active.phases.get(itemId) === "final_answer") {
        active.streamed.set(itemId, `${active.streamed.get(itemId) ?? ""}${delta}`);
        active.onDelta(delta);
      }
      return;
    }
    if (message.method === "item/completed") {
      const item = record(params.item);
      if (item?.type === "agentMessage" && item.phase === "final_answer" && typeof item.id === "string" && typeof item.text === "string") {
        active.completed.set(item.id, item.text);
        const streamed = active.streamed.get(item.id) ?? "";
        if (item.text.startsWith(streamed)) active.onDelta(item.text.slice(streamed.length));
      }
      return;
    }
    if (message.method === "turn/completed") {
      const turn = record(params.turn);
      const status = turn?.status;
      const error = record(turn?.error);
      const completeText = [...active.completed.values()].join("\n\n").trim();
      const text = completeText || [...active.streamed.values()].join("\n\n").trim();
      this.activeTurn = null;
      active.resolve({
        text,
        status: status === "interrupted" || status === "failed" ? status : "completed",
        error: typeof error?.message === "string" ? error.message : undefined,
      });
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (this.activeTurn) {
      this.activeTurn.reject(error);
      this.activeTurn = null;
    }
  }
}
