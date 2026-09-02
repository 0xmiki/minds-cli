import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  TextAttributes,
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import { CodexAppServer } from "../codex-app-server.ts";
import { listInstalledMinds } from "../mind.ts";
import type { MindsPaths } from "../paths.ts";
import { ConversationStore } from "../storage.ts";
import type { Conversation, InstalledMind, Message, MessageStatus, ResponseMode } from "../types.ts";
import { ChatRuntime } from "./chat-runtime.ts";
import { CommandPalette } from "./command-palette.tsx";
import { filterSlashCommands, SLASH_COMMANDS } from "./commands.ts";
import { Composer } from "./composer.tsx";
import { MindSwitcher } from "./mind-switcher.tsx";
import { MindMarkdown } from "./markdown.tsx";
import { ThreadSwitcher } from "./thread-switcher.tsx";
import { theme } from "./theme.ts";

interface ChatProps {
  mind: InstalledMind;
  minds?: InstalledMind[];
  store: ConversationStore;
  paths: MindsPaths;
  fresh?: boolean;
  model?: string;
  responseMode?: ResponseMode;
}

function duration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1_000)}s`;
}

export function UserMessage(props: { message: Message }) {
  return (
    <box
      width="100%"
      flexDirection="row"
      justifyContent="flex-end"
      marginTop={2}
      marginBottom={1}
      paddingRight={1}
    >
      <text maxWidth="72%" fg={theme.text} wrapMode="word">{props.message.content}</text>
    </box>
  );
}

export function MindMessage(props: { mindName: string; message: Message }) {
  return (
    <box width="100%" flexDirection="column" paddingLeft={1} paddingRight={1} marginTop={2} marginBottom={1}>
      <text fg={theme.accent} marginBottom={1}>{props.mindName}</text>
      <MindMarkdown content={props.message.content} />
    </box>
  );
}

export function EmptyConversation(props: { mindName: string }) {
  return (
    <box width="100%" alignItems="center" justifyContent="center">
      <text fg={theme.text} attributes={TextAttributes.BOLD}>Ask {props.mindName}</text>
    </box>
  );
}

export function Chat(props: ChatProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  let conversation = props.fresh === false ? props.store.latestConversation(props.mind.manifest.id, props.mind.manifest.version) : null;
  conversation ??= props.store.createConversation(props.mind.manifest.id, props.mind.manifest.version, props.model ?? null, props.responseMode ?? "chat");
  const server = new CodexAppServer();
  let runtime = new ChatRuntime(server, props.mind, props.store, props.paths, conversation, props.model, props.responseMode);

  const [mind, setMind] = createSignal(props.mind);
  const [messages, setMessages] = createSignal<Message[]>(props.store.messages(runtime.id));
  const [busy, setBusy] = createSignal(false);
  const [streaming, setStreaming] = createSignal("");
  const [status, setStatus] = createSignal("opening mind");
  const [error, setError] = createSignal<string | null>(null);
  const [startedAt, setStartedAt] = createSignal(0);
  const [elapsed, setElapsed] = createSignal(0);
  const [lastRetryablePrompt, setLastRetryablePrompt] = createSignal<string | null>(null);
  const [composerValue, setComposerValue] = createSignal("");
  const [commandIndex, setCommandIndex] = createSignal(0);
  const [mindSwitcherOpen, setMindSwitcherOpen] = createSignal(false);
  const [threadSwitcherOpen, setThreadSwitcherOpen] = createSignal(false);
  const [availableMinds, setAvailableMinds] = createSignal<InstalledMind[]>(props.minds ?? [props.mind]);
  const [availableConversations, setAvailableConversations] = createSignal<Conversation[]>([]);
  const [availableConversationCounts, setAvailableConversationCounts] = createSignal<Map<string, number>>(new Map());
  let input: TextareaRenderable | undefined;
  let scroll: ScrollBoxRenderable | undefined;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingStream = "";

  const contentWidth = createMemo(() => dimensions().width < 100
    ? Math.max(24, dimensions().width - (dimensions().width < 72 ? 2 : 4))
    : Math.min(154, Math.max(24, Math.floor(dimensions().width * 0.82))));
  const emptyComposerWidth = createMemo(() => Math.min(104, contentWidth()));
  const bottomInset = createMemo(() => dimensions().height < 32 ? 1 : 2);
  const compactHeader = createMemo(() => dimensions().width < 72);
  const emptyThread = createMemo(() => messages().length === 0 && !streaming() && !error());
  const thinkingLabel = createMemo(() => busy() && status() === "thinking" ? `thinking  ${duration(elapsed())}` : status());
  const matchingCommands = createMemo(() => filterSlashCommands(composerValue()));
  const selectorOpen = createMemo(() => mindSwitcherOpen() || threadSwitcherOpen());
  const commandOpen = createMemo(() => !selectorOpen() && !busy() && matchingCommands().length > 0);
  const messageMindName = (message: Message) => {
    const id = message.mindId ?? mind().manifest.id;
    return availableMinds().find((candidate) => candidate.manifest.id === id)?.manifest.name
      ?? id.replaceAll("_", " ");
  };

  const scrollToBottom = () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = undefined;
      if (scroll && !scroll.isDestroyed) scroll.scrollTo({ x: 0, y: scroll.scrollHeight });
    }, 0);
  };

  const flushStream = () => {
    streamFlushTimer = undefined;
    if (!pendingStream) return;
    const delta = pendingStream;
    pendingStream = "";
    setStreaming((current) => current + delta);
    scrollToBottom();
  };

  const queueStream = (delta: string) => {
    pendingStream += delta;
    if (streamFlushTimer) return;
    streamFlushTimer = setTimeout(flushStream, 34);
  };

  const clearStream = () => {
    if (streamFlushTimer) clearTimeout(streamFlushTimer);
    streamFlushTimer = undefined;
    pendingStream = "";
  };

  const refresh = () => {
    setMessages(props.store.messages(runtime.id));
    scrollToBottom();
  };

  const startNew = () => {
    runtime.newConversation();
    setMessages([]);
    setLastRetryablePrompt(null);
    setStatus("ready");
    props.store.setLastMindId(mind().manifest.id);
    input?.focus();
  };

  const switchResponseMode = (nextMode: ResponseMode) => {
    if (nextMode === runtime.responseMode) {
      setStatus(`already in ${nextMode} mode`);
      return;
    }
    runtime.setResponseMode(nextMode);
    setError(null);
    setStatus("ready");
    input?.focus();
  };

  const closeMindSwitcher = () => {
    setMindSwitcherOpen(false);
    setStatus("ready");
    input?.focus();
  };

  const closeThreadSwitcher = () => {
    setThreadSwitcherOpen(false);
    setStatus("ready");
    input?.focus();
  };

  const openMindSwitcher = () => {
    setMindSwitcherOpen(true);
    setStatus("choose a mind");
    input?.blur();
    void listInstalledMinds(props.paths.minds).then(setAvailableMinds).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const openThreadSwitcher = () => {
    const counts = props.store.messageCounts();
    setAvailableConversationCounts(counts);
    setAvailableConversations(props.store.listConversations().filter((item) => item.title !== null || (counts.get(item.id) ?? 0) > 0));
    setThreadSwitcherOpen(true);
    setStatus("choose a conversation");
    input?.blur();
  };

  const resumeConversation = (nextConversation: Conversation) => {
    if (nextConversation.id === runtime.id) {
      closeThreadSwitcher();
      return;
    }
    const nextMind = availableMinds().find((candidate) => candidate.manifest.id === nextConversation.mindId);
    if (!nextMind) {
      setError(`Mind ${nextConversation.mindId} is not installed`);
      setStatus("cannot resume conversation");
      setThreadSwitcherOpen(false);
      return;
    }
    setThreadSwitcherOpen(false);
    props.store.deleteIfEmpty(runtime.id);
    runtime.release();
    runtime = new ChatRuntime(server, nextMind, props.store, props.paths, nextConversation, props.model);
    setMind(nextMind);
    setMessages(props.store.messages(runtime.id));
    setStreaming("");
    clearStream();
    setLastRetryablePrompt(null);
    props.store.setLastMindId(nextMind.manifest.id);
    setError(null);
    setStatus("ready");
    scrollToBottom();
    input?.focus();
  };

  const switchMind = (nextMind: InstalledMind) => {
    if (nextMind.manifest.id === mind().manifest.id) {
      closeMindSwitcher();
      return;
    }
    setMindSwitcherOpen(false);
    setMind(nextMind);
    runtime.switchMind(nextMind);
    props.store.setLastMindId(nextMind.manifest.id);
    setError(null);
    setStatus("ready");
    input?.focus();
  };

  const submit = async (submitted?: string) => {
    const raw = submitted ?? input?.plainText ?? "";
    let value = raw.trim();
    if (!value || busy()) return;
    if (value.startsWith("/")) {
      const exact = SLASH_COMMANDS.find((command) => command.name === value);
      const selected = matchingCommands()[commandIndex()];
      if (!exact && selected) value = selected.name;
      else if (!exact) {
        setStatus(`unknown command  ${value}`);
        return;
      }
    }
    input?.clear();
    setComposerValue("");
    setCommandIndex(0);

    if (value === "/quit") return renderer.destroy();
    if (value === "/resume") return openThreadSwitcher();
    if (value === "/minds") return openMindSwitcher();
    if (value === "/new") return startNew();
    if (value === "/chat") return switchResponseMode("chat");
    if (value === "/full") return switchResponseMode("full");
    if (value === "/clear") {
      refresh();
      return;
    }

    if (value === "/help" || value === "/") {
      setStatus("/resume  /minds  /chat  /full  /new  /retry  /clear  /help  /quit");
      return;
    }

    let prompt = value;
    let persistUser = true;
    if (value === "/retry") {
      if (!lastRetryablePrompt()) {
        setStatus("nothing to retry");
        return;
      }
      prompt = lastRetryablePrompt()!;
      persistUser = false;
    }

    setBusy(true);
    setStartedAt(performance.now());
    setElapsed(0);
    clearStream();
    setStreaming("");
    setStatus("thinking");
    setError(null);

    const result = await runtime.ask(prompt, queueStream, persistUser, refresh);

    if (streamFlushTimer) clearTimeout(streamFlushTimer);
    flushStream();
    refresh();
    setStreaming("");
    setBusy(false);
    setStatus(result.status === "completed" ? "ready" : result.status);
    if (result.error) setError(result.error);
    setLastRetryablePrompt(result.status === "completed" ? null : prompt);
    input?.focus();
  };

  useKeyboard((key) => {
    if (commandOpen() && key.name === "escape") {
      input?.clear();
      setComposerValue("");
      setCommandIndex(0);
      setStatus("ready");
      return;
    }
    if (commandOpen() && key.name === "up") {
      setCommandIndex((value) => (value - 1 + matchingCommands().length) % matchingCommands().length);
    }
    if (commandOpen() && key.name === "down") {
      setCommandIndex((value) => (value + 1) % matchingCommands().length);
    }
    if (key.ctrl && key.name === "q") return renderer.destroy();
    if ((key.ctrl && key.name === "c") && !busy()) return renderer.destroy();
    if ((key.ctrl && key.name === "c") || (key.name === "escape" && busy())) {
      setStatus("interrupting");
      void runtime.interrupt();
    }
    if (key.name === "pageup") scroll?.scrollBy(-Math.max(4, dimensions().height - 10));
    if (key.name === "pagedown") scroll?.scrollBy(Math.max(4, dimensions().height - 10));
  });

  onMount(async () => {
    const timer = setInterval(() => {
      if (!busy() || status() !== "thinking") return;
      setElapsed(performance.now() - startedAt());
    }, 1_000);
    onCleanup(() => clearInterval(timer));
    input?.focus();
    try {
      const mindsPromise = listInstalledMinds(props.paths.minds).then(setAvailableMinds);
      await Promise.all([mindsPromise, runtime.prepare()]);
      if (!busy() && !selectorOpen()) setStatus("ready");
      props.store.setLastMindId(mind().manifest.id);
      input?.focus();
      scrollToBottom();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("failed to open mind");
    }
  });

  onCleanup(() => {
    if (scrollTimer) clearTimeout(scrollTimer);
    clearStream();
    runtime.release();
    server.close();
    props.store.deleteIfEmpty(runtime.id);
  });
  createEffect(() => {
    messages();
    scrollToBottom();
  });

  const Overlays = () => (
    <>
      <Show when={mindSwitcherOpen()}>
        <box position="absolute" left={0} bottom={3 + bottomInset()} width="100%" zIndex={20}>
          <MindSwitcher
            minds={availableMinds()}
            currentId={mind().manifest.id}
            onSelect={switchMind}
            onClose={closeMindSwitcher}
          />
        </box>
      </Show>

      <Show when={threadSwitcherOpen()}>
        <box position="absolute" left={0} bottom={3 + bottomInset()} width="100%" zIndex={20}>
          <ThreadSwitcher
            conversations={availableConversations()}
            currentId={runtime.id}
            messageCount={(conversationId) => availableConversationCounts().get(conversationId) ?? 0}
            onSelect={resumeConversation}
            onClose={closeThreadSwitcher}
          />
        </box>
      </Show>

      <Show when={commandOpen()}>
        <box position="absolute" left={0} bottom={3 + bottomInset()} width="100%" zIndex={20}>
          <CommandPalette commands={matchingCommands()} selected={commandIndex()} />
        </box>
      </Show>
    </>
  );

  const InputArea = () => (
    <box width="100%" height={3} flexShrink={0}>
      <Composer
        mindName={mind().manifest.name}
        status={thinkingLabel()}
        busy={busy()}
        commandOpen={commandOpen()}
        active={!selectorOpen()}
        inputRef={(value) => { input = value; }}
        onInput={(value) => {
          setComposerValue(value);
          setCommandIndex(0);
        }}
        onSubmit={() => { void submit(input?.plainText); }}
      />
    </box>
  );

  return (
    <box width="100%" height="100%" backgroundColor={theme.background} flexDirection="column">
      <box
        width="100%"
        height={3}
        flexShrink={0}
        flexDirection="row"
        backgroundColor={theme.background}
        paddingLeft={2}
        paddingRight={2}
        alignItems="center"
        justifyContent="flex-end"
      >
        <text fg={theme.textMuted}>
          {busy()
            ? compactHeader() ? "[Esc] stop" : `[Esc] stop  ·  ${thinkingLabel()}`
            : compactHeader() ? "[/]  [Ctrl+Q]" : "[/] commands  [Ctrl+Q] quit"}
        </text>
      </box>

      <box width="100%" flexGrow={1} minHeight={0} alignItems="center">
        <box width={contentWidth()} height="100%" minWidth={0} flexDirection="column" paddingBottom={bottomInset()}>
          <Show when={emptyThread()} fallback={
            <scrollbox
              ref={(value) => { scroll = value; }}
              width="100%"
              flexGrow={1}
              minHeight={0}
              paddingRight={1}
              stickyScroll
              stickyStart="bottom"
              viewportCulling
              verticalScrollbarOptions={{
                visible: false,
                trackOptions: { backgroundColor: theme.panel, foregroundColor: theme.borderActive },
              }}
            >
              <box height={2} />
              <For each={messages()}>
                {(message) => message.role === "user"
                  ? <UserMessage message={message} />
                  : <MindMessage mindName={messageMindName(message)} message={message} />}
              </For>

              <Show when={busy()}>
                <box width="100%" flexDirection="column" paddingLeft={1} paddingRight={1} marginTop={2} marginBottom={1}>
                  <text fg={theme.accent} marginBottom={1}>{mind().manifest.name}</text>
                  <Show when={streaming()} fallback={<text fg={theme.textMuted}>{thinkingLabel()}</text>}>
                    <MindMarkdown content={streaming()} streaming />
                  </Show>
                </box>
              </Show>

              <Show when={error()}>
                <box backgroundColor={theme.panel} padding={1} marginTop={1}>
                  <text fg={theme.error}>{error()}</text>
                </box>
              </Show>
              <box height={2} />
            </scrollbox>
          }>
            <box width="100%" flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
              <box width={emptyComposerWidth()} flexDirection="column">
                <EmptyConversation mindName={mind().manifest.name} />
              </box>
            </box>
          </Show>
          <Overlays />
          <InputArea />
        </box>
      </box>
    </box>
  );
}
