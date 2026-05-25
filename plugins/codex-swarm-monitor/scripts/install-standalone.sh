#!/usr/bin/env sh
set -eu

TARGET="${CODEX_SWARM_TARGET:-}"
PREFIX="${PREFIX:-$HOME/.local}"
RELEASE_DIR="${CODEX_SWARM_RELEASE_DIR:-}"
RELEASE_VERSION="${CODEX_SWARM_RELEASE_VERSION:-v0.1.0}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PLUGIN_JSON="$SCRIPT_DIR/../.codex-plugin/plugin.json"
PLUGIN_REPOSITORY="$(sed -n 's/.*"repository"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PLUGIN_JSON" 2>/dev/null | head -n 1 || true)"
DEFAULT_RELEASE_BASE="${PLUGIN_REPOSITORY:-https://github.com/codex-swarm-monitor/codex-swarm-monitor}/releases/download/$RELEASE_VERSION"
RELEASE_BASE="${CODEX_SWARM_RELEASE_BASE:-$DEFAULT_RELEASE_BASE}"

fail() {
  echo "codex-swarm-monitor standalone install failed: $1" >&2
  echo "  target: ${TARGET:-auto-detect}" >&2
  echo "  release version: $RELEASE_VERSION" >&2
  echo "  release base: $RELEASE_BASE" >&2
  echo "  release dir: ${RELEASE_DIR:-<download from release base>}" >&2
  echo "  install prefix: $PREFIX" >&2
  echo "Set CODEX_SWARM_RELEASE_DIR to a folder containing the archive/checksum, or publish the matching GitHub release assets." >&2
  exit "${2:-1}"
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command not found: $1" 127
  fi
}

verify_checksum() {
  file="$1"
  checksum_file="$2"
  expected="$(awk '{print $1}' "$checksum_file")"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  else
    fail "required command not found: sha256sum or shasum" 127
  fi
  if [ "$actual" != "$expected" ]; then
    fail "checksum mismatch for $file"
  fi
}

if [ -z "$TARGET" ]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os:$arch" in
    darwin:arm64) TARGET="darwin-arm64" ;;
    darwin:x86_64|darwin:amd64) TARGET="darwin-x64" ;;
    linux:x86_64|linux:amd64) TARGET="linux-x64" ;;
    *)
      fail "unsupported platform: $os/$arch; set CODEX_SWARM_TARGET explicitly if a compatible artifact exists" 2
      ;;
  esac
fi

name="codex-swarm-monitor-$TARGET"
archive="$name.tar.gz"
checksum="$archive.sha256"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/codex-swarm-install.XXXXXX")"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT INT TERM

if [ -n "$RELEASE_DIR" ]; then
  [ -f "$RELEASE_DIR/$archive" ] || fail "release archive not found: $RELEASE_DIR/$archive"
  [ -f "$RELEASE_DIR/$checksum" ] || fail "release checksum not found: $RELEASE_DIR/$checksum"
  cp "$RELEASE_DIR/$archive" "$tmp/$archive"
  cp "$RELEASE_DIR/$checksum" "$tmp/$checksum"
else
  require curl
  curl -fsSL "$RELEASE_BASE/$archive" -o "$tmp/$archive" || fail "could not download $RELEASE_BASE/$archive"
  curl -fsSL "$RELEASE_BASE/$checksum" -o "$tmp/$checksum" || fail "could not download $RELEASE_BASE/$checksum"
fi

require tar
verify_checksum "$tmp/$archive" "$tmp/$checksum"
tar -xzf "$tmp/$archive" -C "$tmp" || fail "could not extract $archive"

if [ ! -x "$tmp/$name/install.sh" ]; then
  fail "archive does not contain executable install.sh"
fi

PREFIX="$PREFIX" "$tmp/$name/install.sh" >/dev/null
echo "Installed codex-swarm-monitor to $PREFIX/bin/codex-swarm-monitor"
echo "Run: codex-swarm-monitor --workspace \"\$PWD\" --connect --open"
