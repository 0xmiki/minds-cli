import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/solid";
import { MindMarkdown } from "../src/tui/markdown.tsx";
import { Picker } from "../src/tui/picker.tsx";
import { CommandPalette } from "../src/tui/command-palette.tsx";
import { filterSlashCommands } from "../src/tui/commands.ts";
import { renderInlineMath, splitRichContent } from "../src/tui/math.ts";
import { Composer } from "../src/tui/composer.tsx";
import { MindSwitcher } from "../src/tui/mind-switcher.tsx";
import { ThreadSwitcher } from "../src/tui/thread-switcher.tsx";
import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { ConversationStore } from "../src/storage.ts";

test("renders Markdown lists and code without raw fences", async () => {
  const setup = await testRender(() => (
    <box width={60} height={14} padding={1}>
      <MindMarkdown content={"## A clean question\n\n**Information** removes uncertainty.\n\n- Signal\n- Noise\n\n```ts\nconst bits = 1\n```"} />
    </box>
  ), { width: 60, height: 14 });
  try {
    const frame = await setup.waitForFrame((value) => value.includes("const bits = 1"), { maxPasses: 1_000 });
    expect(frame).toContain("const bits = 1");
    expect(frame).not.toContain("##");
    expect(frame).not.toContain("**");
    expect(frame).not.toContain("```");
  } finally {
    setup.renderer.destroy();
  }
});

test("renders a centered full-screen mind picker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "minds-picker-"));
  const store = new ConversationStore(join(directory, "conversations.sqlite3"));
  const mind = {
    directory: join(directory, "Claude_Shannon"),
    core: "Reduce the problem.",
    manifest: {
      schema_version: 1 as const,
      id: "Claude_Shannon",
      name: "Claude Shannon",
      version: "0.1.0",
      default_language: "en",
      core: "core.md",
    },
  };
  const setup = await testRender(
    () => <Picker minds={[mind]} store={store} onDone={() => {}} />,
    { width: 80, height: 24 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("minds");
    expect(frame).toContain("choose a mind");
    expect(frame).toContain("Claude Shannon");
    expect(frame).toContain("Type to search");
  } finally {
    setup.renderer.destroy();
    store.close();
  }
});

test("shows and filters slash commands", async () => {
  expect(filterSlashCommands("/").map((command) => command.name)).toEqual([
    "/resume",
    "/minds",
    "/chat",
    "/full",
    "/new",
    "/retry",
    "/clear",
    "/help",
    "/quit",
  ]);
  expect(filterSlashCommands("/re").map((command) => command.name)).toEqual(["/resume", "/retry"]);
  expect(filterSlashCommands("/ret").map((command) => command.name)).toEqual(["/retry"]);

  const setup = await testRender(
    () => <CommandPalette commands={filterSlashCommands("/")} selected={0} />,
    { width: 70, height: 12 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("/new");
    expect(frame).toContain("Start a clean conversation");
    expect(frame).toContain("/retry");
    expect(frame).toContain("/quit");
  } finally {
    setup.renderer.destroy();
  }
});

test("renders and selects minds inside chat", async () => {
  const minds = [
    {
      directory: "/tmp/Claude_Shannon",
      core: "Reduce the problem.",
      manifest: { schema_version: 1 as const, id: "Claude_Shannon", name: "Claude Shannon", version: "0.1.0", default_language: "en", core: "core.md" },
    },
    {
      directory: "/tmp/Friedrich_Nietzsche",
      core: "Revalue the value.",
      manifest: { schema_version: 1 as const, id: "Friedrich_Nietzsche", name: "Friedrich Nietzsche", version: "0.1.0", default_language: "en", core: "core.md" },
    },
  ];
  let selected = "";
  const setup = await testRender(
    () => <MindSwitcher minds={minds} currentId="Claude_Shannon" onSelect={(mind) => { selected = mind.manifest.id; }} onClose={() => {}} />,
    { width: 76, height: 12 },
  );
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain("current");
    const switcherInput = setup.renderer.root.findDescendantById("mind-switcher-input") as InputRenderable;
    switcherInput.focus();
    setup.mockInput.pressArrow("down");
    await Bun.sleep(10);
    await setup.renderOnce();
    setup.mockInput.pressEnter();
    await Bun.sleep(10);
    await setup.renderOnce();
    expect(selected).toBe("Friedrich_Nietzsche");
  } finally {
    setup.renderer.destroy();
  }
});

