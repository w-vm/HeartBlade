#!/bin/sh
# Downloads the JSI headers + jsi.cpp (MIT, Meta Platforms) needed to talk to Hermes.
set -e
TAG="${RN_TAG:-v0.80.0}"
BASE="https://raw.githubusercontent.com/facebook/react-native/$TAG/packages/react-native/ReactCommon/jsi/jsi"
DIR="$(dirname "$0")/../Headers/jsi"
mkdir -p "$DIR"
for f in jsi.h jsi-inl.h instrumentation.h jsi.cpp; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f"
done
echo "JSI ($TAG) ready"
