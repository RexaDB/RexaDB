import { runQuery } from "@/lib/api/actions-client";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import { buildAuthProviderParams } from "@/lib/studio/auth/params";

export async function updateAuthProviderConfig(
  connectionString: string,
  payload: AuthProviderConfig,
  now: string
) {
  const query = `
    UPDATE auth.custom_oauth_providers
    SET identifier = $1,
        name = $2,
        provider_type = $3,
        enabled = $4,
        client_id = $5,
        client_secret = $6,
        scopes = $7,
        acceptable_client_ids = $8,
        attribute_mapping = $9,
        authorization_params = $10,
        authorization_url = $11,
        discovery_url = $12,
        email_optional = $13,
        issuer = $14,
        jwks_uri = $15,
        pkce_enabled = $16,
        skip_nonce_check = $17,
        token_url = $18,
        userinfo_url = $19,
        updated_at = $20
    WHERE id = $21
    RETURNING *;
  `;
  const params = [
    ...buildAuthProviderParams(payload),
    now,
    payload.id,
  ];
  const res = await runQuery(connectionString, query, params);
  if (!res.success) throw new Error(res.error || "Failed to update auth provider.");
  return (res.data?.rows?.[0] ?? payload) as AuthProviderConfig;
}
