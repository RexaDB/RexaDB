// Idempotent DDL for PayKit billing state in the USER's Supabase project.
//
// Tables live in a dedicated `paykit` schema (not `public`) with short names:
//   paykit.customer, paykit.subscription, paykit.entitlement, ...
// Layout is derived from paykitjs@0.1.6 database/migrations
// (0000_init.sql + 0001_stripe_only_schema.sql + 0002_add-product-price-currency.sql)
// but is NOT identical to upstream: upstream is hardcoded to `public`
// (migrationsSchema = "public", no schema option), so `paykitjs push` will
// not manage these tables — RexaDB's Deploy flow (push-schema +
// sync-products) is the supported path.
//
// Every statement is individually executable through
// POST /v1/projects/{ref}/database/query (one statement per request) and
// idempotent, so push-schema can run repeatedly and resume safely.
//
// Only `service_role` (used by the Edge Functions) gets access — anon /
// authenticated get nothing, so billing data is never exposed via Data API.
//
// Every table additionally has ROW LEVEL SECURITY enabled with no policies
// (deny-by-default): even if a grant to anon/authenticated is ever added by
// accident, reads stay blocked. `service_role` and the table owner bypass
// RLS, so Edge Function traffic is unaffected.
//
// Do NOT write to these tables directly — the Edge Functions own them.

export const PAYKIT_SCHEMA = "paykit";

export const PAYKIT_TABLE_NAMES = [
  "customer",
  "entitlement",
  "feature",
  "invoice",
  "metadata",
  "payment_method",
  "product",
  "product_feature",
  "subscription",
  "webhook_event",
] as const;

export type PaykitTableName = (typeof PAYKIT_TABLE_NAMES)[number];

export function paykitTable(name: PaykitTableName): string {
  return `${PAYKIT_SCHEMA}.${name}`;
}

export const PAYKIT_SCHEMA_VERSION = "paykit-schema-1";

