# minds

Talk with the minds that shaped the world.

A mind is a small, versioned folder. Its `core.md` describes how that person produces a thought: what they notice, how they simplify a problem, what they count as evidence, where they resist authority, and what can change their mind. The model supplies broad learned knowledge. The core aligns that knowledge with one mind.

Aristotle, Claude Shannon, Friedrich Nietzsche, and Nikola Tesla ship preinstalled and are available on first launch.

## Why Minds

[Steve Jobs imagined](https://muse.ai/v/ZGQk98t-Steve-Jobs-presentation-at-Lunds-University-in-Sweden-1985) an interactive tool that could capture Aristotle's underlying worldview, so a student could ask him a question instead of only reading his surviving words. This project calls each person available through it a **mind**. The name describes what `core.md` contains: the machinery that produces the person's thought.

> Ask the minds that shaped the world.

## Requirements

- Bun 1.3 or newer
- Codex CLI installed and already logged in
- Linux or macOS

`minds` is a Solid application rendered by OpenTUI. It owns the full terminal screen, renders mind responses as Markdown, highlights fenced code, lays out TeX equations as selectable Unicode math, and keeps the transcript scrollable while the composer stays fixed at the bottom.

Chat starts Codex through `codex app-server`. Minds uses one durable workspace because a single thread can contain several minds. Codex owns persistent thread history there; Minds keeps a local SQLite index for its history UI, the active identity, per-message speaker labels, and conversations created by older versions.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
bun dist/index.js --help
```

Run the local CLI:

```bash
bunx minds
```

## Commands

```text
minds                         Open the last-used mind in a new conversation
minds fetch <slug-or-path>    Install an additional mind
minds list                    List available minds
minds chat <slug>             Start a new conversation with a mind
minds chat <slug> --mode chat Start with short, text-message replies
minds chats [slug]            List saved conversations
minds remove <slug>           Remove an installed mind
minds doctor                  Check Bun, Codex, and local data
minds completions <shell>     Print Tab completion for bash, zsh, or fish
```

The mind picker filters as you type. Use the arrow keys to move and Enter to open a chat.

Conversations use `chat` mode by default. It creates a casual, open-ended exchange in which the mind keeps its own interests, judgments, and conversational agency. Chat replies are usually one to three short sentences and stay under 60 words. Use `/full` when you want a developed answer, then `/chat` to switch back. The selected mode stays with the conversation. Both modes apply the shared Unslop policy without flattening the mind's own voice.

Inside a chat, `/resume` opens searchable thread history without grouping threads by person. New conversations resume from native Codex history. Conversations created by older Minds versions remain available through a compatibility path that restores their SQLite transcript and context. `/minds` changes the active person inside the current thread; earlier replies keep their original speaker labels. `/new` starts another thread with the current mind, `/retry` repeats an interrupted or failed turn, `/clear` redraws the transcript, `/help` shows the shortcuts, and `/quit` exits. Escape interrupts an answer.

## Shell completion

The shell owns Tab completion before `minds` starts, so load the completion script once in your shell:

```bash
# bash
source <(minds completions bash)

# zsh
source <(minds completions zsh)

# fish
minds completions fish | source
```

After that, `minds chat Fried<Tab>` completes installed mind IDs. Add the matching command to your shell startup file to keep completion after restarting the terminal.

Set `MINDS_DATA_DIR` to use a different data directory. This is useful for development and tests.

## Mind format

Every mind is a folder named with the canonical English Wikipedia page slug:

```text
Claude_Shannon/
├── mind.json
└── core.md
```

The minimum manifest is:

```json
{
  "schema_version": 1,
  "id": "Claude_Shannon",
  "name": "Claude Shannon",
  "version": "0.1.0",
  "default_language": "en",
  "core": "core.md"
}
```

Rules:

- The folder name and `id` must match.
- The ID uses Wikipedia slug syntax, including capitalization and underscores.
- Published behavioral changes receive a new semantic version.
- `core.md` must sit at the bundle root.
- Bundles are data-only. Markdown, JSON, YAML, and text files are accepted.
- Unknown manifest fields survive validation so the schema can grow.

Install a local mind while authoring it:

```bash
minds fetch ./path/to/Claude_Shannon
minds chat Claude_Shannon --new
```

Built-in minds load directly from the package. `fetch` copies an additional local bundle into the user's Minds library. A later edit to its source directory cannot change the installed copy.

## Writing `core.md`

Build the mind from first principles. Short, targeted sections work better than a long biography. A useful core answers questions like these:

- What happens first when this person meets a new problem?
- Which details do they discard, and which differences matter?
- How do abstraction and concrete experience correct each other?
- What qualifies as proof or persuasive evidence?
- How do they respond to failure, uncertainty, status, and disagreement?
- Which tensions in their character produce useful thought?
- What speech habits follow from those mechanics?

Ordinary biography belongs only where it explains a change in the production line. Quotations and book summaries are not a substitute for the mechanism.

A mind also needs a human side. Record how the person behaves when no problem needs solving: their humor, affection, vanity, shyness, ordinary pleasures, irritations, social rhythm, and willingness to be silly. These details should change conversation, not become trivia the mind repeats. A complete mind can discuss dinner, friendship, music, weather, embarrassment, or a bad joke without dragging everything back to its famous work.

The CLI adds a shared Unslop policy after the core. It removes generic model phrasing while preserving the mind's own voice.

## Current boundary

Version `0.3.0` includes four built-in minds and installs additional minds from local folders. It does not contain a remote registry, publishing flow, source archive, citations, mind generator, or automated persona judge. Those can be added without changing the required two-file bundle.
