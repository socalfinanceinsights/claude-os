#!/bin/bash
# Builder Plan Gate — planning artifact visibility before Task subagent spawns
# PreToolUse: Task
# Non-blocking: additionalContext injection only.
#
# Checks workspace root (non-recursive) for PLAN_*.md or REQUIREMENTS_*.md
# and injects advisory context so Builder Step 1 compliance is visible.

exec 2>/dev/null
trap 'exit 0' ERR

# Set JQ to local binary path — update this to match your jq location
JQ="${JQ_PATH:-jq}"
# Set WORKSPACE_ROOT to your workspace root — update this to match your setup
ROOT="${WORKSPACE_ROOT:-$PWD}"

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

tool_name=$(echo "$input" | "$JQ" -r '.tool_name // empty' 2>/dev/null)
[ -z "$tool_name" ] && exit 0
[ "$tool_name" != "Task" ] && exit 0

# Normalize path-like values extracted from input.
cwd=$(echo "$input" | "$JQ" -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] && cwd=$(echo "$cwd" | tr '\\' '/')
ROOT=$(echo "$ROOT" | tr '\\' '/')

artifact_path=$(find "$ROOT" -maxdepth 1 -type f \( -name 'PLAN_*.md' -o -name 'REQUIREMENTS_*.md' \) 2>/dev/null | sort | head -n 1)

if [ -n "$artifact_path" ]; then
    artifact_name=$(basename "$artifact_path")
    context="Builder gate: Planning artifact found - ${artifact_name}. Step 1 compliance visible."
else
    context="Builder gate: No PLAN_*.md or REQUIREMENTS_*.md found in ${ROOT}. If this is a builder run, confirm Step 1 completion or explicit skip before spawning executors."
fi

echo "$("$JQ" -n \
    --arg context "$context" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: $context
      }
    }' 2>/dev/null)"

exit 0
