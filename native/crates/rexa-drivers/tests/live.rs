//! Live driver checks.
//!
//! Postgres runs against `REXA_TEST_PG` (default
//! `postgres://$USER@localhost/rexa_drivers_test`; create it with
//! `createdb rexa_drivers_test`) and is skipped when unreachable. The test
//! only touches its own `rexa_live_*` schema. MySQL runs when
//! `REXA_TEST_MYSQL` is set.
use rexa_drivers::*;
use std::sync::Arc;

async fn pg() -> Option<Arc<dyn Driver>> {
    let cs = std::env::var("REXA_TEST_PG")
        .unwrap_or_else(|_| format!("postgres://{}@localhost/rexa_drivers_test", std::env::var("USER").unwrap_or_default()));
    match connect(Kind::Postgres, &cs).await {
        Ok(d) => Some(d),
        Err(e) => {
            eprintln!("skipping Postgres live test: {e:#}");
            None
        }
    }
}

async fn smoke(d: &dyn Driver, select: &str) {
    let r = d.execute(select, 100).await.unwrap();
    assert_eq!(r.columns, vec!["n", "s", "z"]);
    assert_eq!(r.rows, vec![vec![Cell::Text("1".into()), Cell::Text("hi".into()), Cell::Null]]);
    let schemas = d.schemas().await.unwrap();
    assert!(!schemas.is_empty());
    assert!(d.execute("SELECT nope FROM", 1).await.is_err());
}

