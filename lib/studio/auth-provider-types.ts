export interface AuthProviderConfig {
  id: string;
  identifier: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  client_id: string;
  client_secret: string;
  scopes: string[];
  acceptable_client_ids: string[];
  attribute_mapping: any;
  authorization_params: any;
  authorization_url: string | null;
  discovery_url: string | null;
  email_optional: boolean;
  issuer: string | null;
  jwks_uri: string | null;
  pkce_enabled: boolean;
  skip_nonce_check: boolean;
  token_url: string | null;
  userinfo_url: string | null;
  created_at?: string;
  updated_at?: string;
}
