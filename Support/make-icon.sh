#!/bin/bash
#
# Builds Support/AppIcon.icns and Support/Assets.car from the Icon Composer
# source, margin-app-icon.icon.
#
#   Support/make-icon.sh
#
# Run it when the artwork changes. Both outputs are committed so an ordinary
# build needs neither Xcode's asset compiler nor this script.
#
# It is Apple's own compiler that does the work, and that is the whole point of
# this file existing. The artwork was hand-placed onto the macOS grid twice —
# 80.5% everywhere, then 75% at the small sizes to match Mail exactly — and both
# read as smaller than every icon beside them. actool lands on precisely those
# same numbers, 24px of body at 32 and 102px at 128, and looks right, because
# the grid was never the whole of it: the squircle's own curve, the gradient,
# the shadow and the glass treatment are what make an icon sit on the surface,
# and reimplementing that from a flattened PNG export was the mistake.
#
# The source is what Icon Composer edits. There is nothing wrong with the art.
set -euo pipefail

SUPPORT="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SUPPORT")"
SOURCE="$ROOT/margin-app-icon.icon"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

[ -d "$SOURCE" ] || { echo "no icon source at $SOURCE" >&2; exit 1; }

mkdir -p "$STAGE/out"
xcrun actool "$SOURCE" \
	--compile "$STAGE/out" \
	--platform macosx \
	--minimum-deployment-target 26.0 \
	--app-icon "$(basename "$SOURCE" .icon)" \
	--output-partial-info-plist "$STAGE/icon-info.plist" \
	--errors --warnings > /dev/null

cp "$STAGE/out/$(basename "$SOURCE" .icon).icns" "$SUPPORT/AppIcon.icns"
# Assets.car carries the layered form, which is what macOS 26 draws when it
# wants the glass treatment rather than a flat bitmap.
cp "$STAGE/out/Assets.car" "$SUPPORT/Assets.car"

echo "AppIcon.icns and Assets.car — compiled by actool from $(basename "$SOURCE")"
