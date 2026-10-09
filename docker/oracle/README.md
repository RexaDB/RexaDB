# Local Oracle Free for RexaDB

Self-hosted Oracle Database Free used to exercise the native Rust Oracle bridge (no JDBC).

## Start

```bash
docker compose -f docker/oracle/docker-compose.yml up -d
```

Wait until the PDB service is registered. Docker may report `healthy` a few seconds before `FREEPDB1` is available on the listener (ORA-12514 if you connect too early). The smoke script waits automatically:

```bash
bun run scripts/oracle-e2e-smoke.mjs
```

Or poll manually:

```bash
docker exec rexadb-oracle healthcheck.sh
# or:
docker exec rexadb-oracle bash -lc 'echo "SELECT 1 FROM dual; EXIT;" | sqlplus -s rexadb/rexadb@//localhost/FREEPDB1'
```

First boot after `down -v` re-runs seed SQL and can take a minute or two.

## Credentials

| Field | Value |
| --- | --- |
| Host | `localhost` |
| Port | `1521` |
| App user | `rexadb` / `rexadb` |
| System user | `system` / `rexadb` |
| Service Name | `FREEPDB1` (PDB with app data) |
| SID | `FREE` (CDB root) |

## RexaDB connection URLs

Service Name (recommended):

```text
oracle://rexadb:rexadb@localhost:1521/FREEPDB1?sslmode=disable
```

SID (CDB; use `system`):

```text
oracle://system:rexadb@localhost:1521/?sid=FREE&sslmode=disable
```

Seed objects live in schema `REXADB`:

| Kind | Names |
| --- | --- |
| Tables | `DEPARTMENTS`, `EMPLOYEES` (with FK) |
| Views | `V_EMPLOYEE_DIRECTORY`, `V_DEPT_SALARY_SUMMARY` |
| Indexes | `IDX_EMPLOYEES_EMAIL`, `IDX_EMPLOYEES_DEPT`, `IDX_DEPARTMENTS_NAME` |
| Package | `EMP_UTILS` (spec + body) |
| DB link | `REXADB_LOOPBACK` → `localhost:1521/FREEPDB1` |

RexaDB’s Oracle sidebar currently lists **schemas / tables / views** for browsing. Indexes, packages, and database links exist in the DB (queryable via SQL) but are not first-class sidebar sections yet.

## Smoke test

```bash
bun run scripts/oracle-e2e-smoke.mjs
```

## Stop

```bash
docker compose -f docker/oracle/docker-compose.yml down
# wipe data volume:
docker compose -f docker/oracle/docker-compose.yml down -v
```
