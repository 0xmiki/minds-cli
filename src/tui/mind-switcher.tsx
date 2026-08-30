import { For, createMemo, createSignal, onMount } from "solid-js";
import { TextAttributes, type InputRenderable } from "@opentui/core";
import type { InstalledMind } from "../types.ts";
import { theme } from "./theme.ts";

interface MindSwitcherProps {
  minds: InstalledMind[];
  currentId: string;
  onSelect(mind: InstalledMind): void;
  onClose(): void;
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

export function MindSwitcher(props: MindSwitcherProps) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(Math.max(0, props.minds.findIndex((mind) => mind.manifest.id === props.currentId)));
  let input: InputRenderable | undefined;

  const entries = createMemo(() => {
    const normalized = query().trim().toLowerCase();
    return props.minds
      .map((mind) => ({ mind, score: fuzzyScore(mind, normalized) }))
      .filter((entry): entry is { mind: InstalledMind; score: number } => entry.score !== null)
      .sort((a, b) => a.score - b.score || a.mind.manifest.name.localeCompare(b.mind.manifest.name));
  });
  const visibleEntries = createMemo(() => {
    const list = entries();
    const start = Math.min(Math.max(0, selected() - 5), Math.max(0, list.length - 6));
    return list.slice(start, start + 6).map((entry, offset) => ({ entry, index: start + offset }));
  });

  const choose = () => {
    const mind = entries()[selected()]?.mind;
    if (mind) props.onSelect(mind);
  };

  onMount(() => input?.focus());

  return (
    <box
      width="100%"
      maxHeight={10}
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.panel}
      border={["left"]}
      borderColor={theme.primary}
      paddingTop={1}
      paddingBottom={1}
    >
      <box height={1} flexShrink={0} flexDirection="row" paddingLeft={2} paddingRight={2}>
        <text width={10} fg={theme.primary} attributes={TextAttributes.BOLD}>MINDS</text>
        <input
          id="mind-switcher-input"
          ref={(value) => { input = value; }}
          flexGrow={1}
          minWidth={0}
          placeholder="type to filter"
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
        <box height={1} paddingLeft={2}><text fg={theme.textMuted}>No matching minds</text></box>
      }>
        {(item) => {
          const active = () => item.index === selected();
          const current = () => item.entry.mind.manifest.id === props.currentId;
          return (
            <box
              height={1}
              flexShrink={0}
              flexDirection="row"
              justifyContent="space-between"
              backgroundColor={active() ? theme.panelRaised : theme.panel}
              paddingLeft={2}
              paddingRight={2}
            >
              <text fg={active() ? theme.text : theme.textMuted} attributes={active() ? TextAttributes.BOLD : undefined}>
                <span style={{ fg: active() ? theme.primary : theme.textMuted }}>{active() ? "› " : "  "}</span>
                {item.entry.mind.manifest.name}
              </text>
              <text fg={current() ? theme.primary : theme.textMuted}>{current() ? "current" : item.entry.mind.manifest.id}</text>
            </box>
          );
        }}
      </For>

      <text fg={theme.textMuted} paddingLeft={2} marginTop={1}>↑↓ move   enter switch   esc close</text>
    </box>
  );
}
