import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { RenderableEvents, TextAttributes, type TextareaRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { theme } from "./theme.ts";

interface ComposerProps {
  mindName: string;
  status: string;
  busy: boolean;
  commandOpen: boolean;
  active?: boolean;
  onHeightChange?(rows: number): void;
  inputRef(renderable: TextareaRenderable): void;
  onInput(value: string): void;
  onSubmit(): void;
}

export function Composer(props: ComposerProps) {
  const dimensions = useTerminalDimensions();
  let input: TextareaRenderable | undefined;
  const [focusVersion, setFocusVersion] = createSignal(0);
  const [rows, setRows] = createSignal(1);
  const isActive = () => props.active !== false;
  const sidePadding = createMemo(() => dimensions().width < 72 ? 2 : 3);
  const labelWidth = createMemo(() => {
    const maximum = dimensions().width < 72 ? 18 : 24;
    return Math.min(maximum, Math.max(12, props.mindName.length + 2));
  });
  const maximumRows = createMemo(() => dimensions().height < 20 ? 3 : 6);
  const updateRows = () => {
    if (!input || input.isDestroyed) return;
    const next = Math.max(1, Math.min(maximumRows(), Math.max(input.lineCount, input.virtualLineCount)));
    if (next === rows()) return;
    setRows(next);
    props.onHeightChange?.(next + 2);
  };
  const handleBlur = () => {
    setTimeout(() => {
      setFocusVersion((value) => value + 1);
      if (!isActive() || !input || input.isDestroyed || input.focused) return;
      input.focus();
    }, 0);
  };

  onCleanup(() => {
    input?.off(RenderableEvents.BLURRED, handleBlur);
  });

  createEffect(() => {
    props.status;
    props.busy;
    props.commandOpen;
    props.active;
    dimensions().width;
    dimensions().height;
    focusVersion();
    setTimeout(updateRows, 0);
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
      height={rows() + 2}
      flexShrink={0}
      flexDirection="row"
      alignItems="flex-start"
      backgroundColor={theme.panel}
      paddingLeft={sidePadding()}
      paddingRight={sidePadding()}
      paddingTop={1}
      paddingBottom={1}
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
        height={rows()}
        maxHeight={maximumRows()}
        wrapMode="word"
        backgroundColor={theme.panel}
        focusedBackgroundColor={theme.panel}
        textColor={theme.text}
        focusedTextColor={theme.text}
        cursorColor={theme.text}
        cursorStyle={{ style: "block", blinking: false }}
        keyBindings={[
          { name: "return", shift: true, action: "newline" },
          { name: "kpenter", shift: true, action: "newline" },
          { name: "return", ctrl: true, action: "newline" },
          { name: "kpenter", ctrl: true, action: "newline" },
          { name: "return", meta: true, action: "newline" },
          { name: "kpenter", meta: true, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
          { name: "return", action: "submit" },
          { name: "kpenter", action: "submit" },
        ]}
        onMouseDown={(event) => event.target?.focus()}
        onContentChange={() => {
          props.onInput(input?.plainText ?? "");
          setTimeout(updateRows, 0);
        }}
        onSubmit={props.onSubmit}
      />
    </box>
  );
}