#[tokio::test]
async fn postgres() {
    let Some(d) = pg().await else { return };
    smoke(&*d, "SELECT 1 AS n, 'hi' AS s, NULL AS z").await;
    let s = "rexa_live_pg";
    d.execute(&format!("DROP SCHEMA IF EXISTS {s} CASCADE"), 1).await.unwrap();
    d.execute(
        &format!(
            "CREATE SCHEMA {s};
             CREATE TYPE {s}.mood AS ENUM ('ok', 'sad');
             CREATE TABLE {s}.parent (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name varchar(40) UNIQUE NOT NULL, m {s}.mood DEFAULT 'ok', tags text[], meta jsonb, at timestamptz DEFAULT now());
             COMMENT ON COLUMN {s}.parent.name IS 'the name';
             CREATE TABLE {s}.child (a int, b int, parent_id int REFERENCES {s}.parent(id) ON DELETE CASCADE, v numeric(10,2), PRIMARY KEY (a, b));
             CREATE INDEX child_parent ON {s}.child (parent_id);
             CREATE VIEW {s}.v AS SELECT * FROM {s}.parent;
             CREATE MATERIALIZED VIEW {s}.mv AS SELECT count(*) FROM {s}.parent;
             CREATE SEQUENCE {s}.seq START 5;
             CREATE FUNCTION {s}.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
             CREATE TRIGGER tr BEFORE INSERT OR UPDATE ON {s}.child FOR EACH ROW EXECUTE FUNCTION {s}.touch();
             ALTER TABLE {s}.parent ENABLE ROW LEVEL SECURITY;
             CREATE POLICY p_all ON {s}.parent FOR SELECT USING (true);"
        ),
        1,
    )
    .await
    .unwrap();
    let parent = TableRef::new(s, "parent");
    let child = TableRef::new(s, "child");

    // catalog
    let tables = d.tables(s).await.unwrap();
    let names: Vec<_> = tables.iter().map(|t| (t.name.as_str(), t.is_view)).collect();
    assert_eq!(names, vec![("child", false), ("mv", true), ("parent", false), ("v", true)]);
    let infos = d.table_infos(s).await.unwrap();
    let pinfo = infos.iter().find(|t| t.name == "parent").unwrap();
    assert!(pinfo.total_bytes.unwrap() > 0 && pinfo.rls_enabled == Some(true));
    assert_eq!(infos.iter().find(|t| t.name == "mv").unwrap().kind, TableKind::MaterializedView);
    let st = d.table_structure(&parent).await.unwrap();
    let id = &st[0];
    assert!(id.is_primary_key && id.is_identity && id.identity_generation.as_deref() == Some("ALWAYS"));
    let name = &st[1];
    assert_eq!((name.data_type.as_str(), name.full_type.as_str()), ("character varying", "character varying(40)"));
    assert!(name.is_unique && !name.is_nullable && name.comment.as_deref() == Some("the name"));
    assert!(st[2].is_enum && st[2].udt_name.as_deref() == Some("mood"));
    assert_eq!(d.primary_key(&child).await.unwrap(), vec!["a", "b"]);
    let fks = d.foreign_keys(&child).await.unwrap();
    assert_eq!((fks[0].foreign_table_name.as_str(), fks[0].on_delete.as_deref()), ("parent", Some("CASCADE")));
    assert!(d.indexes(Some(s)).await.unwrap().iter().any(|i| i.name == "child_parent" && i.columns == vec!["parent_id"]));
    assert!(d.constraints(&child).await.unwrap().iter().any(|c| c.constraint_type == ConstraintType::PrimaryKey && c.columns == vec!["a", "b"]));
    let enums = d.enums().await.unwrap();
    assert!(enums.iter().any(|e| e.schema == s && e.values == vec!["ok", "sad"]));
    let fns = d.functions(s).await.unwrap();
    assert_eq!(fns[0].name, "touch");
    assert!(fns[0].definition.as_deref().unwrap().contains("RETURN NEW"));
    let trg = d.triggers(Some(s)).await.unwrap();
    assert_eq!(trg.len(), 1);
    assert_eq!(trg[0].events, vec!["INSERT", "UPDATE"]);
    assert_eq!(trg[0].function_name, format!("{s}.touch"));
    assert!(trg[0].full_definition.is_some());
    assert_eq!(d.sequences(s).await.unwrap().iter().find(|q| q.name == "seq").unwrap().start_value.as_deref(), Some("5"));
    assert!(!d.extensions().await.unwrap().is_empty());
    assert_eq!(d.rls_policies(Some(s), None).await.unwrap()[0].name, "p_all");
    assert_eq!(d.table_security(s).await.unwrap().iter().find(|t| t.table_name == "parent").unwrap().policy_count, 1);
    assert!(!d.roles().await.unwrap().is_empty());
    assert_eq!(d.materialized_views(s).await.unwrap()[0].name, "mv");
    assert!(d.views(s).await.unwrap().contains(&"v".to_string()));
    let all = d.all_tables_with_columns(Some(s)).await.unwrap();
    let fk_col = all.iter().find(|c| c.table_name == "child" && c.column_name == "parent_id").unwrap();
    assert_eq!(fk_col.referenced_table_name.as_deref(), Some("parent"));
    assert!(d.databases().await.unwrap().contains(&"rexa_drivers_test".to_string()) || std::env::var("REXA_TEST_PG").is_ok());
    d.sessions().await.unwrap();

    // grid round trip
    assert_eq!(
        d.insert_rows(&parent, &[vec![("name".into(), "a'b".into())], vec![("name".into(), "c".into()), ("tags".into(), "{x,y}".into())]]).await.unwrap(),
        2
    );
    let q = TableQuery {
        table: parent.clone(),
        filter: TableFilter { rules: vec![FilterRule::new("name", FilterOperator::Contains, "'")], raw_where: None },
        sort: Some(SortConfig { column: "id".into(), direction: SortDirection::Desc }),
        limit: 10,
        with_count: true,
        ..Default::default()
    };
    let page = d.read_table(&q).await.unwrap();
    assert_eq!(page.total_count, Some(1));
    let r = &page.result;
    assert_eq!(r.rows[0][1], Cell::Text("a'b".into()));
    assert_eq!(r.column_type(0).type_name, "int4");
    assert_eq!(r.column_type(0).category, TypeCategory::Integer);
    assert_eq!(r.column_type(3).category, TypeCategory::Array);
    assert_eq!(r.column_type(5).category, TypeCategory::Timestamp);
    d.update_rows(&parent, &[RowUpdate { r#where: vec![("id".into(), Value::Int(2))], set: vec![("meta".into(), Value::Json(serde_json::json!({"k": 1})))] }])
        .await
        .unwrap();
    assert_eq!(d.execute(&format!("SELECT meta->>'k' FROM {s}.parent WHERE id = 2"), 1).await.unwrap().rows[0][0], Cell::Text("1".into()));
    d.insert_rows(&child, &[vec![("a".into(), Value::Int(1)), ("b".into(), Value::Int(1)), ("parent_id".into(), Value::Int(1))]]).await.unwrap();
    d.insert_rows(&child, &[vec![("a".into(), Value::Int(1)), ("b".into(), Value::Int(2)), ("parent_id".into(), Value::Int(1))]]).await.unwrap();
    // composite key: deletes only the targeted row
    assert_eq!(d.delete_rows(&child, &[vec![("a".into(), Value::Int(1)), ("b".into(), Value::Int(2))]]).await.unwrap(), 1);
    assert_eq!(d.count_rows(&child, &TableFilter::default()).await.unwrap(), 1);
    let rec = d.referenced_record(&parent, &vec![("id".into(), Value::Int(1))]).await.unwrap().unwrap();
    assert_eq!(rec.get("name"), Some("a'b"));
    // failed transaction leaves nothing behind and the pool stays usable
    assert!(d.transaction(&[format!("DELETE FROM {s}.child"), "SELECT nope".into()]).await.is_err());
    assert_eq!(d.count_rows(&child, &TableFilter::default()).await.unwrap(), 1);

    // scripts, params, explain
    let script = d.execute_script(&format!("SELECT 1; SELECT count(*) FROM {s}.parent; SELECT nope; SELECT 4"), 10).await.unwrap();
    assert_eq!(script.results.len(), 2);
    assert_eq!(script.results[1].rows[0][0], Cell::Text("2".into()));
    assert_eq!(script.error.as_ref().unwrap().statement_index, 2);
    let p = d.execute_params("SELECT $1::text || $2::text AS x", &["a".into(), Value::Int(3)], 1).await.unwrap();
    assert_eq!(p.rows[0][0], Cell::Text("a3".into()));
    let ex = d.explain(&format!("SELECT * FROM {s}.parent"), true).await.unwrap();
    assert!(ex.plan_query.starts_with("EXPLAIN (ANALYZE"));
    assert!(ex.result.rows[0][0].display().contains("Plan"));
    let ex = d.explain(&format!("SELECT * FROM {s}.parent"), false).await.unwrap();
    assert!(!ex.plan_query.contains("ANALYZE"));

    // cancellation
    let d2 = d.clone();
    let long = tokio::spawn(async move { d2.execute_cancellable("SELECT pg_sleep(30)", 1, "q1").await });
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    assert!(d.cancel_query("q1").await.unwrap());
    let err = long.await.unwrap().unwrap_err().to_string();
    assert!(err.contains("cancel"), "{err}");
    assert!(!d.cancel_query("q1").await.unwrap());

    // concurrent catalog reads while a query runs
    let (a, b) = tokio::join!(d.execute("SELECT pg_sleep(0.3)", 1), d.schemas());
    a.unwrap();
    assert!(b.unwrap().contains(&s.to_string()));

    d.execute(&format!("DROP SCHEMA {s} CASCADE"), 1).await.unwrap();
}

#[tokio::test]
async fn postgres_read_only_and_timeout() {
    let Ok(cs) = std::env::var("REXA_TEST_PG")
        .or_else(|_| Ok::<_, ()>(format!("postgres://{}@localhost/rexa_drivers_test", std::env::var("USER").unwrap_or_default())))
    else {
        return;
    };
    let opts = ConnectOptions { read_only: true, statement_timeout: Some(std::time::Duration::from_millis(200)) };
    let Ok(d) = connect_with(Kind::Postgres, &cs, &opts).await else { return };
    assert!(d.execute("CREATE TABLE rexa_live_ro (a int)", 1).await.unwrap_err().to_string().contains("read-only"));
    assert!(d.execute("SELECT pg_sleep(2)", 1).await.unwrap_err().to_string().contains("timeout"));
}

#[tokio::test]
async fn detect_and_test_connection() {
    let Some(_) = pg().await else { return };
    let cs = std::env::var("REXA_TEST_PG")
        .unwrap_or_else(|_| format!("postgres://{}@localhost/rexa_drivers_test", std::env::var("USER").unwrap_or_default()));
    test_connection("postgres", &cs).await.unwrap();
    test_connection("", &cs).await.unwrap();
    assert!(test_connection("", "dev://local").await.is_err());
}

#[tokio::test]
async fn mysql() {
    let Ok(cs) = std::env::var("REXA_TEST_MYSQL") else {
        eprintln!("skipping: REXA_TEST_MYSQL not set");
        return;
    };
    let d = connect(Kind::MySql, &cs).await.unwrap();
    smoke(&*d, "SELECT 1 AS n, 'hi' AS s, NULL AS z").await;
}

#[tokio::test]
async fn sqlite_file() {
    let dir = std::env::temp_dir().join(format!("rexa-drivers-live-{}", std::process::id()));
    let path = dir.join("t.db");
    let d = connect_detect("", path.to_str().unwrap()).await.unwrap();
    assert_eq!(d.kind(), Kind::Sqlite);
    d.execute("CREATE TABLE t(id INTEGER PRIMARY KEY, x BLOB); INSERT INTO t(x) VALUES (X'0102')", 1).await.unwrap();
    assert_eq!(d.execute("SELECT x FROM t", 1).await.unwrap().rows[0][0], Cell::Text("0102".into()));
    assert_eq!(d.databases().await.unwrap(), vec!["t.db"]);
    drop(d);
    let ro = connect_with(Kind::Sqlite, path.to_str().unwrap(), &ConnectOptions { read_only: true, statement_timeout: None }).await.unwrap();
    assert!(ro.execute("INSERT INTO t(x) VALUES (1)", 1).await.is_err());
    let _ = std::fs::remove_dir_all(dir);
}

/// Embedded DuckDB (only with `--features duckdb`).
#[cfg(feature = "duckdb")]
#[tokio::test]
async fn duckdb_embedded() {
    let d = connect_detect("", "duckdb://:memory:").await.unwrap();
    assert_eq!(d.kind(), Kind::DuckDb);
    d.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, name VARCHAR, at TIMESTAMP, d DATE, x DECIMAL(10,2))", 1).await.unwrap();
    d.insert_rows(
        &TableRef::new("main", "t"),
        &[vec![("id".into(), Value::Int(1)), ("name".into(), "a".into()), ("at".into(), "2024-01-02 03:04:05".into()), ("d".into(), "2024-02-29".into()), ("x".into(), Value::Raw("1.50".into()))]],
    )
    .await
    .unwrap();
    let r = d.execute("SELECT * FROM t", 10).await.unwrap();
    assert_eq!(r.columns, vec!["id", "name", "at", "d", "x"]);
    assert_eq!(r.rows[0][2], Cell::Text("2024-01-02 03:04:05".into()));
    assert_eq!(r.rows[0][3], Cell::Text("2024-02-29".into()));
    assert_eq!(r.rows[0][4], Cell::Text("1.50".into()));
    assert!(d.schemas().await.unwrap().contains(&"main".to_string()));
    let t = TableRef::new("main", "t");
    assert_eq!(d.primary_key(&t).await.unwrap(), vec!["id"]);
    assert_eq!(d.table_structure(&t).await.unwrap().len(), 5);
    d.update_rows(&t, &[RowUpdate { r#where: vec![("id".into(), Value::Int(1))], set: vec![("name".into(), "b".into())] }]).await.unwrap();
    assert_eq!(d.delete_rows(&t, &[vec![("id".into(), Value::Int(1))]]).await.unwrap(), 1);
}

/// JDBC via the Java bridge: needs `REXADB_BRIDGE_JAR` and
/// `REXA_TEST_PG_JDBC_JAR` (a PostgreSQL JDBC driver jar); talks to the local
/// `rexa_drivers_test` database.
#[tokio::test]
async fn jdbc_bridge_postgres() {
    let (Ok(_), Ok(jar)) = (std::env::var("REXADB_BRIDGE_JAR"), std::env::var("REXA_TEST_PG_JDBC_JAR")) else {
        eprintln!("skipping: REXADB_BRIDGE_JAR / REXA_TEST_PG_JDBC_JAR not set");
        return;
    };
    let user = std::env::var("USER").unwrap_or_default();
    let mut u = url::Url::parse("jdbc://").unwrap();
    u.query_pairs_mut()
        .append_pair("jdbcUrl", "jdbc:postgresql://localhost:5432/rexa_drivers_test")
        .append_pair("driverClass", "org.postgresql.Driver")
        .append_pair("jarPaths", &jar)
        .append_pair("username", &user)
        .append_pair("password", "");
    let d = connect_detect("jdbc", u.as_str()).await.unwrap();
    d.execute("DROP TABLE IF EXISTS rexa_live_jdbc", 1).await.unwrap();
    d.execute("CREATE TABLE rexa_live_jdbc (id int PRIMARY KEY, name text)", 1).await.unwrap();
    d.execute("INSERT INTO rexa_live_jdbc VALUES (1, 'a'), (2, NULL)", 1).await.unwrap();
    let r = d.execute("SELECT id, name FROM rexa_live_jdbc ORDER BY id", 10).await.unwrap();
    assert_eq!(r.columns, vec!["id", "name"]);
    assert_eq!(r.rows[1], vec![Cell::Text("2".into()), Cell::Null]);
    assert!(d.schemas().await.unwrap().contains(&"public".to_string()));
    let t = d.tables("public").await.unwrap();
    assert!(t.iter().any(|t| t.name == "rexa_live_jdbc"));
    let st = d.table_structure(&TableRef::new("public", "rexa_live_jdbc")).await.unwrap();
    assert_eq!(st.len(), 2);
    assert!(d.execute("SELECT nope", 1).await.is_err());
    d.execute("DROP TABLE rexa_live_jdbc", 1).await.unwrap();
}

/// Spawns a private `redis-server` (no persistence) when one is installed.
#[tokio::test]
async fn redis_private_server() {
    let port = 46379u16;
    let Ok(mut child) = std::process::Command::new("redis-server")
        .args(["--port", &port.to_string(), "--save", "", "--appendonly", "no", "--requirepass", "pw"])
        .stdout(std::process::Stdio::null())
        .spawn()
    else {
        eprintln!("skipping: redis-server not installed");
        return;
    };
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    let cs = format!("redis://:pw@127.0.0.1:{port}/2");
    let d = connect_detect("", &cs).await.unwrap();
    assert_eq!(d.kind(), Kind::Redis);
    d.ping().await.unwrap();
    d.execute("SET \"my key\" 'hello world'", 1).await.unwrap();
    d.execute("HSET h a 1 b 2", 1).await.unwrap();
    d.execute("EXPIRE h 100", 1).await.unwrap();
    let r = d.execute("GET \"my key\"", 10).await.unwrap();
    assert_eq!((r.columns.clone(), r.rows[0][0].clone()), (vec!["result".to_string()], Cell::Text("hello world".into())));
    assert_eq!(d.execute("HGETALL h", 10).await.unwrap().rows.len(), 4);
    let keys = d.redis_keys("*", 0, None).await.unwrap();
    let h = keys.iter().find(|k| k.key == "h").unwrap();
    assert_eq!((h.r#type.as_str(), h.size), ("hash", Some(2)));
    assert!(h.ttl_seconds.unwrap() > 0);
    assert!(d.redis_keys("*", 10, Some("db0")).await.unwrap().is_empty());
    assert_eq!(d.databases().await.unwrap().len(), 16);
    assert!(d.execute("NOPE", 1).await.is_err());
    let _ = child.kill();
}
