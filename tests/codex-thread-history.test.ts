import { expect, test } from "bun:test";
import { messagesFromThread } from "../src/codex-app-server.ts";

test("reconstructs visible messages from persistent Codex turns", () => {
  const messages = messagesFromThread({
    turns: [
      {
        id: "turn-1",
        status: "completed",
        startedAt: 1_700_000_000,
        completedAt: 1_700_000_001,
        items: [
          { type: "userMessage", id: "user-1", content: [{ type: "text", text: "What is information?", text_elements: [] }] },
          { type: "agentMessage", id: "commentary", text: "Hidden reasoning", phase: "commentary" },
          { type: "agentMessage", id: "answer", text: "A reduction in uncertainty.", phase: "final_answer" },
        ],
      },
    ],
  });
  expect(messages.map((message) => [message.role, message.content, message.status])).toEqual([
    ["user", "What is information?", "completed"],
    ["mind", "A reduction in uncertainty.", "completed"],
  ]);
});
