#!/bin/bash
# Scope Enforcement Hook — blocks cross-project Edit/Write operations
# PreToolUse on Edit|Write

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

cwd=$(echo "$input" | "$JQ" -r '.cwd // empty' 2>/dev/null)
if [ -z "$cwd" ]; then
    cwd=$(echo "$input" | sed -nE 's/.*"cwd"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n 1)
fi
[ -z "$cwd" ] && exit 0

# Normalize to forward slashes
file_path=$(echo "$file_path" | tr '\\' '/')
cwd=$(echo "$cwd" | tr '\\' '/')

# Extract project folder (##_Name pattern) from file path and cwd
target_project=$(echo "$file_path" | grep -Eoi '[0-9]{2}_[A-Za-z0-9_-]+' | head -n 1)
current_project=$(echo "$cwd" | grep -Eoi '[0-9]{2}_[A-Za-z0-9_-]+' | head -n 1)

# If both are in numbered project folders and they differ, block
if [ -n "$target_project" ] && [ -n "$current_project" ] && [ "$target_project" != "$current_project" ]; then
    echo "SCOPE VIOLATION: Working in $current_project but trying to edit a file in $target_project. Confirm with the user first." >&3
    exit 2
fi

exit 0