/** Least-privilege grants, re-runnable for repair (all idempotent). */
export const PAYKIT_SCHEMA_GRANT_STATEMENTS: string[] = [
  `GRANT USAGE ON SCHEMA "${PAYKIT_SCHEMA}" TO service_role`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "${PAYKIT_SCHEMA}" GRANT ALL ON TABLES TO service_role`,
  `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA "${PAYKIT_SCHEMA}" GRANT ALL ON SEQUENCES TO service_role`,
];

/** Covers pre-existing tables too; re-runnable. */
export const PAYKIT_TABLE_GRANT_STATEMENT: string =
  `GRANT ALL ON ALL TABLES IN SCHEMA "${PAYKIT_SCHEMA}" TO service_role`;

/** Full grant set, for gap repair. */
export const PAYKIT_GRANT_STATEMENTS: string[] = [
  ...PAYKIT_SCHEMA_GRANT_STATEMENTS,
  PAYKIT_TABLE_GRANT_STATEMENT,
];

/** Single ENABLE statement for one table (name must be a known table). */
export function paykitRlsStatement(table: string): string {
  if (!(PAYKIT_TABLE_NAMES as readonly string[]).includes(table)) {
    throw new Error(`Unknown paykit table: ${table}`);
  }
  return `ALTER TABLE "${PAYKIT_SCHEMA}"."${table}" ENABLE ROW LEVEL SECURITY`;
}

/**
 * ENABLE statements for the given tables (defaults to all). Unknown names
 * are dropped, so status-derived gaps can be passed straight through.
 */
export function buildPaykitRlsStatements(tables: readonly string[] = PAYKIT_TABLE_NAMES): string[] {
  const known = new Set<string>(PAYKIT_TABLE_NAMES);
  return [...new Set(tables)].filter((t) => known.has(t)).map(paykitRlsStatement);
}

/**
 * Ordered, individually-executable statements. The sidecar runs them
 * sequentially via the Management API query endpoint and stops on first
 * error (each statement is idempotent, so resume is safe).
 */
export const PAYKIT_SCHEMA_STATEMENTS: string[] = [
  // ── schema + least-privilege grants ──────────────────────────────────
  `CREATE SCHEMA IF NOT EXISTS "${PAYKIT_SCHEMA}"`,
  ...PAYKIT_SCHEMA_GRANT_STATEMENTS,
  // ── base tables ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."customer" (
    "id" text PRIMARY KEY NOT NULL,
    "email" text,
    "name" text,
    "metadata" jsonb,
    "deleted_at" timestamp,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "stripe_customer_id" text,
    "stripe_test_clock_id" text,
    "stripe_frozen_time" timestamptz,
    "stripe_synced_email" text,
    "stripe_synced_name" text,
    "stripe_synced_metadata" jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."entitlement" (
    "id" text PRIMARY KEY NOT NULL,
    "subscription_id" text,
    "customer_id" text NOT NULL,
    "feature_id" text NOT NULL,
    "limit" integer,
    "balance" integer,
    "next_reset_at" timestamp,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."feature" (
    "id" text PRIMARY KEY NOT NULL,
    "type" text NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."invoice" (
    "id" text PRIMARY KEY NOT NULL,
    "customer_id" text NOT NULL,
    "subscription_id" text,
    "type" text NOT NULL,
    "status" text NOT NULL,
    "amount" integer NOT NULL,
    "currency" text NOT NULL,
    "description" text,
    "hosted_url" text,
    "period_start_at" timestamp,
    "period_end_at" timestamp,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "stripe_invoice_id" text,
    "stripe_payment_id" text,
    "stripe_payment_method_id" text
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."metadata" (
    "id" text PRIMARY KEY NOT NULL,
    "type" text NOT NULL,
    "data" jsonb NOT NULL,
    "expires_at" timestamp,
    "created_at" timestamp NOT NULL,
    "stripe_checkout_session_id" text
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."payment_method" (
    "id" text PRIMARY KEY NOT NULL,
    "customer_id" text NOT NULL,
    "deleted_at" timestamp,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "stripe_payment_method_id" text,
    "type" text,
    "brand" text,
    "last4" text,
    "expiry_month" integer,
    "expiry_year" integer,
    "is_default" boolean DEFAULT false NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."product" (
    "internal_id" text PRIMARY KEY NOT NULL,
    "id" text NOT NULL,
    "version" integer DEFAULT 1 NOT NULL,
    "name" text NOT NULL,
    "group" text DEFAULT '' NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "price_amount" integer,
    "price_interval" text,
    "price_currency" text,
    "hash" text,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "stripe_product_id" text,
    "stripe_price_id" text
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."product_feature" (
    "product_internal_id" text NOT NULL,
    "feature_id" text NOT NULL,
    "limit" integer,
    "reset_interval" text,
    "config" jsonb,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    CONSTRAINT "paykit_product_feature_pkey" PRIMARY KEY("product_internal_id","feature_id")
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."subscription" (
    "id" text PRIMARY KEY NOT NULL,
    "customer_id" text NOT NULL,
    "product_internal_id" text NOT NULL,
    "status" text NOT NULL,
    "canceled" boolean DEFAULT false NOT NULL,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "started_at" timestamp,
    "trial_ends_at" timestamp,
    "current_period_start_at" timestamp,
    "current_period_end_at" timestamp,
    "canceled_at" timestamp,
    "ended_at" timestamp,
    "scheduled_product_id" text,
    "quantity" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp NOT NULL,
    "updated_at" timestamp NOT NULL,
    "stripe_subscription_id" text,
    "stripe_subscription_schedule_id" text
  )`,
  `CREATE TABLE IF NOT EXISTS "${PAYKIT_SCHEMA}"."webhook_event" (
    "id" text PRIMARY KEY NOT NULL,
    "type" text NOT NULL,
    "payload" jsonb NOT NULL,
    "status" text NOT NULL,
    "error" text,
    "trace_id" text,
    "received_at" timestamp NOT NULL,
    "processed_at" timestamp,
    "stripe_event_id" text
  )`,
  // ── grants on the tables themselves (covers pre-existing tables too) ─
  PAYKIT_TABLE_GRANT_STATEMENT,
  // ── row level security: deny-by-default on every table ───────────────
  // No policies are created on purpose — anon/authenticated read nothing.
  // ENABLE is idempotent, so re-running setup heals pre-RLS projects.
  ...buildPaykitRlsStatements(),
  // ── foreign keys (guarded) ───────────────────────────────────────────
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_entitlement_subscription_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."entitlement" ADD CONSTRAINT "paykit_entitlement_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "${PAYKIT_SCHEMA}"."subscription"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_entitlement_customer_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."entitlement" ADD CONSTRAINT "paykit_entitlement_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "${PAYKIT_SCHEMA}"."customer"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_entitlement_feature_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."entitlement" ADD CONSTRAINT "paykit_entitlement_feature_fk" FOREIGN KEY ("feature_id") REFERENCES "${PAYKIT_SCHEMA}"."feature"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_invoice_customer_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."invoice" ADD CONSTRAINT "paykit_invoice_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "${PAYKIT_SCHEMA}"."customer"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_invoice_subscription_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."invoice" ADD CONSTRAINT "paykit_invoice_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "${PAYKIT_SCHEMA}"."subscription"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_payment_method_customer_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."payment_method" ADD CONSTRAINT "paykit_payment_method_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "${PAYKIT_SCHEMA}"."customer"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_product_feature_product_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."product_feature" ADD CONSTRAINT "paykit_product_feature_product_fk" FOREIGN KEY ("product_internal_id") REFERENCES "${PAYKIT_SCHEMA}"."product"("internal_id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_product_feature_feature_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."product_feature" ADD CONSTRAINT "paykit_product_feature_feature_fk" FOREIGN KEY ("feature_id") REFERENCES "${PAYKIT_SCHEMA}"."feature"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_subscription_customer_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."subscription" ADD CONSTRAINT "paykit_subscription_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "${PAYKIT_SCHEMA}"."customer"("id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paykit_subscription_product_fk') THEN
      ALTER TABLE "${PAYKIT_SCHEMA}"."subscription" ADD CONSTRAINT "paykit_subscription_product_fk" FOREIGN KEY ("product_internal_id") REFERENCES "${PAYKIT_SCHEMA}"."product"("internal_id") ON DELETE no action ON UPDATE no action;
    END IF;
  END $$`,
  // ── indexes ──────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS "paykit_customer_deleted_at_idx" ON "${PAYKIT_SCHEMA}"."customer" USING btree ("deleted_at")`,
  `CREATE INDEX IF NOT EXISTS "paykit_customer_stripe_customer_idx" ON "${PAYKIT_SCHEMA}"."customer" USING btree ("stripe_customer_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_entitlement_subscription_idx" ON "${PAYKIT_SCHEMA}"."entitlement" USING btree ("subscription_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_entitlement_customer_feature_idx" ON "${PAYKIT_SCHEMA}"."entitlement" USING btree ("customer_id","feature_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_entitlement_next_reset_idx" ON "${PAYKIT_SCHEMA}"."entitlement" USING btree ("next_reset_at")`,
  `CREATE INDEX IF NOT EXISTS "paykit_invoice_customer_idx" ON "${PAYKIT_SCHEMA}"."invoice" USING btree ("customer_id","created_at")`,
  `CREATE INDEX IF NOT EXISTS "paykit_invoice_subscription_idx" ON "${PAYKIT_SCHEMA}"."invoice" USING btree ("subscription_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_invoice_stripe_invoice_idx" ON "${PAYKIT_SCHEMA}"."invoice" USING btree ("stripe_invoice_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_payment_method_customer_idx" ON "${PAYKIT_SCHEMA}"."payment_method" USING btree ("customer_id","deleted_at")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "paykit_product_id_version_unique" ON "${PAYKIT_SCHEMA}"."product" USING btree ("id","version")`,
  `CREATE INDEX IF NOT EXISTS "paykit_product_default_idx" ON "${PAYKIT_SCHEMA}"."product" USING btree ("is_default")`,
  `CREATE INDEX IF NOT EXISTS "paykit_product_stripe_product_idx" ON "${PAYKIT_SCHEMA}"."product" USING btree ("stripe_product_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_product_stripe_price_idx" ON "${PAYKIT_SCHEMA}"."product" USING btree ("stripe_price_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_product_feature_feature_idx" ON "${PAYKIT_SCHEMA}"."product_feature" USING btree ("feature_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_subscription_customer_status_idx" ON "${PAYKIT_SCHEMA}"."subscription" USING btree ("customer_id","status","ended_at")`,
  `CREATE INDEX IF NOT EXISTS "paykit_subscription_product_idx" ON "${PAYKIT_SCHEMA}"."subscription" USING btree ("product_internal_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_subscription_stripe_subscription_idx" ON "${PAYKIT_SCHEMA}"."subscription" USING btree ("stripe_subscription_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "paykit_metadata_stripe_checkout_session_unique" ON "${PAYKIT_SCHEMA}"."metadata" USING btree ("stripe_checkout_session_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "paykit_webhook_event_stripe_event_id_unique" ON "${PAYKIT_SCHEMA}"."webhook_event" USING btree ("stripe_event_id")`,
  `CREATE INDEX IF NOT EXISTS "paykit_webhook_event_stripe_status_idx" ON "${PAYKIT_SCHEMA}"."webhook_event" USING btree ("status")`,
];

