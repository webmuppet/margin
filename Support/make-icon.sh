#!/bin/bash
#
# Builds Support/AppIcon.icns from Support/AppIcon.png, the 1024 master.
#
#   Support/make-icon.sh
#
# Run it when the artwork changes. The .icns is committed so a build needs
# neither this script nor sips, and the master is committed so the .icns can
# always be rebuilt from something that is not itself a build artefact.
set -euo pipefail
SUPPORT="$(cd "$(dirname "$0")" && pwd)"
SET="$SUPPORT/AppIcon.iconset"

rm -rf "$SET"
mkdir -p "$SET"

make() {   # make <pixels> <name>
  sips -z "$1" "$1" "$SUPPORT/AppIcon.png" --out "$SET/$2" >/dev/null
}

make 16   "icon_16x16.png"
make 32   "icon_16x16@2x.png"
make 32   "icon_32x32.png"
make 64   "icon_32x32@2x.png"
make 128  "icon_128x128.png"
make 256  "icon_128x128@2x.png"
make 256  "icon_256x256.png"
make 512  "icon_256x256@2x.png"
make 512  "icon_512x512.png"
cp "$SUPPORT/AppIcon.png" "$SET/icon_512x512@2x.png"

echo "iconset:"
for f in "$SET"/*.png; do
  printf '  %-24s %s\n' "$(basename "$f")" "$(sips -g pixelWidth "$f" | tail -1 | tr -d ' \n')"
done

iconutil -c icns "$SET" -o "$SUPPORT/AppIcon.icns"
rm -rf "$SET"
echo "built: $(stat -f '%z bytes' "$SUPPORT/AppIcon.icns")"
