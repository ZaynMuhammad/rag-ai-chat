#!/usr/bin/env bash
set -euo pipefail

command=$(jq -r '.tool_input.command // ""')

if grep -Eq '(^|[;&|(`[:space:]])(pkill|killall)([[:space:]]|$)|(pgrep|pidof)[^;&]*\|[[:space:]]*xargs[[:space:]]+kill|kill[^;&|]*\$\((pgrep|pidof)|kill[^;&|]*`(pgrep|pidof)' <<<"$command"; then
  echo "Blocked: never kill processes by name or pattern. Other dev servers run on this machine. Kill only a PID you captured when you started the process (see AGENTS.md)." >&2
  exit 2
fi
