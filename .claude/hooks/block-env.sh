#!/usr/bin/env bash
# Blocks Claude from editing .env files that contain live credentials.
# Allows .env.example and .env.production.example through.
fp=$(cat | jq -r '.file_path // ""')
base=$(basename "$fp")

if [[ "$base" == .env || "$base" == .env.* ]] && [[ "$base" != *.example ]]; then
  echo "Blocked: $fp contains live credentials. Edit it manually outside Claude."
  exit 2
fi
