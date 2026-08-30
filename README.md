# minds

Talk with the minds that shaped the world, directly from your terminal.

Minds gives each person a small, versioned `core.md` that describes how they think and who they are outside their work. Codex supplies broad knowledge; the core supplies judgment, temperament, humor, and voice.

The MVP includes Aristotle, Claude Shannon, Friedrich Nietzsche, and Nikola Tesla. They are available on first launch.

## Install

Requirements:

- Bun 1.3 or newer
- Codex CLI installed and logged in
- Linux, macOS, or Windows

Install the latest GitHub release:

```bash
bun add -g minds-cli@https://github.com/0xmiki/minds-cli/releases/latest/download/minds-cli.tgz
```

Then run:

```bash
minds doctor
minds
```

Run the install command again to update. Remove Minds with `bun remove -g minds-cli`.

## Use

Chat mode is the default. It keeps replies brief, casual, and open-ended. Use `/full` when you want a developed answer.

Inside a conversation:

```text
/minds    Change the active mind in this thread
/resume   Open saved thread history
/chat     Use short conversational replies
/full     Use developed replies
/new      Start a new thread
/retry    Retry an interrupted turn
/quit     Exit
```

Threads persist through Codex app-server. Changing minds keeps the same thread, and earlier replies retain their original speaker labels.

## Add a mind

A mind is a data-only folder named with its canonical English Wikipedia slug:

```text
Ada_Lovelace/
├── mind.json
└── core.md
```

`mind.json` contains the ID, name, semantic version, language, and core filename. `core.md` should capture reasoning mechanics and ordinary humanity: standards of evidence, recurring tensions, humor, affection, pride, social rhythm, and what can change the person's mind.

Install a local bundle:

```bash
minds fetch ./path/to/Ada_Lovelace
```

See the bundled minds for complete examples.

## Shell completion

```bash
# bash
source <(minds completions bash)

# zsh
source <(minds completions zsh)

# fish
minds completions fish | source
```

## Develop

```bash
git clone https://github.com/0xmiki/minds-cli.git
cd minds-cli
bun ci
bun run typecheck
bun test
bun run build
bun dist/index.js
```

Minds stores local state under the platform data directory. Set `MINDS_DATA_DIR` to use another location.

## License

MIT
