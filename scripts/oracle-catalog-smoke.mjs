#!/usr/bin/env bun
/**
 * Smoke-test Oracle catalog dictionary queries via the native bridge.
 */
import {
  getIndexes,
  getPackages,
  getRoutines,
  getTriggers,
  getSequences,
  getSynonyms,
  getDbLinks,
  getViews,
  getMaterializedViews,
} from "../lib/db/oracle-client.ts";

const cs =
  process.env.ORACLE_URL ||
  "oracle://rexadb:rexadb@localhost:1521/FREEPDB1?sslmode=disable";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("[oracle-catalog] using", cs);
  const views = await getViews(cs, "REXADB");
  console.log("views:", views);
  assert(
    views.some((v) => /V_EMPLOYEE/i.test(v)),
    "expected V_EMPLOYEE_DIRECTORY",
  );

  const indexes = await getIndexes(cs, "REXADB");
  console.log(
    "indexes:",
    indexes.map((i) => i.name),
  );
  assert(
    indexes.some((i) => /IDX_EMPLOYEES_EMAIL/i.test(i.name)),
    "expected IDX_EMPLOYEES_EMAIL",
  );

  const packages = await getPackages(cs, "REXADB");
  console.log(
    "packages:",
    packages.map((p) => p.name),
  );
  assert(
    packages.some((p) => /EMP_UTILS/i.test(p.name)),
    "expected EMP_UTILS",
  );

  const routines = await getRoutines(cs, "REXADB");
  console.log(
    "routines sample:",
    routines.slice(0, 8).map((r) => r.name),
  );
  assert(routines.length > 0, "expected package members / routines");

  const triggers = await getTriggers(cs, "REXADB");
  console.log(
    "triggers:",
    triggers.map((t) => t.name),
  );

  const sequences = await getSequences(cs, "REXADB");
  console.log(
    "sequences:",
    sequences.map((s) => s.name),
  );

  const synonyms = await getSynonyms(cs, "REXADB");
  console.log(
    "synonyms:",
    synonyms.map((s) => s.name),
  );

  const links = await getDbLinks(cs);
  console.log(
    "db links:",
    links.map((l) => l.name),
  );
  assert(
    links.some((l) => /REXADB_LOOPBACK/i.test(l.name)),
    "expected REXADB_LOOPBACK",
  );

  const mviews = await getMaterializedViews(cs, "REXADB");
  console.log(
    "mviews:",
    mviews.map((m) => m.name),
  );
  assert(
    mviews.some((m) => /MV_DEPT_HEADCOUNT/i.test(m.name)),
    "expected MV_DEPT_HEADCOUNT",
  );

  console.log("[oracle-catalog] OK");
  // Force exit — bridge child can keep the event loop alive.
  process.exit(0);
}

main().catch((err) => {
  console.error("[oracle-catalog] FAILED:", err?.message || err);
  process.exit(1);
});
