#!/bin/sh
# Downloads the JSI headers + jsi.cpp (MIT, Meta Platforms) needed to talk to Hermes.
# NOTE: the tag MUST match the JSI vtable layout of the Hermes inside Discord. Verified from crash logs
# (Discord 352): layout = RN 0.81 (ICast base, createStringFromUtf16 at slot 35, no deleteProperty).
# 0.80 and older lack ICast (slots shift by 3); 0.82+ add deleteProperty (slots shift after hasProperty).
set -e
TAG="${RN_TAG:-v0.81.0}"
BASE="https://raw.githubusercontent.com/facebook/react-native/$TAG/packages/react-native/ReactCommon/jsi/jsi"
DIR="$(dirname "$0")/../Headers/jsi"
mkdir -p "$DIR"
for f in jsi.h jsi-inl.h instrumentation.h jsi.cpp; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f"
done
echo "JSI ($TAG) ready"
