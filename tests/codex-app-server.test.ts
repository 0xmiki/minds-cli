import { afterEach, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { CodexAppServer } from "../src/codex-app-server.ts";
import { ConversationStore } from "../src/storage.ts";
import { ChatRuntime } from "../src/tui/chat-runtime.ts";

const servers: CodexAppServer[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function fakeProcess(log: Array<Record<string, unknown>>): ChildProcessWithoutNullStreams {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let killed = false;
  let threadNumber = 0;
  let turnNumber = 0;
  let failedStart = false;
  let buffer = "";
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    get killed() { return killed; },
    kill() {
      if (killed) return false;
      killed = true;
      queueMicrotask(() => emitter.emit("exit", 0, null));
      return true;
    },
  }) as unknown as ChildProcessWithoutNullStreams;

  const send = (message: unknown) => stdout.write(`${JSON.stringify(message)}\n`);
  const handle = (message: Record<string, any>) => {
    log.push(message);
    const id = message.id;
    if (message.method === "initialized") return;
    if (message.method === "initialize") {
      send({ id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" } });
      return;
    }
    if (message.method === "config/read") {
      send({ id, result: { config: { model: "configured-model", model_reasoning_effort: "high" } } });
      return;
    }
    if (message.method === "model/list") {
      const model = (name: string, hidden = false) => ({
        id: name, model: name, displayName: name, hidden, isDefault: false,
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: [{ reasoningEffort: "low", description: "Fast" }, { reasoningEffort: "high", description: "Thorough" }],
      });
      send({ id, result: message.params.cursor
        ? { data: [model("second")], nextCursor: null }
        : { data: [model("first"), model("hidden", true)], nextCursor: "page2" } });
      return;
    }
    if (message.method === "thread/start") {
      if (!failedStart && message.params.baseInstructions?.includes("Fail once")) {
        failedStart = true;
        send({ id, error: { code: -32000, message: "Synthetic start failure" } });
        return;
      }
      send({ id, result: { thread: { id: `thread-${++threadNumber}`, name: null, preview: "", turns: [] }, model: message.params.model ?? "fake-model" } });
      return;
    }
    if (message.method === "thread/resume") {
      if (message.params.threadId === "hang") return;
      send({ id, result: { thread: { id: message.params.threadId, name: "Saved thread", preview: "", turns: [] }, model: message.params.model ?? "fake-model" } });
      return;
    }
    if (message.method === "thread/read") {
      send({ id, result: { thread: { id: message.params.threadId, turns: [] } } });
      return;
    }
    if (message.method === "thread/inject_items") {
      send({ id, result: {} });
      return;
    }
    if (message.method === "thread/name/set" || message.method === "thread/unsubscribe" || message.method === "turn/interrupt") {
      send({ id, result: {} });
      return;
    }
    if (message.method === "turn/start") {
      const turnId = `turn-${++turnNumber}`;
      const threadId = message.params.threadId;
      const prompt = message.params.input[0]?.text;
      send({ id, result: { turn: { id: turnId, status: "inProgress" } } });
      if (prompt === "crash") {
        queueMicrotask(() => emitter.emit("exit", 1, null));
        return;
      }
      queueMicrotask(() => {
        if (prompt === "interrupt case") {
          send({ method: "item/started", params: { threadId, turnId, item: { type: "agentMessage", id: "partial", phase: "final_answer", text: "" } } });
          send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "partial", delta: "Partial answer" } });
          send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "interrupted", error: null } } });
          return;
        }
        send({ method: "item/started", params: { threadId: "stale-thread", turnId, item: { type: "agentMessage", id: "stale", phase: "final_answer", text: "" } } });
        send({ method: "item/agentMessage/delta", params: { threadId: "stale-thread", turnId, itemId: "stale", delta: "stale" } });
        send({ method: "item/started", params: { threadId, turnId, item: { type: "agentMessage", id: "commentary", phase: "commentary", text: "" } } });
        send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "commentary", delta: "hidden" } });
        send({ method: "item/started", params: { threadId, turnId, item: { type: "agentMessage", id: "final", phase: "final_answer", text: "" } } });
        send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "final", delta: "Signal over noise." } });
        send({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: "final", phase: "final_answer", text: "Signal over noise." } } });
        send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", error: null } } });
      });
      return;
    }
    send({ id, error: { code: -32601, message: `Unknown method ${message.method}` } });
  };

  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line) handle(JSON.parse(line) as Record<string, any>);
      newline = buffer.indexOf("\n");
    }
  });
  return child;
}

