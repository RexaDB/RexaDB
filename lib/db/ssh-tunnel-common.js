// Shared between lib/db/ssh-tunnel.ts and main.js
function parseExtendedConnection(connectionString, normalizeFn) {
  const url = new URL(normalizeFn(connectionString));
  const sshMode = url.searchParams.get("rexadb_ssh_mode") === "ssh" ? "ssh" : "off";
  const sshConfig = {
    mode: sshMode,
    host: url.searchParams.get("rexadb_ssh_host") || "",
    port: Number(url.searchParams.get("rexadb_ssh_port") || "22") || 22,
    username: url.searchParams.get("rexadb_ssh_user") || "",
    authMode: url.searchParams.get("rexadb_ssh_auth") === "private-key" ? "private-key" : "password",
    password: url.searchParams.get("rexadb_ssh_password") || "",
    privateKey: url.searchParams.get("rexadb_ssh_private_key") || "",
  };
  const customKeys = [
    "rexadb_keychain_db",
    "rexadb_ssh_mode",
    "rexadb_ssh_host",
    "rexadb_ssh_port",
    "rexadb_ssh_user",
    "rexadb_ssh_auth",
    "rexadb_ssh_keychain",
    "rexadb_ssh_password",
    "rexadb_ssh_private_key",
  ];
  for (const key of customKeys) {
    url.searchParams.delete(key);
  }
  return {
    baseConnectionString: url.toString(),
    sshConfig,
  };
}

module.exports = { parseExtendedConnection };
