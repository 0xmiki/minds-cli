import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { RenderableEvents, TextAttributes, type TextareaRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import type { ResponseMode } from "../types.ts";
import { theme } from "./theme.ts";

interface ComposerProps {
  mindName: string;
  model: string | null;
  responseMode: ResponseMode;
  status: string;
  busy: boolean;
  commandOpen: boolean;
  active?: boolean;
  inputRef(renderable: TextareaRenderable): void;
  onInput(value: string): void;
  onSubmit(): void;
}

export function Composer(props: ComposerProps) {
  const renderer = useRenderer();
  let input: TextareaRenderable | undefined;
  const [focusVersion, setFocusVersion] = createSignal(0);
  const isActive = () => props.active !== false;
  const interceptSubmit = (sequence: string) => {
    if (!isActive() || !input?.focused) return false;
    const submit = sequence === "\r" || sequence === "\n" || sequence === "\x1b[13u" || sequence === "\x1b[13;1u";
    if (!submit) return false;
    props.onSubmit();
    return true;
  };
  const handleBlur = () => {
    setTimeout(() => {
      setFocusVersion((value) => value + 1);
      if (!isActive() || !input || input.isDestroyed || input.focused) return;
      input.focus();
    }, 0);
  };

  renderer.prependInputHandler(interceptSubmit);
  onCleanup(() => {
    renderer.removeInputHandler(interceptSubmit);
    input?.off(RenderableEvents.BLURRED, handleBlur);
  });

  createEffect(() => {
    props.status;
    props.busy;
    props.commandOpen;
    props.active;
    focusVersion();
    if (!isActive()) {
      if (input?.focused) input.blur();
      return;
    }
    if (!input || input.isDestroyed || input.focused) return;
    input.focus();
  });

  return (
    <box
      width="100%"
      height={6}
      flexShrink={0}
      flexDirection="column"
      border={["left"]}
      borderColor={props.busy ? theme.primaryMuted : theme.user}
      backgroundColor={theme.panel}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <textarea
        id="mind-composer-input"
        ref={(renderable) => {
          input?.off(RenderableEvents.BLURRED, handleBlur);
          input = renderable;
          input.on(RenderableEvents.BLURRED, handleBlur);
          props.inputRef(renderable);
          setTimeout(() => {
            if (!input || input.isDestroyed) return;
            input.cursorColor = theme.text;
            input.cursorStyle = { style: "block", blinking: false };
            if (isActive() && !input.focused) input.focus();
          }, 0);
        }}
        width="100%"
        minHeight={1}
        maxHeight={2}
        wrapMode="word"
        backgroundColor={theme.panel}
        focusedBackgroundColor={theme.panel}
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.text}
        cursorStyle={{ style: "block", blinking: false }}
        onMouseDown={(event) => event.target?.focus()}
        onKeyDown={(event) => {
          if (event.name !== "return" || event.shift) return;
          event.preventDefault();
          event.stopPropagation();
          props.onSubmit();
        }}
        onContentChange={() => props.onInput(input?.plainText ?? "")}
        onSubmit={props.onSubmit}
      />

      <box height={1} flexShrink={0} />

      <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
        <Show
          when={props.status === "ready"}
          fallback={<text fg={props.busy ? theme.primary : theme.textMuted}>{props.status}</text>}
        >
          <text>
            <span style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>◆ {props.mindName}</span>
            <span style={{ fg: theme.textMuted }}>  ·  {props.model ?? "Codex"}  ·  {props.responseMode}</span>
          </text>
        </Show>
        <text fg={theme.textMuted}>
          {props.commandOpen
            ? "type to filter  ·  enter run  ·  esc close"
            : props.busy
              ? "type next prompt  ·  esc interrupt"
              : "enter send  ·  / commands"}
        </text>
      </box>
    </box>
  );
}