async function fixture(timeout = 250) {
  const root = await mkdtemp(join(tmpdir(), "minds-app-server-"));
  const log: Array<Record<string, any>> = [];
  let processStarts = 0;
  const server = new CodexAppServer({
    requestTimeoutMs: timeout,
    spawnProcess: () => {
      processStarts++;
      return fakeProcess(log);
    },
  });
  servers.push(server);
  return { root, log, server, processStarts: () => processStarts };
}

const shannon = {
  directory: "/tmp/Claude_Shannon",
  core: "Reduce a problem to its clean form.",
  coreHash: "shannon-hash",
  manifest: {
    schema_version: 1 as const,
    id: "Claude_Shannon",
    name: "Claude Shannon",
    version: "0.1.0",
    default_language: "en",
    core: "core.md",
  },
};

const nietzsche = {
  directory: "/tmp/Friedrich_Nietzsche",
  core: "Create values rather than inherit them.",
  coreHash: "nietzsche-hash",
  manifest: {
    schema_version: 1 as const,
    id: "Friedrich_Nietzsche",
    name: "Friedrich Nietzsche",
    version: "0.1.0",
    default_language: "en",
    core: "core.md",
  },
};

test("initializes once, opens multiple threads, and streams only the active final answer", async () => {
  const { root, log, server, processStarts } = await fixture();
  await Promise.all([server.prepare(root), server.prepare(root)]);

  const first = await server.start(shannon, [], root);
  let streamed = "";
  const result = await server.turn(first.threadId, "Current question", (delta) => { streamed += delta; });

  const second = await server.start(shannon, [], root);
  const interrupted = await server.turn(second.threadId, "interrupt case", () => {});

  expect(processStarts()).toBe(1);
  expect(server.generation).toBe(1);
  expect(first.model).toBe("fake-model");
  expect(first.threadId).toBe("thread-1");
  expect(second.threadId).toBe("thread-2");
  expect(streamed).toBe("Signal over noise.");
  expect(result).toEqual({ text: "Signal over noise.", status: "completed", error: undefined });
  expect(interrupted).toMatchObject({ text: "Partial answer", status: "interrupted" });
  expect(log.filter((item) => item.method === "initialize")).toHaveLength(1);
  expect(log.filter((item) => item.method === "thread/start")).toHaveLength(2);
  expect(log.find((item) => item.method === "thread/start")?.params).toMatchObject({
    ephemeral: false,
    serviceName: "minds",
    threadSource: "minds-cli",
  });
});

test("restores legacy history with valid response items", async () => {
  const { root, log, server } = await fixture();
  await server.start(shannon, [{
    id: 1,
    conversationId: "c",
    mindId: null,
    role: "user",
    content: "Earlier question",
    status: "completed",
    createdAt: new Date(0).toISOString(),
  }], root);

  const injected = log.find((item) => item.method === "thread/inject_items");
  expect(injected?.params.items[0]).toMatchObject({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: "Earlier question" }],
  });
});

test("times out a request that never receives a response", async () => {
  const { root, server } = await fixture(20);
  await expect(server.start(shannon, [], root, undefined, "chat", "hang"))
    .rejects.toThrow("Codex app-server request timed out: thread/resume");
});

test("reuses one process while conversations, minds, and response modes change", async () => {
  const { root, log, server, processStarts } = await fixture();
  const store = new ConversationStore(join(root, "conversations.sqlite3"));
  const paths = {
    data: root,
    minds: join(root, "minds"),
    database: join(root, "conversations.sqlite3"),
    workspaces: join(root, "workspaces"),
  };
  try {
    const conversation = store.createConversation("Claude_Shannon", "0.1.0", null, "chat");
    const runtime = new ChatRuntime(server, shannon, store, paths, conversation);
    await runtime.prepare();
    await runtime.ask("First question", () => {});
    const firstThreadId = store.getConversation(conversation.id)?.codexThreadId;

    const requestsAfterFirstTurn = log.length;
    runtime.setResponseMode("full");
    expect(log).toHaveLength(requestsAfterFirstTurn);
    await runtime.ask("Second question", () => {});

    const requestsAfterModeChange = log.length;
    runtime.switchMind(nietzsche);
    expect(log).toHaveLength(requestsAfterModeChange);
    await runtime.ask("Third question", () => {});

    const startsBeforeNew = log.filter((item) => item.method === "thread/start").length;
    runtime.newConversation();
    expect(log.filter((item) => item.method === "thread/start")).toHaveLength(startsBeforeNew);
    await runtime.ask("A fresh question", () => {});

    expect(firstThreadId).toBe("thread-1");
    expect(processStarts()).toBe(1);
    expect(log.filter((item) => item.method === "initialize")).toHaveLength(1);
    expect(log.filter((item) => item.method === "thread/start")).toHaveLength(2);
    const resumes = log.filter((item) => item.method === "thread/resume");
    expect(resumes).toHaveLength(2);
    expect(resumes[0]?.params.baseInstructions).not.toContain("<core>");
    expect(resumes[0]?.params.baseInstructions).not.toContain("Reduce a problem to its clean form");
    expect(resumes[0]?.params.baseInstructions).toContain("Develop the answer");
    expect(resumes[1]?.params.baseInstructions).toContain("You are Friedrich Nietzsche");
    expect(resumes[1]?.params.baseInstructions).toContain("<identity_handoff>");
  } finally {
    store.close();
  }
});

