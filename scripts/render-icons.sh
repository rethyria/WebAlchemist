#!/usr/bin/env bash
# Renders the PNG icons in public/icons from the three SVG sources there.
# Requires rsvg-convert (librsvg). Run from any directory; commit the output.
set -euo pipefail
dir="$(cd "$(dirname "$0")/../public/icons" && pwd)"
r() { rsvg-convert -w "$3" -h "$3" "$dir/$1.svg" -o "$dir/$2-$3.png"; }
# Extension icon, sidebar and store listing: the mark on its own background.
for s in 48 96 128; do r icon icon "$s"; done
for s in 16 32; do r icon sidebar "$s"; done
# Toolbar: "on-light" files carry the dark mark for a light toolbar.
for s in 16 32; do
  r icon-mark-on-light toolbar-on-light "$s"
  r icon-mark-on-dark toolbar-on-dark "$s"
done
