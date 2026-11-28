//! Opt-in checks of the provider write paths against a local stand-in
//! Postgres (never a real Supabase project). Run with
//! `REXA_PROVIDERS_TEST_DB=postgres://…/rexa_providers_test cargo test -p rexa-providers -- --ignored`.
//! The database must have the `storage`/`auth`/`paykit` stand-in schemas.

use crate::common::Grid;
use rexa_drivers::Driver;
use std::sync::Arc;

async fn driver() -> Option<Arc<dyn Driver>> {
    let url = std::env::var("REXA_PROVIDERS_TEST_DB").ok()?;
    assert!(url.contains("localhost") || url.contains("127.0.0.1"), "stand-in tests only run against a local database");
    Some(rexa_drivers::connect_detect("postgres", &url).await.expect("connect"))
}

async fn q(d: &Arc<dyn Driver>, sql: &str) -> Grid {
    Grid::from_result(d.execute(sql, 1000).await.unwrap_or_else(|e| panic!("{e:#}\n{sql}")))
}

#[tokio::test]
#[ignore]
async fn storage_write_paths() {
    let Some(d) = driver().await else { return };
    q(&d, "DELETE FROM storage.objects WHERE bucket_id = 'zz-test'").await;
    q(&d, "DELETE FROM storage.buckets WHERE id = 'zz-test'").await;
    q(&d, &crate::storage::build_create_bucket_sql("zz-test", false)).await;
    let b = crate::storage::fetch_buckets(d.clone()).await.unwrap();
    assert!(b.iter().any(|b| b.name == "zz-test" && !b.public));
    q(&d, "INSERT INTO storage.objects (bucket_id, name) VALUES ('zz-test', 'team/a.txt'), ('zz-test', 'team/sub/b.txt')").await;
    // Rename folder team → crew (the original's substring offset).
    let target = "team";
    let sql = format!("UPDATE storage.objects SET name = 'crew/' || substring(name from {}), updated_at = now() WHERE bucket_id = 'zz-test' AND (name = 'team' OR name LIKE 'team/%' ESCAPE '\\')", target.len() + 2);
    q(&d, &sql).await;
    let g = q(&d, "SELECT name FROM storage.objects WHERE bucket_id = 'zz-test' ORDER BY name").await;
    assert_eq!(g.rows.iter().map(|r| r[0].clone()).collect::<Vec<_>>(), vec!["crew/a.txt", "crew/sub/b.txt"]);
    q(&d, "DELETE FROM storage.objects WHERE bucket_id = 'zz-test'").await;
    q(&d, "DELETE FROM storage.buckets WHERE id = 'zz-test'").await;
}

#[tokio::test]
#[ignore]
async fn auth_write_paths() {
    let Some(d) = driver().await else { return };
    q(&d, "DELETE FROM auth.users WHERE email IN ('zz-new@example.com', 'zz-inv@example.com')").await;
    q(&d, &crate::auth::build_create_user_sql("zz-new@example.com", "s3cr'et", true)).await;
    q(&d, &crate::auth::build_invite_user_sql("zz-inv@example.com")).await;
    let g = q(&d, &crate::auth::users_query(false)).await;
    let users: Vec<_> = g.rows.iter().map(|r| crate::auth::map_user(&g, r)).collect();
    let new = users.iter().find(|u| u.email.as_deref() == Some("zz-new@example.com")).expect("created");
    assert!(new.confirmed);
    let inv = users.iter().find(|u| u.email.as_deref() == Some("zz-inv@example.com")).expect("invited");
    assert!(!inv.confirmed);
    q(&d, "DELETE FROM auth.users WHERE email IN ('zz-new@example.com', 'zz-inv@example.com')").await;

    let mut v = std::collections::HashMap::new();
    for (k, val) in [("identifier", "zz"), ("name", "ZZ"), ("issuer", "https://id.zz"), ("client_id", "c"), ("client_secret", "s")] {
        v.insert(k, val.to_string());
    }
    let c = crate::auth::parse_provider_form(&v, "33333333-3333-4333-8333-333333333333", false, true, "openid", false).unwrap();
    q(&d, "DELETE FROM auth.custom_oauth_providers WHERE identifier = 'custom:zz'").await;
    q(&d, &crate::auth::build_save_provider_sql(&c, false, "2026-01-01T00:00:00Z")).await;
    q(&d, &crate::auth::build_save_provider_sql(&crate::auth::ProviderConfig { name: "ZZ2".into(), ..c.clone() }, true, "2026-01-02T00:00:00Z")).await;
    let g = q(&d, "SELECT name FROM auth.custom_oauth_providers WHERE identifier = 'custom:zz'").await;
    assert_eq!(g.rows[0][0], "ZZ2");
    q(&d, "DELETE FROM auth.custom_oauth_providers WHERE identifier = 'custom:zz'").await;
}
