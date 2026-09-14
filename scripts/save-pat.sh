#!/bin/bash
# Usage: ./scripts/save-pat.sh VSCE_PAT
#        ./scripts/save-pat.sh OVSX_PAT
# Paste the token, then Enter, then Ctrl-D.
set -euo pipefail

name="${1:-}"
if [ "$name" != "VSCE_PAT" ] && [ "$name" != "OVSX_PAT" ]; then
	echo "Usage: $0 VSCE_PAT|OVSX_PAT" >&2
	exit 1
fi

if [ -t 0 ]; then
	echo "Paste $name, then Enter, then Ctrl-D." >&2
fi
value="$(tr -d '[:space:]')"
if [ -z "$value" ]; then
	echo "Empty token." >&2
	exit 1
fi

security add-generic-password -a "$USER" -s "$name" -w "$value" -U
echo "Saved $name to the login keychain (${#value} chars). Not printed."
