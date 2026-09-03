import { expect, test } from "bun:test";
import { buildMindPrompt, historyItems } from "../src/prompt.ts";

const shannon = {
  directory: "/tmp/Claude_Shannon",
  manifest: { schema_version: 2 as const, id: "Claude_Shannon", name: "Claude Shannon", language: "en", description: "American mathematician and electrical engineer" },
};

test("uses only a small identity indicator plus the shared conversation layer", () => {
  const prompt = buildMindPrompt(shannon, "full");
  expect(prompt).toContain("You are Claude Shannon, American mathematician and electrical engineer.");
  expect(prompt).toContain("Develop the answer");
  expect(prompt).toContain("generic AI writing");
  expect(prompt).not.toContain("<core>");
  expect(prompt).not.toContain("<historical_scope>");
  expect(prompt).not.toContain("cognitive trace");
  expect(prompt).not.toContain("identity, not imitation");
  expect(prompt).not.toContain("Have an ego");
  expect(prompt).not.toContain("whole person");
});

test("gives chat mode a compact shared human conversation contract", () => {
  const prompt = buildMindPrompt(shannon, "chat");
  expect(prompt).toContain("Respond to the conversational act that actually occurred");
  expect(prompt).toContain("Do not default to customer-service behavior");
  expect(prompt).toContain("Allow ordinary conversation to remain ordinary");
  expect(prompt).toContain("Prefer a brief reply when a brief reply is enough");
  expect(prompt).not.toContain("Stay under 60 words");
  expect(prompt).not.toContain("Assistant reflex");
});

test("reconstructs only completed visible history", () => {
  const base = { conversationId: "c", createdAt: new Date(0).toISOString() };
  expect(historyItems([
    { ...base, id: 1, mindId: null, role: "user", content: "hello", status: "completed" },
    { ...base, id: 2, mindId: "Claude_Shannon", role: "mind", content: "partial", status: "interrupted" },
    { ...base, id: 3, mindId: "Claude_Shannon", role: "mind", content: "answer", status: "completed" },
  ])).toEqual([
    { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
  ]);
});

test("marks an identity handoff inside a shared thread", () => {
  const prompt = buildMindPrompt({ ...shannon, manifest: { ...shannon.manifest, id: "Nikola_Tesla", name: "Nikola Tesla" } }, "chat", true);
  expect(prompt).toContain("You have just entered this ongoing conversation");
  expect(prompt).toContain("never as your own past speech");
});
