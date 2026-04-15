#!/bin/bash
set -o pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:$PATH"
stdin=$(cat)
name=$(printf '%s\n' "$stdin" | jq -r '.model.display_name // ""' 2>/dev/null)
[ -z "$name" ] && exit 0
name="${name#Claude }"
name=$(printf '%s' "$name" | sed 's/ (\([0-9]*[KM]\) context)/ \1/; s/ ([^)]*context)//')
echo "$name"
