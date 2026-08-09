import type { CustomProviderFormState } from "./auth-custom-provider-types";
export function validateRequiredFields(state: CustomProviderFormState) {
  const rawIdentifier = state.identifier.trim().replace(/^custom:/i, "");
  const identifier = rawIdentifier ? `custom:${rawIdentifier}` : "";
  const name = state.name.trim();
  const issuer = state.issuer.trim();
  const clientId = state.client_id.trim();
  const clientSecret = state.client_secret.trim();
  if (!identifier) return { ok: false, error: "Project identifier is required." } as const;
  if (!name) return { ok: false, error: "Display name is required." } as const;
  if (!issuer) return { ok: false, error: "Issuer URL is required." } as const;
  if (!clientId) return { ok: false, error: "Client ID is required." } as const;
  if (!clientSecret) return { ok: false, error: "Client secret is required." } as const;
  return { ok: true, value: { identifier, name, issuer, clientId, clientSecret } } as const;
}

export function resolveDiscoveryUrl(state: CustomProviderFormState, issuer: string) {
  const provided = state.discovery_url.trim();
  if (provided) return { ok: true, value: provided } as const;
  const base = issuer.replace(/\/$/, "");
  if (state.protocol === "oauth2") {
    return { ok: true, value: `${base}/.well-known/oauth-authorization-server` } as const;
  }
  return { ok: true, value: `${base}/.well-known/openid-configuration` } as const;
}

export function buildOAuth2Endpoints(issuer: string, state: CustomProviderFormState) {
  const base = issuer.replace(/\/$/, "");
  const authorizationUrl = state.authorization_url.trim();
  const tokenUrl = state.token_url.trim();
  const userinfoUrl = state.userinfo_url.trim();
  const jwksUri = state.jwks_uri.trim();
  return {
    authorizationUrl: authorizationUrl || `${base}/oauth/authorize`,
    tokenUrl: tokenUrl || `${base}/oauth/token`,
    userinfoUrl: userinfoUrl || `${base}/oauth/userinfo`,
    jwksUri: jwksUri || `${base}/.well-known/jwks.json`,
  };
}