/**
 * Phase split for the setup runner: the first statements create the schema
 * + grants, the rest create tables, keys and indexes. Push-schema can run
 * one phase at a time so the UI shows truthful per-step progress.
 */
export const PAYKIT_SCHEMA_SETUP_COUNT = 4;

export type PaykitSchemaPhase = "schema" | "tables" | "all";

export function getPaykitSchemaStatements(phase: PaykitSchemaPhase): string[] {
  if (phase === "schema") return PAYKIT_SCHEMA_STATEMENTS.slice(0, PAYKIT_SCHEMA_SETUP_COUNT);
  if (phase === "tables") return PAYKIT_SCHEMA_STATEMENTS.slice(PAYKIT_SCHEMA_SETUP_COUNT);
  return PAYKIT_SCHEMA_STATEMENTS;
}

/** Single query used by the status check: one row per paykit table. */
export function buildPaykitTablesPresenceQuery(): string {
  const tables = PAYKIT_TABLE_NAMES.map((t) => `'${t}'`).join(", ");
  return `SELECT tablename AS table_name FROM pg_tables WHERE schemaname = '${PAYKIT_SCHEMA}' AND tablename IN (${tables})`;
}

/** RLS state per paykit table (best-effort status check, not setup). */
export function buildPaykitRlsStatusQuery(): string {
  const tables = PAYKIT_TABLE_NAMES.map((t) => `'${t}'`).join(", ");
  return `SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = '${PAYKIT_SCHEMA}' AND c.relkind = 'r' AND c.relname IN (${tables})`;
}

/** service_role privileges per paykit table (gap detection for repair). */
export function buildPaykitGrantsStatusQuery(): string {
  const tables = PAYKIT_TABLE_NAMES.map((t) => `'${t}'`).join(", ");
  return `SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = '${PAYKIT_SCHEMA}' AND grantee = 'service_role' AND table_name IN (${tables})`;
}

/** Privileges service_role must hold on every paykit table. */
export const PAYKIT_REQUIRED_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;

/**
 * Merge a schema into a PostgREST `db_schema` list (comma-separated).
 * Returns the merged list, or null when already present.
 */
export function mergeExposedSchemas(
  current: string | null | undefined,
  schema = PAYKIT_SCHEMA,
): string | null {
  const parts = String(current ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.includes(schema)) return null;
  return [...parts, schema].join(",");
}
