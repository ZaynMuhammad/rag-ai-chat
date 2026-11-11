#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // ""')
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

case "$file" in
  "$root"/.repos/* | "$root"/.claude/worktrees/* | "$root"/node_modules/*) exit 0 ;;
  "$root"/*) ;;
  *) exit 0 ;;
esac

[[ -f "$file" ]] || exit 0

cd "$root"
bin="$root/node_modules/.bin"
[[ -x "$bin/prettier" && -x "$bin/eslint" ]] || exit 0

"$bin/prettier" --write --ignore-unknown --log-level warn "$file" >&2 || true

case "$file" in
  *.ts | *.tsx | *.mts | *.mjs | *.js | *.jsx)
    if ! output=$("$bin/eslint" --max-warnings 0 --no-warn-ignored "$file" 2>&1); then
      echo "$output" >&2
      echo "Fix these lint errors in $file before moving on." >&2
      exit 2
    fi
    ;;
esac
