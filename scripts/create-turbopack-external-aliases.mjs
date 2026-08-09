import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const nextServerDir = path.join(rootDir, ".next", "server");
const nodeModulesDir = path.join(rootDir, "node_modules");

const hashedExternalPattern = /\b(?:better-sqlite3|pg|mongodb|mysql2|redis|mssql|cluster-key-slot)-[a-f0-9]{8,}\b|@(?:libsql|redis)\/client-[a-f0-9]{8,}\b|@clickhouse\/client-[a-f0-9]{8,}\b/g;

function walk(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".json"))) {
      out.push(fullPath);
    }
  }
  return out;
}

function toBasePackage(aliasName) {
  if (aliasName.startsWith("better-sqlite3-")) return "better-sqlite3";
  if (aliasName.startsWith("pg-")) return "pg";
  if (aliasName.startsWith("mongodb-")) return "mongodb";
  if (aliasName.startsWith("mysql2-")) return "mysql2";
  if (aliasName.startsWith("redis-")) return "redis";
  if (aliasName.startsWith("mssql-")) return "mssql";
  if (aliasName.startsWith("@libsql/client-")) return "@libsql/client";
  if (aliasName.startsWith("@clickhouse/client-")) return "@clickhouse/client";
  if (aliasName.startsWith("@redis/client-")) return "@redis/client";
  if (aliasName.startsWith("cluster-key-slot-")) return "cluster-key-slot";
  return null;
}

function rewriteHashedExternals(filePath) {
  const original = fs.readFileSync(filePath, "utf8");
  let rewritten = original;
  rewritten = rewritten.replace(/\bbetter-sqlite3-[a-f0-9]{8,}\b/g, "better-sqlite3");
  rewritten = rewritten.replace(/\bpg-[a-f0-9]{8,}\b/g, "pg");
  rewritten = rewritten.replace(/\bmongodb-[a-f0-9]{8,}\b/g, "mongodb");
  rewritten = rewritten.replace(/\bmysql2-[a-f0-9]{8,}\b/g, "mysql2");
  rewritten = rewritten.replace(/\bredis-[a-f0-9]{8,}\b/g, "redis");
  rewritten = rewritten.replace(/\bmssql-[a-f0-9]{8,}\b/g, "mssql");
  rewritten = rewritten.replace(/@libsql\/client-[a-f0-9]{8,}\b/g, "@libsql/client");
  rewritten = rewritten.replace(/@clickhouse\/client-[a-f0-9]{8,}\b/g, "@clickhouse/client");
  rewritten = rewritten.replace(/@redis\/client-[a-f0-9]{8,}\b/g, "@redis/client");
  rewritten = rewritten.replace(/\bcluster-key-slot-[a-f0-9]{8,}\b/g, "cluster-key-slot");
  if (rewritten !== original) {
    fs.writeFileSync(filePath, rewritten);
    return true;
  }
  return false;
}

function ensureAliasPackage(aliasName, basePackageName, extraExports = {}) {
  const aliasDir = path.join(nodeModulesDir, ...aliasName.split("/"));
  fs.mkdirSync(aliasDir, { recursive: true });

  const packageJsonPath = path.join(aliasDir, "package.json");
  const cjsPath = path.join(aliasDir, "index.cjs");
  const mjsPath = path.join(aliasDir, "index.mjs");

  const pkg = {
    name: aliasName,
    private: true,
    version: "0.0.0",
    main: "./index.cjs",
    exports: {
      ".": {
        require: "./index.cjs",
        import: "./index.mjs",
      },
      ...extraExports,
    },
  };

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.writeFileSync(cjsPath, `module.exports = require(${JSON.stringify(basePackageName)});\n`);
  fs.writeFileSync(
    mjsPath,
    `import * as mod from ${JSON.stringify(basePackageName)};\nexport default mod;\nexport * from ${JSON.stringify(basePackageName)};\n`
  );
}

function main() {
  if (!fs.existsSync(nextServerDir)) {
    console.error(`[alias] Missing ${nextServerDir}. Run next build first.`);
    process.exit(1);
  }

  const files = walk(nextServerDir);
  const aliases = new Set();
  let rewrites = 0;

  for (const filePath of files) {
    if (rewriteHashedExternals(filePath)) rewrites += 1;

    const content = fs.readFileSync(filePath, "utf8");
    const matches = content.match(hashedExternalPattern);
    if (!matches) continue;
    for (const aliasName of matches) aliases.add(aliasName);
  }

  console.log(`[alias] Rewrote ${rewrites} .next/server files to strip hashed externals.`);

  if (aliases.size > 0) {
    const created = [];
    for (const aliasName of aliases) {
      const basePackageName = toBasePackage(aliasName);
      if (!basePackageName) continue;
      if (aliasName.startsWith("@libsql/client-")) {
        ensureAliasPackage(aliasName, basePackageName, {
          "./node": {
            require: "./node.cjs",
            import: "./node.mjs",
          },
        });
        fs.writeFileSync(
          path.join(nodeModulesDir, ...aliasName.split("/"), "node.cjs"),
          `module.exports = require(${JSON.stringify(`${basePackageName}/node`)});\n`
        );
        fs.writeFileSync(
          path.join(nodeModulesDir, ...aliasName.split("/"), "node.mjs"),
          `import * as mod from ${JSON.stringify(`${basePackageName}/node`)};\nexport default mod;\nexport * from ${JSON.stringify(`${basePackageName}/node`)};\n`
        );
      } else {
        ensureAliasPackage(aliasName, basePackageName);
      }
      created.push(`${aliasName} -> ${basePackageName}`);
    }
    if (created.length > 0) {
      console.log("[alias] Created compatibility aliases:");
      for (const line of created) console.log(`- ${line}`);
    }
  }
}

main();
