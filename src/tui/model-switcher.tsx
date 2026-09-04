import { For, createEffect, createMemo, createSignal } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { CodexModel } from "../codex-app-server.ts";
import { theme } from "./theme.ts";

export function ModelSwitcher(props: {
  models: CodexModel[];
  currentModel: string | null;
  currentEffort: string | null;
  loading: boolean;
  error: string | null;
  onSelect(model: string, effort: string | null): void;
  onClose(): void;
  onRetry(): void;
}) {
  const [pending, setPending] = createSignal<CodexModel | null>(null);
  const [selected, setSelected] = createSignal(0);
  const entries = createMemo(() => {
    const model = pending();
    return model
      ? model.supportedReasoningEfforts.map((option) => ({
          id: option.reasoningEffort,
          label: option.reasoningEffort,
          detail: option.reasoningEffort === (model.model === props.currentModel ? props.currentEffort : null)
            ? "current" : option.reasoningEffort === model.defaultReasoningEffort ? "default" : option.description,
        }))
      : props.models.map((model) => ({
          id: model.model,
          label: model.displayName,
          detail: model.model === props.currentModel ? "current" : model.isDefault ? "default" : model.model,
        }));
  });
  createEffect(() => {
    const model = pending();
    const current = model
      ? (model.model === props.currentModel ? props.currentEffort : null) ?? model.defaultReasoningEffort
      : props.currentModel;
    setSelected(Math.max(0, entries().findIndex((entry) => entry.id === current)));
  });
  const visible = createMemo(() => {
    const start = Math.min(Math.max(0, selected() - 5), Math.max(0, entries().length - 6));
    return entries().slice(start, start + 6).map((entry, index) => ({ ...entry, index: start + index }));
  });
  const choose = (index: number) => {
    if (props.loading || props.error) return;
    const entry = entries()[index];
    if (!entry) return;
    const model = pending();
    if (model) props.onSelect(model.model, entry.id);
    else {
      const next = props.models[index];
      if (!next) return;
      if (next.supportedReasoningEfforts.length === 0) props.onSelect(next.model, null);
      else setPending(next);
    }
  };
  const back = () => pending() ? setPending(null) : props.onClose();
  useKeyboard((key) => {
    if (key.name === "escape") { key.preventDefault(); back(); }
    if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      const length = entries().length;
      setSelected((value) => length ? (value + (key.name === "up" ? -1 : 1) + length) % length : 0);
    }
    if (key.name === "return") {
      key.preventDefault();
      if (props.error) props.onRetry();
      else choose(selected());
    }
  });
  return (
    <box width="100%" flexDirection="column" backgroundColor={theme.panel} paddingTop={1} paddingBottom={1}>
      <text fg={theme.accent} paddingLeft={2}>
        {pending() ? `Reasoning · ${pending()!.displayName}` : "Choose model"}
      </text>
      <For each={props.loading || props.error ? [] : visible()}>
        {(entry) => (
          <box height={1} flexDirection="row" paddingLeft={2} paddingRight={2}
            backgroundColor={entry.index === selected() ? theme.panelRaised : theme.panel}
            onMouseDown={() => choose(entry.index)}>
            <text fg={entry.index === selected() ? theme.accent : theme.text}>
              {entry.index === selected() ? "› " : "  "}{entry.label}
            </text>
            <text flexGrow={1} minWidth={0} fg={theme.textMuted}>  {entry.detail}</text>
          </box>
        )}
      </For>
      <text fg={props.error ? theme.error : theme.textMuted} paddingLeft={2}>
        {props.loading ? "Loading models…" : props.error ? props.error : entries().length ? "" : "No models available"}
      </text>
      <text fg={theme.textMuted} paddingLeft={2} onMouseDown={back}>
        {props.error ? "enter retry   esc close" : pending() ? "↑↓ move   enter select   esc back" : "↑↓ move   enter select   esc close"}
      </text>
    </box>
  );
}
