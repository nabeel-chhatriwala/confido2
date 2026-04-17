#!/usr/bin/env bash
set -euo pipefail

# Regenerates packages/shared/src/db/types.ts from the LOCAL Supabase DB.
# Prereq: `supabase start` is running.

# Resolve repo root regardless of caller's cwd (supports being run from a workspace script).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

out="$REPO_ROOT/packages/shared/src/db/types.ts"
mkdir -p "$(dirname "$out")"
(cd "$REPO_ROOT" && supabase gen types typescript --local --schema public) > "$out"
echo "Wrote $out"
