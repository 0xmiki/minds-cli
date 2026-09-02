import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { RenderableEvents, TextAttributes, type TextareaRenderable } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { theme } from "./theme.ts";

interface ComposerProps {
  mindName: string;
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
  const dimensions = useTerminalDimensions();
  let input: TextareaRenderable | undefined;
  const [focusVersion, setFocusVersion] = createSignal(0);
  const isActive = () => props.active !== false;
  const sidePadding = createMemo(() => dimensions().width < 72 ? 2 : 3);
  const labelWidth = createMemo(() => {
    const maximum = dimensions().width < 72 ? 18 : 24;
    return Math.min(maximum, Math.max(12, props.mindName.length + 2));
  });
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
      height={3}
      flexShrink={0}
      flexDirection="row"
      alignItems="center"
      backgroundColor={theme.panel}
      paddingLeft={sidePadding()}
      paddingRight={sidePadding()}
    >
      <text
        width={labelWidth()}
        height={1}
        flexShrink={0}
        fg={props.busy ? theme.primaryMuted : theme.accent}
        attributes={TextAttributes.BOLD}
      >
        {props.mindName}
      </text>

      <text width={3} height={1} flexShrink={0} fg={theme.borderActive}> │ </text>

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
        flexGrow={1}
        minWidth={0}
        minHeight={1}
        maxHeight={1}
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
    </box>
  );
}
