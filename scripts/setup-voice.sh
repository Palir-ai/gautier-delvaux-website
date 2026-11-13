#!/usr/bin/env bash
# Installe le moteur de voix gratuit (Piper) et la voix française « Tom »
# dans .cache/ (non versionné). Utilisé par l'automatisation GitHub et en local.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/.cache"
VOICE="fr_FR-tom-medium"
VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/tom/medium"
VOICE_SHA256="bf65074ccdeeeeaa832e75edb1c0a513c01c9a972bdf085ff8a6e71ea234fd41"

mkdir -p "$CACHE/voices"

if [ ! -x "$CACHE/venv/bin/python" ]; then
  python3 -m venv "$CACHE/venv"
fi
"$CACHE/venv/bin/python" -m pip install --quiet --disable-pip-version-check "piper-tts==1.8.0"

for ext in onnx onnx.json; do
  file="$CACHE/voices/$VOICE.$ext"
  if [ ! -s "$file" ]; then
    curl --fail --silent --show-error --location --retry 3 -o "$file" "$VOICE_URL/$VOICE.$ext"
  fi
done

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$CACHE/voices/$VOICE.onnx" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$CACHE/voices/$VOICE.onnx" | cut -d' ' -f1)"
fi
if [ "$actual" != "$VOICE_SHA256" ]; then
  echo "Le fichier de voix téléchargé ne correspond pas à l'empreinte attendue." >&2
  rm -f "$CACHE/voices/$VOICE.onnx"
  exit 1
fi

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg est requis (conversion en MP3)." >&2; exit 1; }
echo "Voix prête : $VOICE"
