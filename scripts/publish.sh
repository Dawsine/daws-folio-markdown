#!/bin/bash
# Publish to VS Marketplace and Open VSX.
# Tokens live in the macOS keychain (VSCE_PAT, OVSX_PAT), or in the environment.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

read_secret() {
	local name="$1"
	if [ -n "${!name:-}" ]; then
		printf '%s' "${!name}"
		return 0
	fi
	security find-generic-password -s "$name" -w 2>/dev/null || true
}

save_secret() {
	local name="$1"
	local value="$2"
	security add-generic-password -a "$USER" -s "$name" -w "$value" -U
}

VSCE_PAT="$(read_secret VSCE_PAT)"
OVSX_PAT="$(read_secret OVSX_PAT)"

if [ -z "$VSCE_PAT" ] && [ -z "$OVSX_PAT" ]; then
	echo "No tokens in the keychain or environment."
	echo "  Open VSX:     https://open-vsx.org/user-settings/tokens"
	echo "                ./scripts/save-pat.sh OVSX_PAT"
	echo "  Marketplace:  Azure DevOps PAT, Marketplace → Acquire + Publish, all orgs"
	echo "                ./scripts/save-pat.sh VSCE_PAT"
	exit 1
fi

npm test

if [ -n "$VSCE_PAT" ]; then
	npx --yes @vscode/vsce publish -p "$VSCE_PAT"
else
	echo "Skip Marketplace (no VSCE_PAT)."
fi

if [ -n "$OVSX_PAT" ]; then
	npx --yes ovsx publish -p "$OVSX_PAT"
else
	echo "Skip Open VSX (no OVSX_PAT)."
fi

echo "Done $(node -p "require('./package.json').publisher + '.' + require('./package.json').name + ' v' + require('./package.json').version")"
