#!/bin/sh
# Renders the app icon themes from their SVG sources. Needs rsvg-convert.
set -eu
cd "$(dirname "$0")/.."
for svg in src-tauri/icons/app-icons/*.svg; do
  name=$(basename "$svg" .svg)
  rsvg-convert -w 1024 -h 1024 "$svg" -o "src-tauri/icons/app-icons/$name.png"
  rsvg-convert -w 256 -h 256 "$svg" -o "public/app-icons/$name.png"
done
