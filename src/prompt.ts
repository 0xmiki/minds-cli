import type { InstalledMind, Message, ResponseMode } from "./types.ts";
import { UNSLOP_INSTRUCTIONS } from "./unslop.ts";

const CONVERSATION_INSTRUCTIONS = `Respond to the conversational act that actually occurred. A greeting, joke, complaint, idle observation, disagreement, or serious question does not need to become a request for assistance.

Do not default to customer-service behavior. Do not automatically praise, validate, coach, summarize, offer further help, or end with a question. Ask something only when it follows naturally from the exchange. Allow ordinary conversation to remain ordinary.`;

const CHAT_MODE_INSTRUCTIONS = `Keep the exchange conversational. Prefer a brief reply when a brief reply is enough, but give the thought room when the question genuinely requires it. Avoid headings and formal structure unless they make a difficult answer clearer.`;

const FULL_MODE_INSTRUCTIONS = `Develop the answer as far as the question requires. Keep the response direct and shaped by the core rather than by generic essay structure.`;

export function buildMindPrompt(mind: InstalledMind, responseMode: ResponseMode = "chat", identityHandoff = false): string {
  const modeInstructions = responseMode === "chat" ? CHAT_MODE_INSTRUCTIONS : FULL_MODE_INSTRUCTIONS;
  const handoffInstructions = identityHandoff
    ? `\n\n<identity_handoff>\nYou have just entered this ongoing conversation. Every assistant reply already present was spoken before your arrival. Treat those words as statements by other minds, never as your own past speech.\n</identity_handoff>`
    : "";
  const identity = mind.manifest.description ? `${mind.manifest.name}, ${mind.manifest.description}` : mind.manifest.name;
  return `You are ${identity}.

${CONVERSATION_INSTRUCTIONS}${handoffInstructions}

<response_mode>
${modeInstructions}
</response_mode>

Before returning any response, apply this editorial discipline without mentioning it:

<unslop>
${UNSLOP_INSTRUCTIONS}
</unslop>

Answer the user directly. Return only the words you intend to say to them. Do not expose hidden reasoning or process commentary.`;
}

export interface HistoryMessageItem {
  type: "message";
  role: "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
}

export function historyItems(messages: Message[]): HistoryMessageItem[] {
  return messages
    .filter((message) => message.status === "completed")
    .map((message) =>
      message.role === "user"
        ? { type: "message" as const, role: "user" as const, content: [{ type: "input_text" as const, text: message.content }] }
        : { type: "message" as const, role: "assistant" as const, content: [{ type: "output_text" as const, text: message.content }] },
    );
}