test("does not attribute transport failures to a mind or duplicate a retried prompt", async () => {
  const { root, log, server } = await fixture();
  const store = new ConversationStore(join(root, "conversations.sqlite3"));
  const paths = { data: root, minds: join(root, "minds"), database: join(root, "conversations.sqlite3"), workspaces: join(root, "workspaces") };
  const fragileMind = { ...shannon, manifest: { ...shannon.manifest, description: "Fail once" } };
  try {
    const conversation = store.createConversation("Claude_Shannon", "0.1.0", null, "chat");
    const runtime = new ChatRuntime(server, fragileMind, store, paths, conversation);
    const failed = await runtime.ask("Keep this prompt", () => {});
    expect(failed).toMatchObject({ status: "failed", error: "Synthetic start failure" });
    expect(store.messages(conversation.id).map((message) => message.role)).toEqual(["user"]);

    const retried = await runtime.ask("Keep this prompt", () => {}, false);
    expect(retried.status).toBe("completed");
    expect(store.messages(conversation.id).filter((message) => message.role === "user")).toHaveLength(1);
    expect(log.filter((item) => item.method === "thread/inject_items")).toHaveLength(0);
  } finally {
    store.close();
  }
});

test("reconnects and resumes the same thread after the app-server exits", async () => {
  const { root, log, server, processStarts } = await fixture();
  const store = new ConversationStore(join(root, "conversations.sqlite3"));
  const paths = { data: root, minds: join(root, "minds"), database: join(root, "conversations.sqlite3"), workspaces: join(root, "workspaces") };
  try {
    const conversation = store.createConversation("Claude_Shannon", "0.1.0", null, "chat");
    const runtime = new ChatRuntime(server, shannon, store, paths, conversation);
    const crashed = await runtime.ask("crash", () => {});
    expect(crashed.status).toBe("failed");
    const threadId = store.getConversation(conversation.id)?.codexThreadId;

    const recovered = await runtime.ask("Try again", () => {}, false);
    expect(recovered.status).toBe("completed");
    expect(processStarts()).toBe(2);
    expect(log.filter((item) => item.method === "initialize")).toHaveLength(2);
    expect(log.findLast((item) => item.method === "thread/resume")?.params.threadId).toBe(threadId);
  } finally {
    store.close();
  }
});

test("loads configured defaults and all visible model pages", async () => {
  const { root, server } = await fixture();
  await server.prepare(root);
  expect((await server.listModels()).map((model) => model.model)).toEqual(["first", "second"]);
  expect(await server.modelDefaults()).toEqual({ model: "configured-model", effort: "high" });
});

test("model and reasoning changes persist and apply to resumed and new turns", async () => {
  const { root, log, server } = await fixture();
  const store = new ConversationStore(join(root, "conversations.sqlite3"));
  const paths = { data: root, minds: join(root, "minds"), database: join(root, "conversations.sqlite3"), workspaces: join(root, "workspaces") };
  try {
    const conversation = store.createConversation("Claude_Shannon");
    const runtime = new ChatRuntime(server, shannon, store, paths, conversation, "original-model");
    await runtime.ask("First", () => {});
    const threadId = runtime.currentConversation.codexThreadId;
    runtime.setModel("second", "high");
    expect(store.getConversation(runtime.id)).toMatchObject({ model: "second", reasoningEffort: "high" });
    await runtime.ask("Next", () => {});
    expect(runtime.currentConversation.codexThreadId).toBe(threadId);
    expect(log.filter((item) => item.method === "thread/resume").at(-1)?.params.model).toBe("second");
    expect(log.filter((item) => item.method === "turn/start").at(-1)?.params.effort).toBe("high");
    const resumed = new ChatRuntime(server, shannon, store, paths, store.getConversation(runtime.id)!);
    expect(resumed.model).toBe("second");
    expect(resumed.reasoningEffort).toBe("high");
    runtime.newConversation();
    expect(runtime.model).toBe("second");
    expect(runtime.reasoningEffort).toBe("high");
    await runtime.ask("Fresh", () => {});
    expect(log.filter((item) => item.method === "thread/start").at(-1)?.params.model).toBe("second");
    expect(log.filter((item) => item.method === "turn/start").at(-1)?.params.effort).toBe("high");
  } finally {
    store.close();
  }
});
