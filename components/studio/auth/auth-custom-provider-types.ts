export type ProviderProtocol = "oidc" | "oauth2";

export interface CustomProviderFormState {
  id: string;
  identifier: string;
  name: string;
  enabled: boolean;
  protocol: ProviderProtocol;
  discovery_url: string;
  issuer: string;
  authorization_url: string;
  token_url: string;
  userinfo_url: string;
  jwks_uri: string;
  client_id: string;
  client_secret: string;
  scopes: string;
  email_optional: boolean;
}
