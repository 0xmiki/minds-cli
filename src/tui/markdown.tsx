import { For, createMemo, onCleanup } from "solid-js";
import type { MarkdownRenderable } from "@opentui/core";
import { registerTex } from "@simonklee/opentui-tex/solid";
import { createMarkdownStyle, theme } from "./theme.ts";
import { splitRichContent, unicodeTexBackend } from "./math.ts";

registerTex();

export interface MindMarkdownProps {
  content: string;
  streaming?: boolean;
  ref?: (renderable: MarkdownRenderable) => void;
}

export function MindMarkdown(props: MindMarkdownProps) {
  const syntaxStyle = createMarkdownStyle();
  const blocks = createMemo(() => splitRichContent(props.content));
  onCleanup(() => syntaxStyle.destroy());
  return (
    <box width="100%" flexDirection="column">
      <For each={blocks()}>
        {(block) => block.type === "math" ? (
          <box width="100%" alignItems="center" paddingTop={1} paddingBottom={1}>
            <tex
              formula={block.formula}
              display={true}
              streaming={props.streaming ?? false}
              foreground={theme.text}
              background={theme.background}
              backend={unicodeTexBackend}
              fallback="unicode"
              widthMax={140}
              heightMax={24}
            />
          </box>
        ) : (
          <markdown
            ref={props.ref}
            width="100%"
            content={block.content}
            syntaxStyle={syntaxStyle}
            fg={theme.text}
            conceal={true}
            concealCode={true}
            streaming={props.streaming ?? false}
            internalBlockMode="top-level"
            tableOptions={{
              style: "columns",
              widthMode: "full",
              wrapMode: "word",
              borderColor: theme.border,
            }}
          />
        )}
      </For>
    </box>
  );
}
