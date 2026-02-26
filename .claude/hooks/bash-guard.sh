#!/bin/bash
# Destructive Bash Command Interceptor — blocks dangerous patterns
# PreToolUse on Bash

exec 3>&2 2>/dev/null
trap 'exit 0' ERR

# Set JQ to local binary path — update this to match your jq location
JQ="${JQ_PATH:-jq}"
input=$(cat 2>/dev/null)
[ -z "$input" ] && exit 0

command=$(echo "$input" | "$JQ" -r '.tool_input.command // empty' 2>/dev/null)
if [ -z "$command" ]; then
    command=$(echo "$input" | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)
fi
[ -z "$command" ] && exit 0

# Normalize
command=$(echo "$command" | tr '\\' '/')

# --- Destructive pattern checks ---

# Pattern 0: Windows NUL misuse in Bash context
# In Bash, redirects like "> nul" can create a real "nul" file on disk.
# Allow explicit cmd.exe /c usage (Windows device semantics).
if ! echo "$command" | grep -Eiq '(^|[[:space:];|&])cmd(\.exe)?[[:space:]]+/c([[:space:]]|$)' 2>/dev/null; then
    if echo "$command" | grep -Eiq '(^|[^[:alnum:]_])([0-9]?>|[0-9]?>>)[[:space:]]*nul([^[:alnum:]_]|$)' 2>/dev/null; then
        echo "BLOCKED: Bash command redirects to 'nul'. Use '/dev/null' in Bash, or run via 'cmd.exe /c' for Windows NUL semantics." >&3
        exit 2
    fi

    if echo "$command" | grep -Eiq '(^|[^[:alnum:]_])touch[[:space:]]+nul([^[:alnum:]_]|$)' 2>/dev/null; then
        echo "BLOCKED: Bash command would create reserved-name file 'nul'. Use '/dev/null' redirection or a real filename." >&3
        exit 2
    fi
fi

# Pattern 1: rm -rf on project directories (##_Name pattern)
if echo "$command" | grep -Eq 'rm[[:space:]]+(-[rf]+[[:space:]]+)*.*[0-9]{2}_' 2>/dev/null; then
    echo "BLOCKED: Destructive rm targeting a project directory. Confirm with user before deleting project files." >&3
    exit 2
fi

# Pattern 2: Wildcard deletes
if echo "$command" | grep -Eq 'rm[[:space:]]+(-[rf]+[[:space:]]+)*.*\*' 2>/dev/null; then
    echo "BLOCKED: Wildcard delete command. Confirm with user before bulk deletion." >&3
    exit 2
fi

# Pattern 3: mv files to archive without explicit instruction
# Allow only when a pre-approval token is included in the same command:
# ARCHIVE_OK=<keyword>
if echo "$command" | grep -Eiq 'mv[[:space:]]+.*\.(gs|md|py|js)[[:space:]]+.*archive' 2>/dev/null; then
    if echo "$command" | grep -Eiq 'ARCHIVE_OK=[A-Za-z0-9._:-]{4,}' 2>/dev/null; then
        echo "NOTICE: Archive move pre-approval token detected (ARCHIVE_OK=...)." >&3
    else
        echo "BLOCKED: Moving files to archive requires pre-approval token ARCHIVE_OK=<keyword> in the command." >&3
        exit 2
    fi
fi

# Pattern 4: clasp push --force
# Allow this by default; agent should still ask user before running risky commands.
if echo "$command" | grep -Eq 'clasp[[:space:]]+push[[:space:]]+--force' 2>/dev/null; then
    echo "WARNING: clasp push --force detected (allowed)." >&3
fi

# --- Cross-project path check ---

cwd=$(echo "$input" | "$JQ" -r '.cwd // empty' 2>/dev/null)
cwd=$(echo "$cwd" | tr '\\' '/')

# Extract project folder (##_Name pattern) from cwd
current_project=$(echo "$cwd" \
    | grep -Eoi '[0-9]{2}_[A-Za-z0-9_-]+' \
    | head -n 1)

if [ -n "$current_project" ]; then
    # Find project references in the command that differ from current
    other_projects=$(echo "$command" \
        | grep -Eoi '[0-9]{2}_[A-Za-z0-9_-]+' \
        | grep -v "^$current_project$" \
        | sort -u | head -3)
    if [ -n "$other_projects" ]; then
        echo "SCOPE WARNING: Bash command references project(s) outside $current_project: $other_projects. Confirm with user." >&3
        exit 2
    fi
fi

exit 0
