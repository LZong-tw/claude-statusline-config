#!/bin/bash
# Model name widget for ccstatusline Custom Command
# Trims "(1M context)" → "1M", removes other context suffixes
# e.g. "Claude Sonnet 4.6 (1M context)" → "Sonnet 4.6 1M"

export PATH="/usr/bin:/usr/local/bin:$PATH"

stdin=$(cat)
name=$(echo "$stdin" | jq -r '.model.display_name // ""' 2>/dev/null)
[ -z "$name" ] && exit 0

# Remove "Claude " prefix
name="${name#Claude }"

# Replace "(1M context)" with "1M", remove other "(* context)" suffixes
name=$(echo "$name" | sed 's/ (1M context)/ 1M/; s/ ([^)]*context)//')

echo "$name"
