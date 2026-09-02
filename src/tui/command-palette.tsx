import { For } from "solid-js";
import { TextAttributes } from "@opentui/core";
import type { SlashCommand } from "./commands.ts";
import { theme } from "./theme.ts";

export function CommandPalette(props: { commands: SlashCommand[]; selected: number }) {
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
              <text fg={theme.textMuted}>{command.description}</text>
            </box>
          );
        }}
      </For>
    </box>
  );
}
