#!/usr/bin/env bash
# Copy Claude Code's memory directory into docs/memory/ — see docs/memory/README.md.
#
# The memory directory lives outside the repo, under a path built from this
# checkout's own location, so it is derived rather than hard-coded: a different
# home directory or clone path still resolves.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
slug="${repo//\//-}"
src="$HOME/.claude/projects/${slug}/memory"
dest="$repo/docs/memory"

if [[ ! -d "$src" ]]; then
  echo "No memory directory at $src — nothing to sync." >&2
  echo "On a fresh machine you want the other direction:" >&2
  echo "  mkdir -p \"$src\" && cp \"$dest\"/*.md \"$src\"/" >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  # README.md is written by hand and lives only in the repo, so it is never
  # part of the comparison.
  if diff -rq --exclude=README.md "$src" "$dest" >/dev/null 2>&1; then
    echo "docs/memory is current."
  else
    echo "docs/memory has drifted from $src:" >&2
    diff -rq --exclude=README.md "$src" "$dest" >&2 || true
    echo >&2
    echo "Run ./scripts/sync-memory.sh to bring it up to date." >&2
    exit 1
  fi
  exit 0
fi

# Deleted memories must disappear here too — a memory is sometimes deleted
# because it turned out to be WRONG, and a backup that keeps it is worse than
# one that lost it.
find "$dest" -maxdepth 1 -name '*.md' ! -name 'README.md' -delete
cp "$src"/*.md "$dest"/
echo "Synced $(ls -1 "$dest"/*.md | wc -l | tr -d ' ') files into docs/memory/."
