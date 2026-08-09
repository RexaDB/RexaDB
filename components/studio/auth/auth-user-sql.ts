function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildIdentityInsert(email: string): string {
  const escaped = escapeSqlString(email);
  return `
  INSERT INTO auth.identities
    (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES
    (gen_random_uuid(), v_id, v_id::text, jsonb_build_object('sub', v_id::text, 'email', '${escaped}'), 'email', now(), now(), now());`;
}

export function buildCreateUserSql(
  email: string,
  password: string,
  confirm: boolean,
): string {
  const escapedEmail = escapeSqlString(email);
  const escapedPassword = escapeSqlString(password);
  const confirmedAt = confirm ? "now()" : "NULL";
  return `
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, "role", email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', '${escapedEmail}', extensions.crypt('${escapedPassword}', extensions.gen_salt('bf')), ${confirmedAt}, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
${buildIdentityInsert(email)}
END $$;`;
}

export function buildInviteUserSql(email: string): string {
  const escaped = escapeSqlString(email);
  return `
DO $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users
    (instance_id, id, aud, "role", email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', '${escaped}', NULL, NULL, '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());
${buildIdentityInsert(email)}
END $$;`;
}
