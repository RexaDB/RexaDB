#!/bin/zsh
# tools/pixdiff.sh <a.png> <b.png> <diff-out.png> [threshold] — red = differing pixels.
here=${0:A:h}
[[ -x $here/bin/pixdiff ]] || { mkdir -p $here/bin; swiftc -O $here/pixdiff.swift -o $here/bin/pixdiff 2>/dev/null; }
$here/bin/pixdiff "$@"
