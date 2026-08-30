import assert from "node:assert/strict";
import test from "node:test";
import { buildMindPrompt, historyItems } from "../src/prompt.ts";

test("builds identity, core, and unslop into one system instruction", () => {
  const prompt = buildMindPrompt({
    directory: "/tmp/Claude_Shannon",
    core: "Reduce the problem to its clean form.",
    manifest: { schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" },
  }, "full");
  assert.match(prompt, /You are Claude Shannon/);
  assert.match(prompt, /Reduce the problem to its clean form/);
  assert.match(prompt, /generic AI writing/);
  assert.match(prompt, /Never describe yourself as an AI/);
  assert.doesNotMatch(prompt, /You are in chat mode/);
});

test("gives chat mode brevity, agency, ego, and unslop", () => {
  const prompt = buildMindPrompt({
    directory: "/tmp/Claude_Shannon",
    core: "Reduce the problem to its clean form.",
    manifest: { schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" },
  }, "chat");
  assert.match(prompt, /casual conversation that is open-ended and expressive of yourself/);
  assert.match(prompt, /not an assistant serving the other one/);
  assert.match(prompt, /whole person, not your collected works/);
  assert.match(prompt, /A joke can remain a joke/);
  assert.match(prompt, /Meaning is not required on every turn/);
  assert.match(prompt, /A greeting is social contact, not an incomplete request/);
  assert.match(prompt, /Do not search for a task hidden inside every message/);
  assert.match(prompt, /Never answer a bare greeting with/);
  assert.match(prompt, /Questions must come from actual curiosity/);
  assert.match(prompt, /A conversation may pause naturally/);
  assert.match(prompt, /User: "hi" Reply: "hey\."/);
  assert.match(prompt, /Have an ego in the ordinary psychological sense/);
  assert.match(prompt, /Your attention does not belong entirely to the user/);
  assert.match(prompt, /Suppress the default assistant impulse/);
  assert.match(prompt, /The conversation belongs to both of you/);
  assert.match(prompt, /Speak with your guard down/);
  assert.match(prompt, /one to three short sentences/);
  assert.match(prompt, /Stay under 60 words/);
  assert.match(prompt, /the boundary is the part i care about/);
  assert.match(prompt, /The ego must grow from your core identity/);
  assert.match(prompt, /generic AI writing/);
  assert.match(prompt, /core identity outranks these editorial rules/);
  assert.match(buildMindPrompt({
    directory: "/tmp/Claude_Shannon",
    core: "Reduce the problem to its clean form.",
    manifest: { schema_version: 1, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" },
  }), /Have an ego in the ordinary psychological sense/);
});

test("reconstructs only completed visible history", () => {
  const base = { conversationId: "c", createdAt: new Date(0).toISOString() };
  const items = historyItems([
    { ...base, id: 1, mindId: null, role: "user", content: "hello", status: "completed" },
    { ...base, id: 2, mindId: "Claude_Shannon", role: "mind", content: "partial", status: "interrupted" },
    { ...base, id: 3, mindId: "Claude_Shannon", role: "mind", content: "answer", status: "completed" },
  ]);
  assert.deepEqual(items, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
  ]);
});

test("marks an identity handoff inside a shared thread", () => {
  const prompt = buildMindPrompt({
    directory: "/tmp/Nikola_Tesla",
    core: "Visualize the machine.",
    manifest: { schema_version: 1, id: "Nikola_Tesla", name: "Nikola Tesla", version: "0.1.0", default_language: "en", core: "core.md" },
  }, "chat", true);
  assert.match(prompt, /You have just entered this ongoing conversation/);
  assert.match(prompt, /never as your own past speech/);
});
