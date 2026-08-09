import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import type { CustomProviderFormState } from "./auth-custom-provider-types";
import { csvToArray } from "./auth-custom-provider-form-helpers";
import { buildOAuth2Endpoints, resolveDiscoveryUrl, validateRequiredFields } from "./auth-custom-provider-parse-helpers";

export type CustomProviderParseResult =
  | { ok: true; value: AuthProviderConfig }
  | { ok: false; error: string };

export function parseCustomProviderForm(state: CustomProviderFormState): CustomProviderParseResult {
  const required = validateRequiredFields(state);
  if (!required.ok) return required;
  const discoveryUrl = resolveDiscoveryUrl(state, required.value.issuer);
  const oauth2Endpoints = state.protocol === "oauth2"
    ? buildOAuth2Endpoints(required.value.issuer, state)
    : null;
  const scopes = csvToArray(state.scopes);

  return {
    ok: true,
    value: {
      id: state.id,
      identifier: required.value.identifier,
      name: required.value.name,
      provider_type: state.protocol,
      enabled: state.enabled,
      client_id: required.value.clientId,
      client_secret: required.value.clientSecret,
      scopes,
      acceptable_client_ids: [required.value.clientId],
      attribute_mapping: {},
      authorization_params: {},
      authorization_url: oauth2Endpoints ? oauth2Endpoints.authorizationUrl : null,
      discovery_url: state.protocol === "oidc" ? discoveryUrl.value || null : null,
      email_optional: state.email_optional,
      issuer: required.value.issuer,
      jwks_uri: oauth2Endpoints ? oauth2Endpoints.jwksUri : null,
      pkce_enabled: true,
      skip_nonce_check: false,
      token_url: oauth2Endpoints ? oauth2Endpoints.tokenUrl : null,
      userinfo_url: oauth2Endpoints ? oauth2Endpoints.userinfoUrl : null,
    },
  };
}
