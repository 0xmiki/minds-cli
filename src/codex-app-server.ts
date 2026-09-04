import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { InstalledMind, Message, MessageStatus, ResponseMode } from "./types.ts";
import { buildMindPrompt, historyItems } from "./prompt.ts";
import { MINDS_VERSION } from "./version.ts";

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
  timer: ReturnType<typeof setTimeout>;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
}

export interface TurnResult {
  text: string;
  status: "completed" | "interrupted" | "failed";
  error?: string;
}

export interface ThreadStartResult {
  threadId: string;
  model: string | null;
  hasName: boolean;
  messages: Array<Pick<Message, "role" | "content" | "status" | "createdAt">>;
}

export interface CodexAppServerOptions {
  command?: string;
  args?: string[];
  requestTimeoutMs?: number;
  spawnProcess?: (workspace: string) => ChildProcessWithoutNullStreams;
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
  private connecting: Promise<void> | null = null;
  private initialized = false;
  private connectionGeneration = 0;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private activeTurn: ActiveTurn | null = null;
  private bufferedTurnNotifications: JsonRpcNotification[] = [];
  private stderr = "";
  private readonly command: string;
  private readonly args: string[];
  private readonly requestTimeoutMs: number;
  private readonly spawnProcess?: (workspace: string) => ChildProcessWithoutNullStreams;

  constructor(options: CodexAppServerOptions = {}) {
    this.command = options.command ?? process.env.MINDS_CODEX_COMMAND ?? process.env.EXPERTS_CODEX_COMMAND ?? "codex";
    this.args = options.args ?? ["app-server"];
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.spawnProcess = options.spawnProcess;
  }

  get connected(): boolean {
    return this.initialized && this.child !== null;
  }

  get generation(): number {
    return this.connectionGeneration;
  }

  async prepare(workspace: string): Promise<void> {
    if (this.connected) return;
    if (!this.connecting) {
      this.connecting = this.connect(workspace).finally(() => {
        this.connecting = null;
      });
    }
    await this.connecting;
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
    await this.prepare(workspace);
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
          serviceName: "minds",
          threadSource: "minds-cli",
        }));
    let thread = record(response?.thread);
    if (!thread || typeof thread.id !== "string") {
      throw new Error(`Codex app-server returned an invalid thread/${resumeThreadId ? "resume" : "start"} response`);
    }
    const threadId = thread.id;
    const selectedModel = typeof response?.model === "string" ? response.model : model ?? null;
    let hasName = typeof thread.name === "string" && thread.name.trim() !== "";

    if (resumeThreadId && history.length === 0 && (!Array.isArray(thread.turns) || thread.turns.length === 0)) {
      const read = record(await this.request("thread/read", { threadId: resumeThreadId, includeTurns: true }));
      thread = record(read?.thread) ?? thread;
    }

    if (!resumeThreadId) {
      const items = historyItems(history);
      if (items.length > 0) {
        await this.request("thread/inject_items", { threadId, items });
        const firstUser = history.find((message) => message.role === "user")?.content.trim();
        if (firstUser) {
          await this.setThreadName(threadId, firstUser);
          hasName = true;
        }
      }
    }
    return { threadId, model: selectedModel, hasName, messages: resumeThreadId ? messagesFromThread(thread) : [] };
  }

  private async connect(workspace: string): Promise<void> {
    if (this.child) {
      if (this.initialized) return;
      throw new Error("Codex app-server is still initializing");
    }
    this.stderr = "";
    const child = this.spawnProcess?.(workspace) ?? spawn(this.command, this.args, {
      cwd: workspace,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8_000);
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.initialized = false;
      this.failAll(error);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      const detail = this.stderr.trim();
      this.failAll(new Error(`Codex app-server exited ${signal ?? code ?? "unexpectedly"}${detail ? `: ${detail}` : ""}`));
      this.child = null;
      this.initialized = false;
    });

    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));

    try {
      await this.request("initialize", {
        clientInfo: { name: "minds", title: "Minds", version: MINDS_VERSION },
        capabilities: null,
      });
      this.notify("initialized");
      this.initialized = true;
      this.connectionGeneration++;
    } catch (cause) {
      if (this.child === child) this.child = null;
      this.initialized = false;
      if (!child.killed) child.kill("SIGTERM");
      this.failAll(cause instanceof Error ? cause : new Error(String(cause)));
      throw cause;
    }
  }

  async listModels(): Promise<CodexModel[]> {
    const models: CodexModel[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const result = record(await this.request("model/list", { cursor, includeHidden: false }));
      if (!Array.isArray(result?.data)) throw new Error("Codex returned an invalid model list");
      models.push(...(result.data as CodexModel[]).filter((model) => !model.hidden));
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
      if (cursor && seen.has(cursor)) throw new Error("Codex repeated a model list page");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return models;
  }

  async modelDefaults(): Promise<{ model: string | null; effort: string | null }> {
    const result = record(await this.request("config/read", {}));
    const config = record(result?.config);
    return {
      model: typeof config?.model === "string" ? config.model : null,
      effort: typeof config?.model_reasoning_effort === "string" ? config.model_reasoning_effort : null,
    };
  }

  async turn(threadId: string, text: string, onDelta: (delta: string) => void, effort?: string | null): Promise<TurnResult> {
    if (!this.connected) throw new Error("Codex app-server is not connected");
    if (this.activeTurn) throw new Error("A mind turn is already running");
    const response = record(await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      ...(effort != null ? { effort } : {}),
    }));
    const turn = record(response?.turn);
    if (!turn || typeof turn.id !== "string") {
      throw new Error("Codex app-server returned an invalid turn/start response");
    }
    if (!this.connected) throw new Error("Codex app-server disconnected while starting the turn");
    return new Promise<TurnResult>((resolve, reject) => {
      this.activeTurn = {
        threadId,
        turnId: turn.id as string,
        phases: new Map(),
        streamed: new Map(),
        completed: new Map(),
        onDelta,
        resolve,
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

  async setThreadName(threadId: string, name: string): Promise<void> {
    const value = name.trim().slice(0, 72);
    if (!value) return;
    await this.request("thread/name/set", { threadId, name: value });
  }

  async unsubscribe(threadId: string): Promise<void> {
    if (!this.connected) return;
    await this.request("thread/unsubscribe", { threadId });
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.initialized = false;
    this.connecting = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this.failAll(new Error("Codex app-server closed"));
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ method, id, params });
      } catch (cause) {
        this.pending.delete(id);
        clearTimeout(timer);
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
      clearTimeout(pending.timer);
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
        if (this.bufferedTurnNotifications.length > 128) this.bufferedTurnNotifications.shift();
      }
      return;
    }
    const notificationThreadId = typeof params?.threadId === "string" ? params.threadId : null;
    if (!params || notificationThreadId !== active.threadId || notificationTurnId !== active.turnId) return;

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
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.bufferedTurnNotifications = [];
    if (this.activeTurn) {
      this.activeTurn.reject(error);
      this.activeTurn = null;
    }
  }
}
