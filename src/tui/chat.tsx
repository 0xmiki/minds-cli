import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import {
  type ScrollBoxRenderable,
  type TextareaRenderable,
} from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
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

function UserMessage(props: { message: Message }) {
  return (
    <box
      width="100%"
      marginTop={1}
      border={["left"]}
      borderColor={theme.user}
      backgroundColor={theme.panel}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={1}
    >
      <text fg={theme.text}>{props.message.content}</text>
    </box>
  );
}

function MindMessage(props: { mindName: string; message: Message; model: string | null }) {
  const marker = () => props.message.status === "completed" ? "◆" : props.message.status === "interrupted" ? "◇" : "×";
  const markerColor = () => props.message.status === "failed" ? theme.error : props.message.status === "interrupted" ? theme.textMuted : theme.primary;
  const time = () => new Date(props.message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <box width="100%" flexDirection="column" paddingLeft={2} paddingRight={1} marginTop={1}>
      <MindMarkdown content={props.message.content} />
      <text fg={theme.textMuted} marginTop={1}>
        <span style={{ fg: markerColor() }}>{marker()} </span>
        {props.mindName}  ·  {props.model ?? "Codex"}  ·  {time()}
      </text>
    </box>
  );
}

export function Chat(props: ChatProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  let conversation = props.fresh === false ? props.store.latestConversation(props.mind.manifest.id, props.mind.manifest.version) : null;
  conversation ??= props.store.createConversation(props.mind.manifest.id, props.mind.manifest.version, props.model ?? null, props.responseMode ?? "chat");
  let runtime = new ChatRuntime(props.mind, props.store, props.paths, conversation, props.model, props.responseMode);

  const [mind, setMind] = createSignal(props.mind);
  const [messages, setMessages] = createSignal<Message[]>(props.store.messages(runtime.id));
  const [model, setModel] = createSignal<string | null>(conversation.model);
  const [responseMode, setResponseMode] = createSignal<ResponseMode>(runtime.responseMode);
  const [ready, setReady] = createSignal(false);
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
  const [availableMinds, setAvailableMinds] = createSignal<InstalledMind[]>([props.mind]);
  const [availableConversations, setAvailableConversations] = createSignal<Conversation[]>([]);
  let input: TextareaRenderable | undefined;
  let scroll: ScrollBoxRenderable | undefined;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let streamFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingStream = "";

  const contentWidth = createMemo(() => Math.min(112, Math.max(24, dimensions().width - 6)));
  const emptyComposerWidth = createMemo(() => Math.min(84, contentWidth()));
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
    setModel(runtime.model);
    setResponseMode(runtime.responseMode);
    scrollToBottom();
  };

  const startNew = async () => {
    setBusy(true);
    setStatus("starting new conversation");
    await runtime.newConversation();
    setMessages([]);
    setModel(runtime.model);
    setResponseMode(runtime.responseMode);
    setLastRetryablePrompt(null);
    setBusy(false);
    setStatus("ready");
    props.store.setLastMindId(mind().manifest.id);
    input?.focus();
  };

  const switchResponseMode = async (nextMode: ResponseMode) => {
    if (nextMode === runtime.responseMode) {
      setStatus(`already in ${nextMode} mode`);
      return;
    }
    setBusy(true);
    setStatus(`switching to ${nextMode} mode`);
    try {
      await runtime.setResponseMode(nextMode);
      setResponseMode(runtime.responseMode);
      setModel(runtime.model);
      setError(null);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("failed to switch mode");
    } finally {
      setBusy(false);
      input?.focus();
    }
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

  const openMindSwitcher = async () => {
    setStatus("loading minds");
    try {
      setAvailableMinds(await listInstalledMinds(props.paths.minds));
      setMindSwitcherOpen(true);
      setStatus("choose a mind");
      input?.blur();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("failed to load minds");
    }
  };

  const openThreadSwitcher = async () => {
    setStatus("loading conversations");
    try {
      const minds = await listInstalledMinds(props.paths.minds);
      setAvailableMinds(minds);
      try {
        const nativeThreads = await runtime.listThreads(minds);
        for (const thread of nativeThreads) {
          const installed = minds.find((candidate) => candidate.manifest.id === thread.mindId);
          if (installed) props.store.upsertNativeThread(thread, installed.manifest.version);
        }
      } catch {
        // The local index still exposes conversations if Codex history refresh fails.
      }
      setAvailableConversations(props.store.listConversations().filter((item) =>
        item.title !== null || props.store.messageCount(item.id) > 0,
      ));
      setThreadSwitcherOpen(true);
      setStatus("choose a conversation");
      input?.blur();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("failed to load conversations");
    }
  };

  const resumeConversation = async (nextConversation: Conversation) => {
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
    setBusy(true);
    setReady(false);
    setStatus("resuming conversation");
    props.store.deleteIfEmpty(runtime.id);
    runtime.close();
    runtime = new ChatRuntime(nextMind, props.store, props.paths, nextConversation, props.model);
    setMind(nextMind);
    setMessages(props.store.messages(runtime.id));
    setModel(nextConversation.model);
    setResponseMode(runtime.responseMode);
    setStreaming("");
    clearStream();
    setLastRetryablePrompt(null);
    try {
      await runtime.start();
      setMessages(props.store.messages(runtime.id));
      setModel(runtime.model);
      setResponseMode(runtime.responseMode);
      props.store.setLastMindId(nextMind.manifest.id);
      setError(null);
      setReady(true);
      setStatus("ready");
      scrollToBottom();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("failed to resume conversation");
    } finally {
      setBusy(false);
      input?.focus();
    }
  };

  const switchMind = async (nextMind: InstalledMind) => {
    if (nextMind.manifest.id === mind().manifest.id) {
      closeMindSwitcher();
      return;
    }
    setMindSwitcherOpen(false);
    setBusy(true);
    setReady(false);
    setStatus(`switching to ${nextMind.manifest.name}`);
    setMind(nextMind);
    try {
      await runtime.switchMind(nextMind);
      setModel(runtime.model);
      setResponseMode(runtime.responseMode);
      props.store.setLastMindId(nextMind.manifest.id);
      setError(null);
      setReady(true);
      setStatus("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setStatus("failed to switch mind");
    } finally {
      setBusy(false);
      input?.focus();
    }
  };

  const submit = async (submitted?: string) => {
    const raw = submitted ?? input?.plainText ?? "";
    let value = raw.trim();
    if (!value || busy()) return;
    if (!ready()) {
      setStatus("opening mind");
      return;
    }
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
    if (value === "/resume") return void openThreadSwitcher();
    if (value === "/minds") return void openMindSwitcher();
    if (value === "/new") return void startNew();
    if (value === "/chat") return void switchResponseMode("chat");
    if (value === "/full") return void switchResponseMode("full");
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

    const result = await runtime.ask(prompt, queueStream, persistUser, refresh);

    if (streamFlushTimer) clearTimeout(streamFlushTimer);
    flushStream();
    refresh();
    setStreaming("");
    setBusy(false);
    setStatus(result.status === "completed" ? "ready" : result.status);
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
      setAvailableMinds(await listInstalledMinds(props.paths.minds));
      if (conversation.codexThreadId) await runtime.start();
      else await runtime.prepare();
      setModel(runtime.model);
      setResponseMode(runtime.responseMode);
      setReady(true);
      setStatus("ready");
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
    runtime.close();
    props.store.deleteIfEmpty(runtime.id);
  });
  createEffect(() => {
    messages();
    scrollToBottom();
  });

  const InputArea = () => (
    <box width="100%" flexDirection="column">
      <Show when={mindSwitcherOpen()}>
        <MindSwitcher
          minds={availableMinds()}
          currentId={mind().manifest.id}
          onSelect={(selectedMind) => { void switchMind(selectedMind); }}
          onClose={closeMindSwitcher}
        />
      </Show>

      <Show when={threadSwitcherOpen()}>
        <ThreadSwitcher
          conversations={availableConversations()}
          currentId={runtime.id}
          messageCount={(conversationId) => props.store.messageCount(conversationId)}
          onSelect={(selectedConversation) => { void resumeConversation(selectedConversation); }}
          onClose={closeThreadSwitcher}
        />
      </Show>

      <Show when={commandOpen()}>
        <CommandPalette commands={matchingCommands()} selected={commandIndex()} />
      </Show>

      <Composer
        mindName={mind().manifest.name}
        model={model()}
        responseMode={responseMode()}
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
    <box width="100%" height="100%" backgroundColor={theme.background} alignItems="center">
      <box width={contentWidth()} height="100%" minWidth={0} flexDirection="column">
        <Show when={emptyThread()} fallback={
          <>
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
              <box height={1} />
              <For each={messages()}>
                {(message) => message.role === "user"
                  ? <UserMessage message={message} />
                  : <MindMessage mindName={messageMindName(message)} message={message} model={model()} />}
              </For>

              <Show when={streaming()}>
                <box width="100%" flexDirection="column" paddingLeft={2} paddingRight={1} marginTop={1}>
                  <MindMarkdown content={streaming()} streaming />
                  <text fg={theme.textMuted} marginTop={1}>
                    <span style={{ fg: theme.primary }}>◆ </span>{mind().manifest.name}  ·  {thinkingLabel()}
                  </text>
                </box>
              </Show>

              <Show when={error()}>
                <box border={["left"]} borderColor={theme.error} backgroundColor={theme.panel} padding={1} marginTop={1}>
                  <text fg={theme.error}>{error()}</text>
                </box>
              </Show>
              <box height={1} />
            </scrollbox>
            <InputArea />
          </>
        }>
          <box width="100%" flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
            <box width={emptyComposerWidth()} flexDirection="column">
              <InputArea />
            </box>
          </box>
        </Show>
      </box>
    </box>
  );
}
