import { For, createMemo, createSignal, onMount } from "solid-js";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import type { Conversation } from "../types.ts";
import { theme } from "./theme.ts";

interface ThreadSwitcherProps {
  conversations: Conversation[];
  currentId: string;
  messageCount(conversationId: string): number;
  onSelect(conversation: Conversation): void;
  onClose(): void;
}

function relativeAge(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1_000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ThreadSwitcher(props: ThreadSwitcherProps) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let input: InputRenderable | undefined;

  const entries = createMemo(() => {
    const normalized = query().trim().toLowerCase();
    return props.conversations.filter((conversation) => {
      if (!normalized) return true;
      return `${conversation.title ?? ""} ${conversation.id}`.toLowerCase().includes(normalized);
    });
  });
  const visibleEntries = createMemo(() => {
    const list = entries();
    const start = Math.min(Math.max(0, selected() - 5), Math.max(0, list.length - 6));
    return list.slice(start, start + 6).map((conversation, offset) => ({ conversation, index: start + offset }));
  });

  const choose = () => {
    const conversation = entries()[selected()];
    if (conversation) props.onSelect(conversation);
  };

  onMount(() => input?.focus());

  return (
    <box
      width="100%"
      maxHeight={11}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.panel}
      border={["left"]}
      borderColor={theme.primary}
      paddingTop={1}
      paddingBottom={1}
    >
      <box height={1} flexShrink={0} flexDirection="row" paddingLeft={2} paddingRight={2}>
        <text width={10} fg={theme.primary} attributes={TextAttributes.BOLD}>RESUME</text>
        <input
          id="thread-switcher-input"
          ref={(value) => { input = value; }}
          flexGrow={1}
          minWidth={0}
          placeholder="search conversations"
          placeholderColor={theme.textMuted}
          backgroundColor={theme.panel}
          focusedBackgroundColor={theme.panel}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          cursorStyle={{ style: "block", blinking: false }}
          onKeyDown={(key) => {
            if (key.name === "escape") {
              key.preventDefault();
              key.stopPropagation();
              props.onClose();
              return;
            }
            if (key.name === "up") {
              key.preventDefault();
              key.stopPropagation();
              setSelected((value) => entries().length ? (value - 1 + entries().length) % entries().length : 0);
              return;
            }
            if (key.name === "down") {
              key.preventDefault();
              key.stopPropagation();
              setSelected((value) => entries().length ? (value + 1) % entries().length : 0);
              return;
            }
            if (key.name === "return") {
              key.preventDefault();
              key.stopPropagation();
              choose();
            }
          }}
          onInput={(value) => {
            setQuery(value);
            setSelected(0);
          }}
          onSubmit={choose}
        />
      </box>

      <For each={visibleEntries()} fallback={
        <box height={2} paddingLeft={2} justifyContent="center"><text fg={theme.textMuted}>No saved conversations</text></box>
      }>
        {(item) => {
          const active = () => item.index === selected();
          const current = () => item.conversation.id === props.currentId;
          return (
            <box
              height={2}
              flexShrink={0}
              flexDirection="column"
              justifyContent="center"
              backgroundColor={active() ? theme.panelRaised : theme.panel}
              paddingLeft={2}
              paddingRight={2}
            >
              <box height={1} flexDirection="row" justifyContent="space-between">
                <text fg={active() ? theme.text : theme.textMuted} attributes={active() ? TextAttributes.BOLD : undefined}>
                  <span style={{ fg: active() ? theme.primary : theme.textMuted }}>{active() ? "› " : "  "}</span>
                  {item.conversation.title ?? "Untitled conversation"}
                </text>
                <text fg={current() ? theme.primary : theme.textMuted}>{current() ? "current" : relativeAge(item.conversation.updatedAt)}</text>
              </box>
              <text fg={theme.textMuted}>  {props.messageCount(item.conversation.id)} messages  ·  {item.conversation.responseMode}</text>
            </box>
          );
        }}
      </For>

      <text fg={theme.textMuted} paddingLeft={2} marginTop={1}>↑↓ move   enter resume   esc close</text>
    </box>
  );
}
