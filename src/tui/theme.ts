import { SyntaxStyle, type StyleDefinitionInput } from "@opentui/core";

export const theme = {
  background: "#0C0B0A",
  panel: "#141210",
  panelRaised: "#1C1915",
  text: "#D2CCC2",
  textMuted: "#706A62",
  border: "#29251F",
  borderActive: "#4A4237",
  primary: "#E4DDD2",
  primaryMuted: "#9A9185",
  accent: "#B58A4A",
  user: "#C7B99F",
  error: "#D47770",
  success: "#7FA58A",
  code: "#C7A86B",
  string: "#BE8870",
  keyword: "#A88CB0",
  comment: "#71856D",
  function: "#C1B578",
  type: "#72A6A0",
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
