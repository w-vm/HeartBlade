#!/bin/sh
# Downloads the JSI headers (MIT, Meta Platforms) needed to talk to Hermes.
set -e
TAG="${RN_TAG:-v0.85.0}"
BASE="https://raw.githubusercontent.com/facebook/react-native/$TAG/packages/react-native/ReactCommon/jsi/jsi"
mkdir -p "$(dirname "$0")/../Headers/jsi"
for f in jsi.h jsi-inl.h; do
  curl -fsSL "$BASE/$f" -o "$(dirname "$0")/../Headers/jsi/$f"
done
echo "JSI headers ($TAG) ready"
