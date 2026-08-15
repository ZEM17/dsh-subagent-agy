#!/bin/bash
# Build: junction-link the @deepseek-ai peer dependencies from the running
# DSH install, then compile src/ → lib/ with the plugin-local tsc.
# Requires bash + node; DSH_NODE_MODULES overrides the runtime probe.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Locate the DSH runtime node_modules that owns the @deepseek-ai packages.
# Priority: DSH_NODE_MODULES → DSH_CHECKOUT/node_modules → newest _npx cache
# (Windows AppData, then Linux ~/.npm).
NM="${DSH_NODE_MODULES:-}"
if [ -z "$NM" ] && [ -n "${DSH_CHECKOUT:-}" ] && [ -d "$DSH_CHECKOUT/node_modules/@deepseek-ai/dsh-subagent" ]; then
  NM="$DSH_CHECKOUT/node_modules"
fi
if [ -z "$NM" ]; then
  for base in "$HOME/AppData/Local/npm-cache/_npx" "$HOME/.npm/_npx"; do
    [ -d "$base" ] || continue
    # Newest runtime install owning @deepseek-ai/dsh-subagent wins.
    # Plain loop + break (no `head -1` pipeline): head closing the pipe early
    # would SIGPIPE the reader and trip `set -e` under `pipefail`.
    for d in $(ls -td "$base"/*/node_modules 2>/dev/null); do
      if [ -d "$d/@deepseek-ai/dsh-subagent" ]; then
        NM="$d"
        break
      fi
    done
    [ -n "$NM" ] && break
  done
fi
if [ -z "$NM" ] || [ ! -d "$NM/@deepseek-ai/dsh-subagent" ]; then
  echo "build: cannot locate the DSH runtime node_modules (set DSH_NODE_MODULES)" >&2
  exit 1
fi

link_pkg() {
  local link="node_modules/$1"
  local target="$NM/$2"
  if [ ! -e "$target" ]; then
    echo "build: dependency target missing: $target" >&2
    exit 1
  fi
  node -e "
    const fs = require('fs');
    const path = require('path');
    const link = path.resolve(process.argv[1]);
    const target = path.resolve(process.argv[2]);
    fs.rmSync(link, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  " "$link" "$target"
}

echo "=== Linking build dependencies (runtime: $NM) ==="
mkdir -p node_modules/@deepseek-ai
link_pkg @deepseek-ai/cordis @deepseek-ai/cordis
link_pkg @deepseek-ai/schemastery @deepseek-ai/schemastery
link_pkg @deepseek-ai/dsh-subagent @deepseek-ai/dsh-subagent
link_pkg @deepseek-ai/dsh-subprocess @deepseek-ai/dsh-subprocess
link_pkg @deepseek-ai/dsh-subprocess-local @deepseek-ai/dsh-subprocess-local
link_pkg @deepseek-ai/dsh-jobs @deepseek-ai/dsh-jobs
link_pkg @deepseek-ai/dsh-tools @deepseek-ai/dsh-tools
link_pkg @deepseek-ai/dsh-agent @deepseek-ai/dsh-agent
link_pkg @deepseek-ai/dsh-session @deepseek-ai/dsh-session
link_pkg @deepseek-ai/dsh-llm @deepseek-ai/dsh-llm
link_pkg @deepseek-ai/dsh-brand @deepseek-ai/dsh-brand
link_pkg @deepseek-ai/dsh-scope @deepseek-ai/dsh-scope

echo "=== Compiling src → lib ==="
"$ROOT/node_modules/.bin/tsc" -p tsconfig.json
echo "=== Build complete ==="
