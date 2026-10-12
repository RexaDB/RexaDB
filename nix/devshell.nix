{ pkgs, lib, ... }:

# Reproducible dev shell for RexaDB (issue #30).
# Mirrors `.github/workflows/build.yml` + `arch-appimage.yml` toolchain:
# bun + node (Next.js frontend + sidecar), rust + cargo-tauri (desktop),
# JDK 21 (JDBC bridge), WebKitGTK 4.1 system libs (Tauri v2 on Linux).
pkgs.mkShell {
  nativeBuildInputs =
    with pkgs;
    [
      pkg-config
      bun
      nodejs
      cargo
      rustc
      cargo-tauri
      jdk21
      jq
    ]
    ++ lib.optionals pkgs.stdenv.isLinux [
      # Exposes $GSETTINGS_SCHEMAS_PATH etc. (used in shellHook below).
      wrapGAppsHook4
    ];

  buildInputs =
    with pkgs;
    [
      openssl
    ]
    ++ lib.optionals pkgs.stdenv.isLinux [
      webkitgtk_4_1
      gtk3
      libsoup_3
      librsvg
      libayatana-appindicator
      glib-networking
      dbus
      glib
    ];

  shellHook =
    ''
      export NEXT_TELEMETRY_DISABLED=1
      export WEBKIT_DISABLE_DMABUF_RENDERER=1
    ''
    + lib.optionalString pkgs.stdenv.isLinux ''
      # Needed on Wayland to report the correct display scale (NixOS wiki: Tauri).
      export XDG_DATA_DIRS="$GSETTINGS_SCHEMAS_PATH''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
    '';
}
