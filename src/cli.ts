import { spawnSync } from "node:child_process";
import { MINDS_VERSION } from "./version.ts";
import { completionScript } from "./completions.ts";
import { addMind, getInstalledMind, listInstalledMinds, removeMind } from "./mind.ts";
import { getPaths } from "./paths.ts";
import { ConversationStore } from "./storage.ts";
import { runChat } from "./tui/index.tsx";
import type { ResponseMode } from "./types.ts";

const HELP = `minds ${MINDS_VERSION}

Usage:
  minds                         Open the last-used mind in a new conversation
  minds add <wikipedia-slug>    Save another mind
  minds list                    List available minds
  minds chat <slug> [options]   Start a conversation with a mind
  minds chats [slug]            List saved conversations
  minds remove <slug>           Remove an installed mind
  minds doctor                  Check Bun, Codex, and local data
  minds completions <shell>     Print Tab completion for bash, zsh, or fish

Chat options:
  --model <model>                 Override the Codex model
  --mode <full|chat>              Choose the response style

Bundled minds:
  Aristotle
  Claude_Shannon
  Friedrich_Nietzsche
  Nikola_Tesla`;

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function responseModeOption(args: string[]): ResponseMode | undefined {
  const value = optionValue(args, "--mode");
  if (value === undefined || value === "full" || value === "chat") return value;
  throw new Error("--mode must be full or chat");
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export async function runCli(args = process.argv.slice(2)): Promise<number> {
  const paths = getPaths();
  const command = args[0];
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(HELP);
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(MINDS_VERSION);
    return 0;
  }

  if (command === "add") {
    const id = args[1];
    if (!id) throw new Error("Usage: minds add <wikipedia-slug>");
    const mind = await addMind(paths.minds, id);
    console.log(`Added ${mind.manifest.name}`);
    return 0;
  }

  if (command === "list") {
    const minds = await listInstalledMinds(paths.minds);
    if (minds.length === 0) {
      console.log("No minds are available. Reinstall Minds or add one from Wikipedia.");
      return 0;
    }
    for (const mind of minds) console.log(`${mind.manifest.id}\t${mind.manifest.name}${mind.manifest.description ? `\t${mind.manifest.description}` : ""}`);
    return 0;
  }

  if (command === "remove") {
    const id = args[1];
    if (!id) throw new Error("Usage: minds remove <slug>");
    await removeMind(paths.minds, id);
    console.log(`Removed ${id}`);
    return 0;
  }

  if (command === "doctor") {
    const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });
    console.log(`Bun\t${Bun.version}`);
    console.log(`Data\t${paths.data}`);
    if (codex.status !== 0 || !codex.stdout.trim()) {
      console.log("Codex\tnot found");
      return 1;
    }
    console.log(`Codex\t${codex.stdout.trim()}`);
    console.log(`Minds\t${(await listInstalledMinds(paths.minds)).length} available`);
    return 0;
  }

  if (command === "completions") {
    console.log(completionScript(args[1] ?? ""));
    return 0;
  }

  const store = new ConversationStore(paths.database);
  try {
    if (command === "chats") {
      const conversations = store.listConversations(args[1]);
      if (conversations.length === 0) {
        console.log("No saved conversations.");
        return 0;
      }
      for (const conversation of conversations) {
        console.log(`${conversation.id}\t${conversation.mindId}\t${formatDate(conversation.updatedAt)}\t${conversation.title ?? "Untitled"}`);
      }
      return 0;
    }

    if (command === "chat") {
      const id = args[1];
      if (!id) throw new Error("Usage: minds chat <slug> [--model <model>] [--mode <full|chat>]");
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Chat requires an interactive terminal");
      const mind = await getInstalledMind(paths.minds, id);
      await runChat(mind, store, paths, {
        fresh: true,
        model: optionValue(args, "--model"),
        responseMode: responseModeOption(args),
      });
      return 0;
    }

    if (command) throw new Error(`Unknown command: ${command}\n\n${HELP}`);
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.log(HELP);
      return 0;
    }
    const minds = await listInstalledMinds(paths.minds);
    if (minds.length === 0) {
      console.log("No minds are available. Reinstall Minds or add one from Wikipedia.");
      return 0;
    }
    const lastMindId = store.lastMindId();
    const selected = minds.find((mind) => mind.manifest.id === lastMindId) ?? minds[0]!;
    await runChat(selected, store, paths, { fresh: true });
    return 0;
  } finally {
    store.close();
  }
}
