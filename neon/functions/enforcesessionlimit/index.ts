import { makePool } from "../_shared/auth";
import { json } from "../_shared/cors";

const pool = makePool();

const log = (step: string, data?: unknown) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), step, data }));
};

function safeEqual(a: string | null, b: string | null): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Revoke oldest sessions beyond the limit for one user. Returns revoked ids. */
async function enforceForUser(userId: string, maxSessions: number): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM neon_auth.session
     WHERE "userId" = $1 AND "expiresAt" > now()
     ORDER BY "createdAt" DESC`,
    [userId],
  );
  if (rows.length <= maxSessions) return [];
  const toDelete = rows.slice(maxSessions).map((r) => r.id);
  await pool.query(`DELETE FROM neon_auth.session WHERE id = ANY($1::uuid[])`, [
    toDelete,
  ]);
  return toDelete;
}

export default {
  async fetch(req: Request): Promise<Response> {
    // Shared secret (cron trigger or legacy webhook forwarder). Anyone with
    // the URL but without the secret can enumerate nothing.
    const secret = process.env.CRON_SECRET || "";
    const authz = req.headers.get("Authorization") ?? "";
    const provided = authz.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!secret || !safeEqual(provided, secret)) {
      return json({ error: "Invalid token." }, 401);
    }

    const maxSessions = Number(process.env.MAX_SESSIONS ?? 2) || 2;

    let payload: unknown = null;
    try {
      payload = await req.json();
    } catch {
      payload = null;
    }
    const event = (payload ?? {}) as {
      type?: string;
      record?: { user_id?: string };
      user_id?: string;
      sweep?: boolean;
    };

    try {
      // Single-user mode: legacy Supabase webhook shape {type, record} or
      // direct {user_id}. Anything else triggers a full sweep.
      const userId = event.record?.user_id ?? event.user_id ?? null;
      if (event.type !== undefined && event.type !== "INSERT") {
        return json({ ok: true, skipped: true });
      }

      if (userId) {
        const revoked = await enforceForUser(userId, maxSessions);
        log("sessions:limit_enforced", {
          user_id: userId,
          max: maxSessions,
          revoked: revoked.length,
        });
        return json({ ok: true, user_id: userId, revoked: revoked.length });
      }

      // Full sweep (cron): enforce for every user over the limit.
      const { rows } = await pool.query<{ userId: string; active: string }>(
        `SELECT "userId" AS "userId", count(*) AS active
         FROM neon_auth.session WHERE "expiresAt" > now()
         GROUP BY "userId" HAVING count(*) > $1`,
        [maxSessions],
      );
      let checked = 0;
      let revoked = 0;
      for (const row of rows) {
        checked++;
        revoked += (await enforceForUser(row.userId, maxSessions)).length;
      }
      log("sessions:sweep", { checked, revoked, max: maxSessions });
      return json({ ok: true, checked, revoked });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("sessions:error", { message });
      return json({ ok: false, error: message }, 500);
    }
  },
};
