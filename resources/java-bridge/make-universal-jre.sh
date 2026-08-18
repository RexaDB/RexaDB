#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ARM="dist/jre-arm64"
X64="dist/jre-x86_64"
OUT="dist/jre"

if [ ! -d "$ARM" ] || [ ! -d "$X64" ]; then
  echo "Missing arch JREs: $ARM or $X64" >&2
  exit 1
fi

rm -rf "$OUT"
cp -a "$X64" "$OUT"
chmod -R u+w "$OUT"

MERGED=0
while IFS= read -r f; do
  rel="${f#$ARM/}"
  x64="$X64/$rel"
  if [ -f "$x64" ] && file "$f" | grep -q 'Mach-O'; then
    if file "$x64" | grep -q 'Mach-O'; then
      lipo -create -output "$OUT/$rel" "$f" "$x64"
      MERGED=$((MERGED+1))
    fi
  fi
done < <(find "$ARM" -type f)

echo "Merged $MERGED Mach-O files with lipo"
echo "Universal JRE size: $(du -sh "$OUT" | cut -f1)"
