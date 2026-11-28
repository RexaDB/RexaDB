#!/bin/zsh
# tools/dev-run.sh <binary> [args…] — cargo runner for macOS dev builds.
# Signs the freshly built binary with a stable identity + identifier so the macOS
# keychain treats every rebuild as the same app: click "Always Allow" on the
# keychain prompt once and it stops reappearing on each launch.
# Override the identity with REXA_SIGN_IDENTITY (any `security find-identity -p codesigning` hash/name);
# set it to "-" to skip signing.
bin=$1; shift
identity=${REXA_SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|Developer ID Application/ {print $2; exit}')}
if [[ -n $identity && $identity != "-" ]]; then
  codesign --force --sign "$identity" --identifier com.rexadb.native-dev --timestamp=none "$bin" >/dev/null 2>&1 \
    || echo "dev-run: codesign failed; the keychain may prompt on launch" >&2
fi
[[ -n $REXA_SIGN_ONLY ]] && exit 0
exec "$bin" "$@"
