# minds

Talk with the minds that shaped the world, directly from your terminal.

Minds relies on the model's existing knowledge of each person. It supplies a small identity cue, a human conversation layer, and a full unslop pass that removes the usual AI-assistant voice.

The MVP includes Aristotle, Claude Shannon, Friedrich Nietzsche, and Nikola Tesla. They are available on first launch.

## Install

Requirements:

- Bun 1.3 or newer
- Codex CLI installed and logged in
- Linux, macOS, or Windows

Install from npm:

```bash
bun add -g minds-cli
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
/model    Choose a model and reasoning level
/resume   Open saved thread history
/chat     Use short conversational replies
/full     Use developed replies
/new      Start a new thread
/retry    Retry an interrupted turn
/quit     Exit
```

Threads persist through Codex app-server. Changing minds keeps the same thread, and earlier replies retain their original speaker labels.

## Add another mind

Save any identity with its canonical English Wikipedia slug:

```bash
minds add Albert_Einstein
```

Minds reads the display name and short disambiguation from Wikipedia, then stores one identity record:

```json
{
  "schema_version": 2,
  "id": "Ada_Lovelace",
  "name": "Ada Lovelace",
  "language": "en",
  "description": "English mathematician and writer"
}
```

There is no personality specification or `core.md` in the MVP. Changing minds changes the identity cue while keeping the conversation intact. Older v1 bundles remain readable, but their core text is not injected into new conversations.

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

## Publishing

Maintainers: see [the release guide](https://github.com/0xmiki/minds-cli/blob/main/docs/publishing.md) for the first npm release and automatic publishing from version tags.

## License

MIT
