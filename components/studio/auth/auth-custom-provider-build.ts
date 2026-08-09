import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";
import type { CustomProviderFormState } from "./auth-custom-provider-types";
import { arrayToCsv, generateUuid } from "./auth-custom-provider-form-helpers";

export function buildCustomProviderForm(config: AuthProviderConfig | null): CustomProviderFormState {
  if (!config) {
    return {
      id: generateUuid(),
      identifier: "",
      name: "",
      enabled: true,
      protocol: "oidc",
      discovery_url: "",
      issuer: "",
      authorization_url: "",
      token_url: "",
      userinfo_url: "",
      jwks_uri: "",
      client_id: "",
      client_secret: "",
      scopes: "",
      email_optional: false,
    };
  }
  return {
    id: config.id,
    identifier: (config.identifier ?? "").replace(/^custom:/i, ""),
    name: config.name ?? "",
    enabled: config.enabled,
    protocol: config.provider_type === "oauth2" ? "oauth2" : "oidc",
    discovery_url: config.discovery_url ?? "",
    issuer: config.issuer ?? "",
    authorization_url: config.authorization_url ?? "",
    token_url: config.token_url ?? "",
    userinfo_url: config.userinfo_url ?? "",
    jwks_uri: config.jwks_uri ?? "",
    client_id: config.client_id ?? "",
    client_secret: config.client_secret ? "placeholder" : "",
    scopes: arrayToCsv(config.scopes),
    email_optional: config.email_optional,
  };
}
