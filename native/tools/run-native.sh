#!/bin/zsh
# tools/run-native.sh <out.png> [REXA_ROUTE] — build, launch at the reference size, capture its window, quit.
# Works with a shared CARGO_TARGET_DIR: the binary is copied out right after building so a
# parallel build in another worktree can't swap it underneath us.
set -e
here=${0:A:h}; root=${here:h}
target=${CARGO_TARGET_DIR:-/Volumes/Flaxo/rexadb-native-target/target}
export CARGO_TARGET_DIR=$target
cargo build -q -p rexa-app --manifest-path $root/Cargo.toml
bin=$(mktemp -t rexadb).bin
cp $target/debug/rexadb $bin
REXA_ROUTE=${2:-} REXA_WINDOW_SIZE=${REXA_WINDOW_SIZE:-1470x864} $bin &
pid=$!
# A freshly copied binary can take ~15s to show its window (macOS scans new
# executables on first launch), so poll for it, then let the first frames settle.
[[ -x $here/bin/winid ]] || { mkdir -p $here/bin; swiftc -O $here/winid.swift -o $here/bin/winid; }
for i in {1..60}; do sleep 1; $here/bin/winid $pid >/dev/null 2>&1 && break; done
sleep ${REXA_SHOT_DELAY:-3}
$here/shot.sh $pid "$1" || true
kill $pid 2>/dev/null || true
rm -f $bin
