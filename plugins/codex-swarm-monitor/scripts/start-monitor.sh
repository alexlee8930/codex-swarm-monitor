#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_JSON="$SCRIPT_DIR/../.codex-plugin/plugin.json"
REQUIRED_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_JSON" 2>/dev/null | head -n 1 || true)"
HAS_WORKSPACE=0
HAS_OPEN=0
HAS_DOCTOR=0
HAS_CONNECT=0
HAS_SUPPORT=0
HAS_EXIT_ONLY=0

launcher_version_matches() {
  candidate="$1"
  [ -z "$REQUIRED_VERSION" ] && return 0
  launcher_version="$("$candidate" --version 2>/dev/null | sed -n 's/.* \([0-9][0-9.]*\).*/\1/p' | head -n 1 || true)"
  [ "$launcher_version" = "$REQUIRED_VERSION" ]
}

for arg in "$@"; do
  case "$arg" in
    --workspace|-w|--workspace=*) HAS_WORKSPACE=1 ;;
    --open) HAS_OPEN=1 ;;
    --doctor) HAS_DOCTOR=1 ;;
    --connect) HAS_CONNECT=1 ;;
    --support) HAS_SUPPORT=1; HAS_EXIT_ONLY=1 ;;
    --help|-h|--version|-v) HAS_EXIT_ONLY=1 ;;
  esac
done

LAUNCHER="$(command -v codex-swarm-monitor 2>/dev/null || true)"
if [ -n "$LAUNCHER" ]; then
  if ! launcher_version_matches "$LAUNCHER"; then
    LAUNCHER=""
  fi
fi

if [ -z "$LAUNCHER" ]; then
  if ! "$SCRIPT_DIR/install-standalone.sh"; then
    echo "codex-swarm-monitor bootstrap failed before a launcher was available." >&2
    echo "  release version: ${CODEX_SWARM_RELEASE_VERSION:-v0.1.0}" >&2
    PLUGIN_REPOSITORY="$(sed -n 's/.*"repository"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_JSON" 2>/dev/null | head -n 1 || true)"
    DEFAULT_RELEASE_BASE="${PLUGIN_REPOSITORY:-https://github.com/codex-swarm-monitor/codex-swarm-monitor}/releases/download/${CODEX_SWARM_RELEASE_VERSION:-v0.1.0}"
    echo "  release base: ${CODEX_SWARM_RELEASE_BASE:-$DEFAULT_RELEASE_BASE}" >&2
    echo "  release dir: ${CODEX_SWARM_RELEASE_DIR:-<download from release base>}" >&2
    echo "  target: ${CODEX_SWARM_TARGET:-auto-detect}" >&2
    echo "  checked PATH plus: ${PREFIX:-$HOME/.local}/bin/codex-swarm-monitor" >&2
    echo "Publish the matching release archive/checksum or set CODEX_SWARM_RELEASE_DIR for an offline install." >&2
    exit 1
  fi
  LAUNCHER="$(command -v codex-swarm-monitor 2>/dev/null || true)"
fi

if [ -z "$LAUNCHER" ]; then
  PREFIX="${PREFIX:-$HOME/.local}"
  DEFAULT_LAUNCHER="$PREFIX/bin/codex-swarm-monitor"
  if [ -x "$DEFAULT_LAUNCHER" ]; then
    LAUNCHER="$DEFAULT_LAUNCHER"
  fi
fi

if [ -n "$LAUNCHER" ]; then
  if ! launcher_version_matches "$LAUNCHER"; then
    echo "codex-swarm-monitor launcher version does not match plugin $REQUIRED_VERSION after bootstrap: $LAUNCHER" >&2
    exit 1
  fi
fi

if [ -z "$LAUNCHER" ]; then
  echo "codex-swarm-monitor was not installed after bootstrap." >&2
  echo "  checked PATH and: ${PREFIX:-$HOME/.local}/bin/codex-swarm-monitor" >&2
  echo "  release version: ${CODEX_SWARM_RELEASE_VERSION:-v0.1.0}" >&2
  echo "  release dir: ${CODEX_SWARM_RELEASE_DIR:-<download from release base>}" >&2
  exit 1
fi

if [ "$HAS_WORKSPACE" = "0" ] && [ "$HAS_EXIT_ONLY" = "0" ]; then
  set -- "$@" --workspace "$PWD"
fi

if [ "$HAS_CONNECT" = "0" ] && [ "$HAS_DOCTOR" = "0" ] && [ "$HAS_SUPPORT" = "0" ] && [ "$HAS_EXIT_ONLY" = "0" ]; then
  set -- "$@" --connect
fi

if [ "$HAS_OPEN" = "0" ] && [ "$HAS_DOCTOR" = "0" ] && [ "$HAS_SUPPORT" = "0" ] && [ "$HAS_EXIT_ONLY" = "0" ]; then
  set -- "$@" --open
fi

exec "$LAUNCHER" "$@"
