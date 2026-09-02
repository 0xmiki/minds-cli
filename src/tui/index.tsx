import { render } from "@opentui/solid";
import type { MindsPaths } from "../paths.ts";
import { listInstalledMinds } from "../mind.ts";
import { ConversationStore } from "../storage.ts";
import type { InstalledMind, ResponseMode } from "../types.ts";
import { Chat } from "./chat.tsx";
import { Picker } from "./picker.tsx";
import { theme } from "./theme.ts";

async function mount(node: () => unknown): Promise<void> {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  await render(node as never, {
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    backgroundColor: theme.background,
    consoleMode: "disabled",
    openConsoleOnError: false,
    targetFps: 60,
    onDestroy: finish,
  });
  await done;
}

export async function pickMind(minds: InstalledMind[], store: ConversationStore): Promise<string | null> {
  if (minds.length === 0) return null;
  let selected: string | null = null;
  await mount(() => <Picker minds={minds} store={store} onDone={(id) => { selected = id; }} />);
  return selected;
}

export async function runChat(
  mind: InstalledMind,
  store: ConversationStore,
  paths: MindsPaths,
  options: { fresh?: boolean; model?: string; responseMode?: ResponseMode } = {},
): Promise<void> {
  const minds = await listInstalledMinds(paths.minds);
  await mount(() => <Chat mind={mind} minds={minds} store={store} paths={paths} {...options} />);
}
