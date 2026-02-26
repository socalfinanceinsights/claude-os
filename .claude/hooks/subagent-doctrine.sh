#!/bin/bash
# Subagent-First Doctrine reminder — fires on UserPromptSubmit when work language detected.
# Non-blocking: additionalContext injection only.
# Keeps the subagent-first doctrine visible before Claude starts planning its response.
# Reference: docs/reference/REF_Subagent_Manifesto.md (if you have one)

exec 3>&2 2>/dev/null
trap 'exit 0' ERR

# Set JQ to local binary path — update this to match your jq location
JQ="${JQ_PATH:-jq}"

input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

prompt=$(echo "$input" | "$JQ" -r '.prompt // .user_prompt // .message // .input // empty' 2>/dev/null)
if [ -z "$prompt" ]; then
    prompt=$(echo "$input" | sed -nE 's/.*"(prompt|user_prompt|message|input)"[[:space:]]*:[[:space:]]*"([^"]+)".*/\2/p' | head -n 1)
fi
[ -z "$prompt" ] && exit 0

prompt_norm=$(echo "$prompt" | tr '\r\n' ' ' | tr '[:upper:]' '[:lower:]')

# Only fire when the prompt suggests substantive work (not casual chat or simple questions)
if echo "$prompt_norm" | grep -Eiq '\b(investigate|build|implement|fix|debug|audit|check|analyze|review|figure out|look into|look at|update|refactor|clean up|research|scan|explore|trace|diagnose|set up|configure|migrate|deploy|test|verify|compare|summarize|run|handle|go through|pull|show me|write the|create the|add the|change the|move the|rename)\b'; then
    context="SUBAGENT-FIRST: Main session orchestrates, agents execute. Spawn for any task needing 3+ tool calls. Inline only for orientation reads and routing."

    echo "$("$JQ" -n \
        --arg context "$context" \
        '{
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: $context
          }
        }' 2>/dev/null)"
fi

exit 0