test("renders and selects saved conversations", async () => {
  const now = new Date().toISOString();
  const conversations = [
    { id: "one", codexThreadId: "thread-one", mindId: "Claude_Shannon", mindVersion: "0.1.0", model: "test", responseMode: "chat" as const, title: "Information and uncertainty", createdAt: now, updatedAt: now },
    { id: "two", codexThreadId: "thread-two", mindId: "Friedrich_Nietzsche", mindVersion: "0.1.0", model: "test", responseMode: "chat" as const, title: "Creating values", createdAt: now, updatedAt: now },
  ];
  let selected = "";
  const setup = await testRender(
    () => <ThreadSwitcher conversations={conversations} currentId="one" messageCount={() => 4} onSelect={(conversation) => { selected = conversation.id; }} onClose={() => {}} />,
    { width: 76, height: 14 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Information and uncertainty");
    expect(frame).not.toContain("Claude Shannon");
    expect(frame).not.toContain("Friedrich Nietzsche");
    const switcherInput = setup.renderer.root.findDescendantById("thread-switcher-input") as InputRenderable;
    switcherInput.focus();
    setup.mockInput.pressArrow("down");
    await Bun.sleep(10);
    setup.mockInput.pressEnter();
    await Bun.sleep(10);
    expect(selected).toBe("two");
  } finally {
    setup.renderer.destroy();
  }
});

test("renders display and inline TeX without raw delimiters", async () => {
  const source = "Magnetic force obeys $F \\propto r^{-2}$.\n\n\\[B\\propto \\frac{1}{r^3}\\]";
  const blocks = splitRichContent(source);
  expect(blocks).toEqual([
    { type: "markdown", content: expect.stringContaining("F ∝ r⁻²") },
    { type: "math", formula: "B\\propto \\frac{1}{r^3}" },
  ]);
  expect(renderInlineMath("x^2 + y^2")).toBe("x² + y²");

  const setup = await testRender(
    () => <MindMarkdown content={source} />,
    { width: 60, height: 12 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("B ∝");
    expect(frame).toContain("r³");
    expect(frame).not.toContain("\\frac");
    expect(frame).not.toContain("\\[");
    expect(frame).not.toContain("\\]");
  } finally {
    setup.renderer.destroy();
  }
});

test("keeps a tall placeholder-free composer focused", async () => {
  let submissions = 0;
  const setup = await testRender(
    () => (
      <box width="100%" height="100%" flexDirection="column">
        <box id="outside-composer" width="100%" height={2} focusable>
          <text>Transcript</text>
        </box>
        <Composer
          mindName="Claude Shannon"
          model="gpt-5.6-sol"
          responseMode="full"
          status="ready"
          busy={false}
          commandOpen={false}
          inputRef={() => {}}
          onInput={() => {}}
          onSubmit={() => { submissions++; }}
        />
      </box>
    ),
    { width: 80, height: 8 },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Claude Shannon");
    expect(frame).toContain("gpt-5.6-sol");
    expect(frame).toContain("full");
    expect(frame).toContain("enter send");
    expect(frame).not.toContain("Ask Claude Shannon");
    const input = setup.renderer.root.findDescendantById("mind-composer-input") as TextareaRenderable;
    await Bun.sleep(10);
    await setup.renderOnce();
    expect(input.focused).toBe(true);
    expect(input.cursorStyle.style).toBe("block");
    expect(input.cursorStyle.blinking).toBe(false);
    await setup.mockInput.typeText("hello");
    setup.mockInput.pressEnter();
    await setup.renderOnce();
    expect(submissions).toBe(1);
    expect(input.plainText).toBe("hello");
    input.blur();
    expect(input.focused).toBe(false);
    await Bun.sleep(10);
    await setup.renderOnce();
    expect(input.focused).toBe(true);
    await setup.mockMouse.click(2, 0);
    await Bun.sleep(10);
    await setup.renderOnce();
    expect(input.focused).toBe(true);
  } finally {
    setup.renderer.destroy();
  }
});
