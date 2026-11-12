#!/bin/zsh
# tools/shot.sh <pid> <out.png> — capture ONLY that process's window (never the full screen).
set -e
here=${0:A:h}
[[ -x $here/bin/winid ]] || { mkdir -p $here/bin; swiftc -O $here/winid.swift -o $here/bin/winid; }
id=$($here/bin/winid "$1") || { echo "no on-screen window for pid $1" >&2; exit 1; }
screencapture -x -o -l $id "$2"
