export type CompletionShell = "bash" | "zsh" | "fish";

const COMMANDS = "add list chat chats remove doctor completions help";
const CHAT_OPTIONS = "--model --mode --help";

function bashCompletion(): string {
  return `# minds shell completion
_minds_completion() {
  local current command
  COMPREPLY=()
  current="\${COMP_WORDS[COMP_CWORD]}"
  command="\${COMP_WORDS[1]}"

  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W "${COMMANDS}" -- "$current") )
    return
  fi

  if (( COMP_CWORD == 2 )) && [[ "$command" == "chat" || "$command" == "chats" || "$command" == "remove" ]]; then
    local minds
    minds="$(minds list 2>/dev/null | cut -f1)"
    COMPREPLY=( $(compgen -W "$minds" -- "$current") )
    return
  fi

  if [[ "$command" == "chat" ]]; then
    COMPREPLY=( $(compgen -W "${CHAT_OPTIONS}" -- "$current") )
    return
  fi

  if (( COMP_CWORD == 2 )) && [[ "$command" == "completions" ]]; then
    COMPREPLY=( $(compgen -W "bash zsh fish" -- "$current") )
  fi
}
complete -F _minds_completion minds`;
}

function zshCompletion(): string {
  return `#compdef minds
_minds() {
  local -a commands mind_ids
  commands=(${COMMANDS})

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "$words[2]" in
    chat|chats|remove)
      if (( CURRENT == 3 )); then
        mind_ids=("\${(@f)$(minds list 2>/dev/null | cut -f1)}")
        _describe 'mind' mind_ids
      elif [[ "$words[2]" == "chat" ]]; then
        local -a options
        options=(${CHAT_OPTIONS})
        _describe 'option' options
      fi
      ;;
    completions)
      local -a shells
      shells=(bash zsh fish)
      _describe 'shell' shells
      ;;
  esac
}
compdef _minds minds`;
}

function fishCompletion(): string {
  return `# minds shell completion
function __minds_ids
  minds list 2>/dev/null | string split -f1 \\t
end

complete -c minds -f
complete -c minds -n 'not __fish_seen_subcommand_from ${COMMANDS}' -a '${COMMANDS}'
complete -c minds -n '__fish_seen_subcommand_from chat chats remove' -a '(__minds_ids)'
complete -c minds -n '__fish_seen_subcommand_from chat' -l model -r -d 'Override the Codex model'
complete -c minds -n '__fish_seen_subcommand_from chat' -l mode -xa 'chat full' -d 'Choose the response style'
complete -c minds -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'`;
}

export function completionScript(shell: string): string {
  if (shell === "bash") return bashCompletion();
  if (shell === "zsh") return zshCompletion();
  if (shell === "fish") return fishCompletion();
  throw new Error("Usage: minds completions <bash|zsh|fish>");
}
