#!/bin/zsh
# tools/run-native.sh <out.png> [REXA_ROUTE] — build, launch at the reference size, capture its window, quit.
set -e
here=${0:A:h}; root=${here:h}
cargo build -q -p rexa-app --manifest-path $root/Cargo.toml
REXA_ROUTE=${2:-} REXA_WINDOW_SIZE=${REXA_WINDOW_SIZE:-1470x864} $root/target/debug/rexadb &
pid=$!
sleep ${REXA_SHOT_DELAY:-5}
$here/shot.sh $pid "$1" || true
kill $pid 2>/dev/null || true
