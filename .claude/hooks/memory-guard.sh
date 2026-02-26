#!/bin/bash
# MEMORY Write Advisory Guard — warns before edits to MEMORY.md.
# PreToolUse: Edit|Write
# Non-blocking: additionalContext injection only.

exec 3>&2 2>/dev/null
trap 'exit 0' ERR

# Set JQ to local binary path — update this to match your jq location
JQ="${JQ_PATH:-jq}"

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

file_path=$(echo "$input" | "$JQ" -r '.tool_input.file_path // empty' 2>/dev/null)
if [ -z "$file_path" ]; then
    file_path=$(echo "$input" | sed -nE 's/.*"file_path"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)
fi
[ -z "$file_path" ] && exit 0

file_path=$(echo "$file_path" | tr '\\' '/')

if [[ "$file_path" == *"MEMORY.md"* ]]; then
    context="MEMORY.md ADVISORY: This file loads every session. Before writing, verify this is a universal global preference (not session-specific, not project-specific, not historical record). If unsure whether content belongs here vs. a project STATE.md or skill file, ask the user."

    echo "$("$JQ" -n \
        --arg context "$context" \
        '{
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            additionalContext: $context
          }
        }' 2>/dev/null)"
fi

exit 0
