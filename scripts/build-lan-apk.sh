#!/bin/sh
# BUILD THE CUSTOMER APP AS A PHONE TEST APK — and put it on the Desktop.
#
# The APK finds the backend on whatever Wi-Fi the phone is on (start it with
# backend/scripts/serve-lan.sh). Nothing in the source changes: the "lan"
# target is set for this build only and put back afterwards, even on failure.
set -e
cd "$(dirname "$0")/.."
CONFIG=src/common/config.ts
cp "$CONFIG" "$CONFIG.lanbuild"
restore() { mv "$CONFIG.lanbuild" "$CONFIG"; }
trap restore EXIT

sed -i '' 's/^export const API_TARGET = "auto" as ApiTarget;/export const API_TARGET = "lan" as ApiTarget;/' "$CONFIG"
grep -q '^export const API_TARGET = "lan" as ApiTarget;' "$CONFIG" || { echo "Could not set the lan target in $CONFIG" >&2; exit 1; }

VERSION="$(sed -n 's/.*versionName "\(.*\)".*/\1/p' android/app/build.gradle | head -1)"
(cd android && ./gradlew assembleRelease -PlanTest --quiet)

OUT="$HOME/Desktop/customer-app-${VERSION}-test.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
echo "APK: $OUT"
