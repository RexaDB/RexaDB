import { runQuery } from "@/lib/api/actions-client";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { buildAuthProviderParams } from "@/lib/studio/auth/params";

export async function insertAuthProviderConfig(
  connectionString: string,
  payload: AuthProviderConfig,
  now: string
) {
  const query = `
    INSERT INTO auth.custom_oauth_providers (
      id, identifier, name, provider_type, enabled, client_id, client_secret, scopes,
      acceptable_client_ids, attribute_mapping, authorization_params, authorization_url,
      discovery_url, email_optional, issuer, jwks_uri, pkce_enabled, skip_nonce_check,
      token_url, userinfo_url, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
    ) RETURNING *;
  `;
  const params = [
    payload.id,
    ...buildAuthProviderParams(payload),
    now,
    now,
  ];
  const res = await runQuery(connectionString, query, params);
  if (!res.success) throw new Error(res.error || "Failed to create auth provider.");
  return (res.data?.rows?.[0] ?? payload) as AuthProviderConfig;
}
