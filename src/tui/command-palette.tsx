import { For } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { SlashCommand } from "./commands.ts";
import type { ResponseMode } from "../types.ts";
import { theme } from "./theme.ts";

export function CommandPalette(props: { commands: SlashCommand[]; selected: number; responseMode?: ResponseMode }) {
  return (
    <box
      width="100%"
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.panel}
      paddingTop={1}
      paddingBottom={1}
    >
      <For each={props.commands}>
        {(command, index) => {
          const active = () => index() === props.selected;
          const mode = () => command.name === "/chat" ? "chat" : command.name === "/full" ? "full" : null;
          return (
            <box
              height={1}
              flexShrink={0}
              flexDirection="row"
              backgroundColor={active() ? theme.panelRaised : theme.panel}
              paddingLeft={2}
              paddingRight={2}
            >
              <text width={12} fg={active() ? theme.accent : theme.text} attributes={active() ? TextAttributes.BOLD : undefined}>
                {active() ? "› " : "  "}{command.name}
              </text>
              <text flexGrow={1} minWidth={0} fg={theme.textMuted}>{command.description}</text>
              <text width={2} fg={mode() && props.responseMode === mode() ? theme.accent : theme.textMuted}>
                {mode() ? props.responseMode === mode() ? "●" : "○" : " "}
              </text>
            </box>
          );
        }}
      </For>
    </box>
  );
}
