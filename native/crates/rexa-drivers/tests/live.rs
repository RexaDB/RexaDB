//! Live driver checks. Run with e.g.
//! `REXA_TEST_PG=postgres://localhost/postgres REXA_TEST_MYSQL=mysql://root@localhost/mysql cargo test -p rexa-drivers --test live`
use rexa_drivers::{connect, Cell, Kind};

async fn smoke(kind: Kind, var: &str, select: &str) {
    let Ok(cs) = std::env::var(var) else {
        eprintln!("skipping: {var} not set");
        return;
    };
    let d = connect(kind, &cs).await.unwrap();
    let r = d.execute(select, 100).await.unwrap();
    assert_eq!(r.columns, vec!["n", "s", "z"]);
    assert_eq!(r.rows, vec![vec![Cell::Text("1".into()), Cell::Text("hi".into()), Cell::Null]]);
    let schemas = d.schemas().await.unwrap();
    assert!(!schemas.is_empty());
    let tables = d.tables(&schemas[0]).await.unwrap();
    if let Some(t) = tables.first() {
        d.columns(t).await.unwrap();
        d.execute(&d.select_preview_sql(t, 5), 5).await.unwrap();
    }
    assert!(d.execute("SELECT nope FROM", 1).await.is_err());
}

#[tokio::test]
async fn postgres() {
    smoke(Kind::Postgres, "REXA_TEST_PG", "SELECT 1 AS n, 'hi' AS s, NULL AS z").await;
}

#[tokio::test]
async fn mysql() {
    smoke(Kind::MySql, "REXA_TEST_MYSQL", "SELECT 1 AS n, 'hi' AS s, NULL AS z").await;
}
