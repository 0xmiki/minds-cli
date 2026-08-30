export interface SlashCommand {
  name: `/${string}`;
  description: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "/resume", description: "Open a saved conversation" },
  { name: "/minds", description: "Change the active mind in this thread" },
  { name: "/chat", description: "Use short, text-message replies" },
  { name: "/full", description: "Use complete, developed replies" },
  { name: "/new", description: "Start a clean conversation" },
  { name: "/retry", description: "Repeat the interrupted or failed turn" },
  { name: "/clear", description: "Redraw the transcript" },
  { name: "/help", description: "Show command help" },
  { name: "/quit", description: "Leave this mind" },
];

export function filterSlashCommands(value: string): SlashCommand[] {
  if (!value.startsWith("/") || value.includes(" ")) return [];
  const query = value.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((command) => command.name.slice(1).startsWith(query));
}
