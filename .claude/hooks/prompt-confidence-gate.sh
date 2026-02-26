#!/bin/bash
# Prompt Confidence Gate - detects vague, underspecified prompts.
# Event: UserPromptSubmit (all prompts; no matcher)
# Behavior: Advisory only via additionalContext (never blocks)

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

prompt_norm=$(echo "$prompt" | tr '\r\n' ' ' | tr '[:upper:]' '[:lower:]' | sed -E 's/[[:space:]]+/ /g; s/^ +| +$//g')
[ -z "$prompt_norm" ] && exit 0

# Token-friendly normalized form for phrase/command matching.
prompt_alpha=$(echo "$prompt_norm" | sed -E 's/[^a-z0-9_/:\\-]+/ /g; s/[[:space:]]+/ /g; s/^ +| +$//g')
[ -z "$prompt_alpha" ] && exit 0

word_count=$(echo "$prompt_alpha" | awk '{print NF}')

# Ignore obvious navigational or acknowledgment prompts.
if echo "$prompt_norm" | grep -Eiq '^/[[:alnum:]_.-]+'; then
    exit 0
fi
if [ "$word_count" -le 3 ] && echo "$prompt_alpha" | grep -Eiq '^(yes|y|ok|okay|k|go ahead|proceed|continue)$'; then
    exit 0
fi

# Ignore prompts that are already questions or explicit research asks.
if echo "$prompt_norm" | grep -Fq '?'; then
    exit 0
fi
if echo "$prompt_alpha" | grep -Eiq '\b(research|investigate|look up|lookup|search|find out|verify|double check|check (docs|documentation|online)|browse)\b'; then
    exit 0
fi

# Ignore prompts that already provide concrete scope markers.
if echo "$prompt_norm" | grep -Eiq '\b[0-9]{2}_[a-z0-9_-]+\b'; then
    exit 0
fi
if echo "$prompt_norm" | grep -Eiq '([a-z]:/|\.{0,2}/|\\\\)[^ ]+\.[a-z0-9]{1,8}\b'; then
    exit 0
fi
if echo "$prompt_norm" | grep -Eiq '\b[a-z_][a-z0-9_]*[[:space:]]*\([[:space:]]*\)'; then
    exit 0
fi

triggered=""

if echo "$prompt_alpha" | grep -Eiq '\b(fix it|fix this|clean this up|clean it up|just clean it|like we did before|same as last time|like last session|like before|handle it|handle this|just handle it|take care of it|make it work|make it better|make this work|you know what to do|just do it|just run it|just build it)\b'; then
    triggered="1"
fi

if [ -z "$triggered" ] && [ "$word_count" -ge 1 ] && [ "$word_count" -le 4 ]; then
    if echo "$prompt_alpha" | grep -Eiq '^(please[[:space:]]+)?(debug|refactor|update|fix|clean|improve|optimize)([[:space:]]+(this|it|code|project))?$'; then
        triggered="1"
    fi
fi

[ -z "$triggered" ] && exit 0

context="Vague prompt detected - scope is unclear; ask ONE clarifying question before acting and do not proceed with implementation until scope is confirmed."

echo "$("$JQ" -n \
    --arg context "$context" \
    '{
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: $context
      }
    }' 2>/dev/null)"

exit 0
