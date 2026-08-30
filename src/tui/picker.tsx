import { For, createMemo, createSignal, onMount } from "solid-js";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid";
import type { InstalledMind } from "../types.ts";
import { ConversationStore } from "../storage.ts";
import { theme } from "./theme.ts";

interface PickerProps {
  minds: InstalledMind[];
  store: ConversationStore;
  onDone(id: string | null): void;
}

function fuzzyScore(mind: InstalledMind, query: string): number | null {
  if (!query) return 0;
  const value = `${mind.manifest.name} ${mind.manifest.id}`.toLowerCase();
  const direct = value.indexOf(query);
  if (direct >= 0) return direct;
  let cursor = 0;
  let gap = 0;
  for (const character of query) {
    const found = value.indexOf(character, cursor);
    if (found < 0) return null;
    gap += found - cursor;
    cursor = found + 1;
  }
  return 100 + gap;
}

export function Picker(props: PickerProps) {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  let input: InputRenderable | undefined;

  const entries = createMemo(() => {
    const normalized = query().trim().toLowerCase();
    return props.minds
      .map((mind) => ({ mind, score: fuzzyScore(mind, normalized) }))
      .filter((entry): entry is { mind: InstalledMind; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.mind.manifest.name.localeCompare(b.mind.manifest.name));
  });

  const finish = (id: string | null) => {
    props.onDone(id);
    renderer.destroy();
  };

  const choose = () => {
    const mind = entries()[selected()]?.mind;
    if (mind) finish(mind.manifest.id);
  };

  useKeyboard((key) => {
    if ((key.ctrl && key.name === "c") || key.name === "escape") return finish(null);
    if (key.name === "up") {
      setSelected((value) => entries().length ? (value - 1 + entries().length) % entries().length : 0);
    }
    if (key.name === "down") {
      setSelected((value) => entries().length ? (value + 1) % entries().length : 0);
    }
  });

  onMount(() => input?.focus());

  const width = createMemo(() => Math.min(72, Math.max(42, dimensions().width - 8)));
  const listHeight = createMemo(() => Math.max(5, Math.min(16, dimensions().height - 13)));

  return (
    <box
      width="100%"
      height="100%"
      backgroundColor={theme.background}
      alignItems="center"
      justifyContent="center"
    >
      <box width={width()} flexDirection="column" gap={1}>
        <box flexDirection="column" alignItems="center" marginBottom={1}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>minds</text>
          <text fg={theme.textMuted}>choose a mind</text>
        </box>

        <box
          width="100%"
          height={3}
          border
          borderStyle="rounded"
          borderColor={theme.borderActive}
          backgroundColor={theme.panel}
          paddingLeft={1}
          paddingRight={1}
          alignItems="center"
        >
          <text fg={theme.primary}>› </text>
          <input
            ref={(value) => { input = value; }}
            width="100%"
            maxLength={120}
            placeholder="Type to search"
            placeholderColor={theme.textMuted}
            backgroundColor={theme.panel}
            focusedBackgroundColor={theme.panel}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
            onInput={(value) => {
              setQuery(value);
              setSelected(0);
            }}
            onSubmit={choose}
          />
        </box>

        <scrollbox
          width="100%"
          height={listHeight()}
          scrollY
          viewportCulling
          scrollbarOptions={{ visible: false }}
        >
          <For each={entries()} fallback={
            <box padding={2}><text fg={theme.textMuted}>No matching minds</text></box>
          }>
            {(entry, index) => {
              const latest = () => props.store.latestConversation(entry.mind.manifest.id);
              const active = () => index() === selected();
              return (
                <box
                  width="100%"
                  height={4}
                  paddingLeft={1}
                  paddingRight={1}
                  flexDirection="column"
                  justifyContent="center"
                  backgroundColor={active() ? theme.panelRaised : theme.background}
                  border={active() ? ["left"] : false}
                  borderColor={theme.primary}
                >
                  <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
                    <text fg={active() ? theme.text : theme.textMuted} attributes={active() ? TextAttributes.BOLD : undefined}>
                      {active() ? "› " : "  "}{entry.mind.manifest.name}
                    </text>
                    <text fg={theme.textMuted}>v{entry.mind.manifest.version}</text>
                  </box>
                  <text height={1} flexShrink={0} fg={theme.textMuted}>
                    {latest()?.title ? `  continue  ${latest()!.title}` : "  start a new conversation"}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <box justifyContent="center" marginTop={1}>
          <text fg={theme.textMuted}>↑↓ move   enter open   esc quit</text>
        </box>
      </box>
    </box>
  );
}
