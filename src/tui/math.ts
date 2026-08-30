import { UnicodeTexBackend, type TexRenderRequest } from "@simonklee/opentui-tex";

export type RichContentBlock =
  | { type: "markdown"; content: string }
  | { type: "math"; formula: string };

export const unicodeTexBackend = new UnicodeTexBackend();

function request(formula: string, display: boolean): TexRenderRequest {
  return {
    formula,
    display,
    foreground: "#ffffff",
    background: "#000000",
    widthMax: 160,
    heightMax: 24,
    signal: new AbortController().signal,
  };
}

function compactFractions(formula: string): string {
  let result = formula;
  const fraction = /\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g;
  for (let pass = 0; pass < 8 && fraction.test(result); pass++) {
    fraction.lastIndex = 0;
    result = result.replace(fraction, "($1)/($2)");
  }
  return result;
}

export function renderInlineMath(formula: string): string {
  const compact = compactFractions(formula.trim());
  try {
    const output = unicodeTexBackend.renderSync(request(compact, false));
    if (output.rows === 1) return output.text;
    return output.text.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  } catch {
    return formula.trim();
  }
}

function replaceInlineMath(content: string): string {
  return content
    .replace(/\\\((.+?)\\\)/g, (_match, formula: string) => renderInlineMath(formula))
    .replace(/(^|[^\\$])\$(?!\$)([^\n$]+?)\$/g, (_match, prefix: string, formula: string) => `${prefix}${renderInlineMath(formula)}`);
}

function splitDisplayMath(content: string): RichContentBlock[] {
  const blocks: RichContentBlock[] = [];
  const pattern = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      blocks.push({ type: "markdown", content: replaceInlineMath(content.slice(cursor, index)) });
    }
    blocks.push({ type: "math", formula: (match[1] ?? match[2] ?? "").trim() });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) {
    blocks.push({ type: "markdown", content: replaceInlineMath(content.slice(cursor)) });
  }
  return blocks.length > 0 ? blocks : [{ type: "markdown", content: replaceInlineMath(content) }];
}

export function splitRichContent(content: string): RichContentBlock[] {
  const blocks: RichContentBlock[] = [];
  const fencedParts = content.split(/(```[\s\S]*?```)/g);
  for (let index = 0; index < fencedParts.length; index++) {
    const part = fencedParts[index];
    if (!part) continue;
    if (index % 2 === 1) {
      blocks.push({ type: "markdown", content: part });
      continue;
    }
    blocks.push(...splitDisplayMath(part));
  }
  return blocks.filter((block) => block.type === "math" || block.content.length > 0);
}
