{ config, lib, ... }:

# Home Manager module for RexaDB (issue #30): installs the desktop package
# into the user profile.
#
#   inputs.rexadb.url = "github:RexaDB/RexaDB";
#   programs.rexadb = {
#     enable = true;
#     package = inputs.rexadb.packages.${pkgs.system}.rexadb;
#   };
let
  cfg = config.programs.rexadb;
in
{
  options.programs.rexadb = {
    enable = lib.mkEnableOption "RexaDB desktop database studio";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      example = lib.literalExpression "inputs.rexadb.packages.\${pkgs.system}.rexadb";
      description = "The rexadb desktop package to install (Linux only).";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.package != null;
        message = "programs.rexadb.package must be set, e.g. inputs.rexadb.packages.\${pkgs.system}.rexadb";
      }
    ];

    home.packages = [ cfg.package ];
  };
}
