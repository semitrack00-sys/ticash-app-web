#!/usr/bin/env bash
# Compose the existing website with the SAME Flutter target used by APK/AAB.
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=true
export TAR_OPTIONS=--no-same-owner
revision="$(node -p "JSON.parse(require('fs').readFileSync('tools/pwa-source.json')).revision")"
sdk_revision="$(node -p "JSON.parse(require('fs').readFileSync('tools/pwa-source.json')).flutterRevision")"
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'PWA source must be a reviewed commit SHA'; exit 1; }
[[ "$sdk_revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
# Read only the fixed project and official SDK; no branch guessing or credentials.
git init --quiet "$build_dir/source"
git -C "$build_dir/source" remote add origin https://github.com/semitrack00-sys/Ticash.git
git -C "$build_dir/source" fetch --depth=1 origin "$revision"
git -C "$build_dir/source" checkout --quiet --detach FETCH_HEAD
[[ "$(git -C "$build_dir/source" rev-parse HEAD)" = "$revision" ]] || exit 1
mkdir -p .build-cache
if [[ ! -d .build-cache/flutter/.git ]]; then
  git init --quiet .build-cache/flutter
  git -C .build-cache/flutter remote add origin https://github.com/flutter/flutter.git
fi
if [[ "$(git -C .build-cache/flutter rev-parse HEAD 2>/dev/null || true)" != "$sdk_revision" ]]; then
  git -C .build-cache/flutter fetch --depth=1 origin "$sdk_revision"
  git -C .build-cache/flutter checkout --quiet --detach FETCH_HEAD
fi
export PATH="$PWD/.build-cache/flutter/bin:$PATH"
python3 -m pip install --disable-pip-version-check --target "$build_dir/python" pillow==11.3.0
export PYTHONPATH="$build_dir/python${PYTHONPATH:+:$PYTHONPATH}"
bash "$build_dir/source/apps/flupflap/tool/build_pwa.sh"
node tools/stage-pwa.mjs "$build_dir/source/apps/flupflap/build/web" "$revision"
