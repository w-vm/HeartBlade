#!/bin/sh
# Downloads the JSI headers + jsi.cpp (MIT, Meta Platforms) needed to talk to Hermes.
# NOTE: the tag MUST match the JSI vtable layout of the Hermes inside Discord. Verified against crash logs
# (Discord 352): Hermes symbols are `IRuntime::PointerValue` => JSI split into IRuntime (RN >= 0.86), with
# cloneObject at slot 17, createStringFromUtf16 at slot 35, createObject at slot 38 (0x88 / 0x118 / 0x130).
# RN 0.86/0.87/0.88 share this layout. <= 0.85 has a different vtable order and crashes on startup.
set -e
TAG="${RN_TAG:-v0.86.0}"
BASE="https://raw.githubusercontent.com/facebook/react-native/$TAG/packages/react-native/ReactCommon/jsi/jsi"
DIR="$(dirname "$0")/../Headers/jsi"
mkdir -p "$DIR"
for f in jsi.h jsi-inl.h instrumentation.h jsi.cpp; do
  curl -fsSL "$BASE/$f" -o "$DIR/$f"
done
echo "JSI ($TAG) ready"
