#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let turnNumber = 0;
const log = (message) => {
  const path = process.env.MINDS_FAKE_LOG ?? process.env.EXPERTS_FAKE_LOG;
  if (path) appendFileSync(path, `${JSON.stringify(message)}\n`);
};

process.stdin.resume();
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  log(message);
  if (message.method === "initialized") return;
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "linux" } });
    return;
  }
  if (message.method === "thread/start") {
    send({ id: message.id, result: { thread: { id: "thread-1" }, model: message.params.model ?? "fake-model" } });
    return;
  }
  if (message.method === "thread/inject_items") {
    const invalid = message.params.items.findIndex((item) => item.type !== "message");
    if (invalid >= 0) {
      send({ id: message.id, error: { code: -32602, message: `items[${invalid}] is not a valid response item: missing field \`type\`` } });
      return;
    }
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "turn/start") {
    const turnId = `turn-${++turnNumber}`;
    const prompt = message.params.input[0]?.text;
    send({ id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
    setTimeout(() => {
      if (prompt === "interrupt case") {
        send({ method: "item/started", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", id: "partial", phase: "final_answer", text: "" } } });
        send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId, itemId: "partial", delta: "Partial answer" } });
        send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "interrupted", error: null } } });
        return;
      }
      const answer = prompt === "markdown demo"
        ? "## A clean question\n\n**Information** removes uncertainty.\n\n- Separate signal from noise\n- Test the limiting case\n\n```ts\nconst bits = -Math.log2(probability)\n```"
        : prompt === "equation demo"
          ? "## A good boundary\n\nMagnetic dipole fields weaken roughly as\n\n\\[B\\propto \\frac{1}{r^3}\\]\n\nEnergy follows $E=mc^2$."
          : "Signal over noise.";
      send({ method: "item/started", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", id: "commentary", phase: "commentary", text: "" } } });
      send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId, itemId: "commentary", delta: "hidden" } });
      send({ method: "item/started", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", id: "final", phase: "final_answer", text: "" } } });
      send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId, itemId: "final", delta: answer } });
      send({ method: "item/completed", params: { threadId: "thread-1", turnId, item: { type: "agentMessage", id: "final", phase: "final_answer", text: answer } } });
      send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: turnId, status: "completed", error: null } } });
    }, 5);
    return;
  }
  send({ id: message.id, error: { code: -32601, message: `Unknown method ${message.method}` } });
});
