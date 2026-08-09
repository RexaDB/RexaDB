import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";

export function buildAuthProviderParams(payload: AuthProviderConfig) {
  return [
    payload.identifier,
    payload.name,
    payload.provider_type,
    payload.enabled,
    payload.client_id,
    payload.client_secret,
    payload.scopes,
    payload.acceptable_client_ids,
    payload.attribute_mapping,
    payload.authorization_params,
    payload.authorization_url,
    payload.discovery_url,
    payload.email_optional,
    payload.issuer,
    payload.jwks_uri,
    payload.pkce_enabled,
    payload.skip_nonce_check,
    payload.token_url,
    payload.userinfo_url,
  ];
}
