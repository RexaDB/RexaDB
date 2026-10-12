{ config, lib, pkgs, ... }:

# NixOS module for RexaDB (issue #30). Runs the compiled sidecar server as a
# systemd service; point `package` at this flake's output, e.g.:
#
#   inputs.rexadb.url = "github:RexaDB/RexaDB";
#   services.rexadb = {
#     enable = true;
#     package = inputs.rexadb.packages.${pkgs.system}.rexadb-server;
#   };
let
  cfg = config.services.rexadb;
in
{
  options.services.rexadb = {
    enable = lib.mkEnableOption "RexaDB sidecar server";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      example = lib.literalExpression "inputs.rexadb.packages.\${pkgs.system}.rexadb-server";
      description = "The rexadb-server package to run (from this flake).";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3867;
      description = "Port for the sidecar HTTP API (REXADB_SERVER_PORT).";
    };

    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/rexadb";
      description = "User data dir (REXADB_USER_DATA_DIR: sqlite.db, settings).";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "rexadb";
      description = "System user the service runs as.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.package != null;
        message = "services.rexadb.package must be set, e.g. inputs.rexadb.packages.\${pkgs.system}.rexadb-server";
      }
    ];

    users.users = lib.optionalAttrs (cfg.user == "rexadb") {
      rexadb = {
        isSystemUser = true;
        group = "rexadb";
        home = cfg.dataDir;
      };
    };
    users.groups = lib.optionalAttrs (cfg.user == "rexadb") {
      rexadb = { };
    };

    systemd.services.rexadb = {
      description = "RexaDB sidecar server";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        REXADB_SERVER_PORT = toString cfg.port;
        REXADB_USER_DATA_DIR = cfg.dataDir;
      };
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/rexadb-server";
        User = cfg.user;
        Restart = "on-failure";
        NoNewPrivileges = true;
      };
    };

    # Owns exactly the configured data dir (whatever it is) instead of a
    # hardcoded StateDirectory, so custom `dataDir` values start cleanly.
    systemd.tmpfiles.rules =
      let
        grp = if cfg.user == "rexadb" then "rexadb" else "users";
      in
      [ "d ${cfg.dataDir} 0750 ${cfg.user} ${grp} -" ];
  };
}
