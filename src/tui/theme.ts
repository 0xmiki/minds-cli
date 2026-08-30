import { SyntaxStyle, type StyleDefinitionInput } from "@opentui/core";

export const theme = {
  background: "#0B0B0C",
  panel: "#171719",
  panelRaised: "#202024",
  text: "#E7E7E9",
  textMuted: "#77777F",
  border: "#2B2B30",
  borderActive: "#4A4A52",
  primary: "#F0A63A",
  primaryMuted: "#9A6A28",
  user: "#4C9BFF",
  error: "#FF6B6B",
  success: "#79C99E",
  code: "#D7BA7D",
  string: "#CE9178",
  keyword: "#C586C0",
  comment: "#6A9955",
  function: "#DCDCAA",
  type: "#4EC9B0",
};

export function createMarkdownStyle(): SyntaxStyle {
  const styles: Record<string, StyleDefinitionInput> = {
    default: { fg: theme.text },
    conceal: { fg: theme.textMuted },
    "markup.heading": { fg: theme.primary, bold: true },
    "markup.strong": { fg: theme.primary, bold: true },
    "markup.italic": { fg: theme.text, italic: true },
    "markup.strikethrough": { fg: theme.textMuted, dim: true },
    "markup.raw": { fg: theme.code, bg: theme.panelRaised },
    "markup.link": { fg: theme.user },
    "markup.link.label": { fg: theme.user, underline: true },
    "markup.link.url": { fg: theme.textMuted, underline: true },
    "markup.quote": { fg: theme.textMuted, italic: true },
    "markup.list": { fg: theme.primary },
    keyword: { fg: theme.keyword, bold: true },
    string: { fg: theme.string },
    comment: { fg: theme.comment, italic: true },
    function: { fg: theme.function },
    "function.call": { fg: theme.function },
    type: { fg: theme.type },
    number: { fg: theme.code },
    constant: { fg: theme.code },
    operator: { fg: theme.textMuted },
    punctuation: { fg: theme.textMuted },
    variable: { fg: theme.text },
  };
  for (let level = 1; level <= 6; level++) {
    styles[`markup.heading.${level}`] = { fg: theme.primary, bold: true };
  }
  return SyntaxStyle.fromStyles(styles);
}
