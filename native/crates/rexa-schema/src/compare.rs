//! Port of components/connections/connection-schema-compare-screen.tsx,
//! hooks/use-schema-compare.ts and `comparePostgresSchemas` /
//! `applyPostgresSchemaToTarget` (lib/db/actions.ts, export-helpers.ts
//! `runPgDumpSchemaOnly`): `Route::ConnectionScreen("compare")`.
//!
//! Approximations: the screen is drawn on its own (the original sits inside the
//! connections shell); statements are shown unformatted (no sql-formatter);
//! pg_dump is resolved from PATH / Homebrew / Postgres.app, and the SQL-introspection
//! fallback for non-dialable hosts (supabase-mgmt, Neon serverless) is not ported.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, FontWeight, SharedString, Window};
use rexa_core::runtime;
use rexa_drivers::Kind;
use rexa_store::{SavedConnection, Store};
use rexa_ui::widgets::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, Card, Combobox, Dialog, IconName, SelectOption, Toast, Tw, MONO};

#[derive(Clone, Debug, Default)]
pub struct CompareResult {
    pub is_equal: bool,
    pub missing_in_target: Vec<String>,
    pub extra_in_target: Vec<String>,
    pub source_count: usize,
    pub target_count: usize,
}

/// `normalizeSchemaSqlForCompare` + `splitSqlStatements` + `normalizeStatement`.
pub fn comparable_statements(sql: &str) -> Vec<(String, String)> {
    let filtered: Vec<&str> = sql
        .lines()
        .filter(|l| {
            let t = l.trim();
            !(t.is_empty() || t.starts_with("--") || t.to_uppercase().starts_with("SET ") || t.starts_with("SELECT pg_catalog.set_config"))
        })
        .collect();
    rexa_drivers::split::split_statements(&filtered.join("\n"), Kind::Postgres.dialect())
        .into_iter()
        .map(|raw| {
            let raw = raw.trim().trim_end_matches(';').trim().to_string();
            let norm = raw.split_whitespace().collect::<Vec<_>>().join(" ");
            (raw, norm)
        })
        .filter(|(_, n)| !n.is_empty())
        .collect()
}

pub fn compare(source_sql: &str, target_sql: &str) -> CompareResult {
    let s = comparable_statements(source_sql);
    let t = comparable_statements(target_sql);
    let tset: std::collections::HashSet<&str> = t.iter().map(|x| x.1.as_str()).collect();
    let sset: std::collections::HashSet<&str> = s.iter().map(|x| x.1.as_str()).collect();
    let missing: Vec<String> = s.iter().filter(|x| !tset.contains(x.1.as_str())).map(|x| x.0.clone()).collect();
    let extra: Vec<String> = t.iter().filter(|x| !sset.contains(x.1.as_str())).map(|x| x.0.clone()).collect();
    CompareResult { is_equal: missing.is_empty() && extra.is_empty(), source_count: s.len(), target_count: t.len(), missing_in_target: missing, extra_in_target: extra }
}

fn pg_dump_binary() -> String {
    let mut c: Vec<String> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        c.extend(path.split(':').map(|d| format!("{d}/pg_dump")));
    }
    c.extend(["/opt/homebrew/bin/pg_dump", "/usr/local/bin/pg_dump", "/Applications/Postgres.app/Contents/Versions/latest/bin/pg_dump"].map(String::from));
    if let Ok(rd) = std::fs::read_dir("/opt/homebrew/opt") {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with("postgresql") {
                c.push(format!("{}/bin/pg_dump", e.path().display()));
            }
        }
    }
    c.into_iter().find(|p| std::path::Path::new(p).exists()).unwrap_or_else(|| "pg_dump".into())
}

/// `runPgDumpSchemaOnly` (dialable Postgres only).
fn pg_dump_schema(cs: &str) -> anyhow::Result<String> {
    let out = std::process::Command::new(pg_dump_binary())
        .args(["--schema-only", "--no-owner", "--no-privileges", "--quote-all-identifiers", "--exclude-schema=information_schema|pg_*", &format!("--dbname={cs}")])
        .output()?;
    if !out.status.success() {
        anyhow::bail!("pg_dump failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn resolve(c: &SavedConnection) -> anyhow::Result<String> {
    Ok(rexa_store::resolve_credentials(c, None)?.connection_string)
}

fn is_postgres(c: &SavedConnection) -> bool {
    Kind::detect(&c.kind, &c.connection_string) == Some(Kind::Postgres)
}

pub struct SchemaCompareScreen {
    connections: Vec<SavedConnection>,
    source: Option<i64>,
    target: Option<i64>,
    loading: bool,
    applying: bool,
    error: Option<String>,
    result: Option<CompareResult>,
}

pub fn build(window: &mut Window, cx: &mut App) -> AnyView {
    let _ = window;
    cx.new(|_| SchemaCompareScreen {
        connections: Store::open().and_then(|s| s.connections()).unwrap_or_default().into_iter().filter(is_postgres).collect(),
        source: None,
        target: None,
        loading: false,
        applying: false,
        error: None,
        result: None,
    })
    .into()
}

impl SchemaCompareScreen {
    fn conn(&self, id: Option<i64>) -> Option<SavedConnection> {
        self.connections.iter().find(|c| Some(c.id) == id).cloned()
    }

    fn run_compare(&mut self, toast_ok: bool, cx: &mut Context<Self>) {
        let (Some(s), Some(t)) = (self.conn(self.source), self.conn(self.target)) else {
            Toast::error("Select two PostgreSQL connections to compare.").show(cx);
            return;
        };
        if s.id == t.id {
            Toast::error("Choose two different connections.").show(cx);
            return;
        }
        self.loading = true;
        self.error = None;
        cx.notify();
        let fut = runtime::spawn(async move {
            tokio::task::spawn_blocking(move || {
                let (a, b) = (pg_dump_schema(&resolve(&s)?)?, pg_dump_schema(&resolve(&t)?)?);
                Ok(compare(&a, &b))
            })
            .await?
        });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loading = false;
                match r {
                    Ok(res) => {
                        v.result = Some(res);
                        if toast_ok {
                            Toast::success("Schema comparison complete.").show(cx);
                        }
                    }
                    Err(e) => {
                        v.error = Some(format!("{e:#}"));
                        v.result = None;
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn apply(&mut self, cx: &mut Context<Self>) {
        let (Some(s), Some(t)) = (self.conn(self.source), self.conn(self.target)) else { return };
        self.applying = true;
        self.error = None;
        cx.notify();
        let fut = runtime::spawn(async move {
            let (scs, tcs) = (resolve(&s)?, resolve(&t)?);
            let (a, b) = {
                let (scs, tcs) = (scs.clone(), tcs.clone());
                tokio::task::spawn_blocking(move || anyhow::Ok((pg_dump_schema(&scs)?, pg_dump_schema(&tcs)?))).await??
            };
            let tset: std::collections::HashSet<String> = comparable_statements(&b).into_iter().map(|x| x.1).collect();
            let to_apply: Vec<String> = comparable_statements(&a).into_iter().filter(|x| !tset.contains(&x.1)).map(|x| x.0).collect();
            if to_apply.is_empty() {
                return Ok(0usize);
            }
            let driver = rexa_drivers::connect_detect(&t.kind, &tcs).await?;
            let mut errors = Vec::new();
            for st in &to_apply {
                if let Err(e) = driver.execute(st, 1).await {
                    let m = format!("{e:#}");
                    let l = m.to_lowercase();
                    if !(l.contains("already exists") || l.contains("duplicate")) {
                        errors.push(format!("{m} | {}", st.chars().take(200).collect::<String>()));
                    }
                }
            }
            if let Some(e) = errors.first() {
                anyhow::bail!("Applied with errors: {e}");
            }
            Ok(to_apply.len())
        });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.applying = false;
                match r {
                    Ok(n) => {
                        Toast::success(if n > 0 { format!("Applied {n} statements.") } else { "Schema already up to date.".into() }).show(cx);
                        v.run_compare(false, cx);
                    }
                    Err(e) => v.error = Some(format!("{e:#}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn confirm_apply(&mut self, cx: &mut Context<Self>) {
        let this = cx.entity();
        rexa_ui::open_dialog(cx, move |_, cx| {
            let applying = this.read(cx).applying;
            let t2 = this.clone();
            Dialog::new()
                .title("Apply Source Schema?")
                .description("This will drop non-system schemas in the target database and recreate them from the source schema. Data is not migrated.")
                .footer(Button::new("cmp-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(Button::new("cmp-apply").destructive().label(if applying { "Applying..." } else { "Apply Schema" }).disabled(applying).on_click(move |_, _, cx| {
                    rexa_ui::close_top(cx);
                    t2.update(cx, |v, cx| v.apply(cx));
                }))
        });
    }
}

impl Render for SchemaCompareScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let options: Vec<SelectOption> = self.connections.iter().map(|c| SelectOption::new(c.id.to_string(), c.name.clone())).collect();
        let this = cx.entity();
        let picker = |id: &'static str, label: &'static str, placeholder: &'static str, value: Option<i64>, set: fn(&mut Self, Option<i64>)| {
            let this = this.clone();
            div().flex_1().flex().flex_col().gap_2().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(label)).child(
                Combobox::searchable(id).placeholder(placeholder).options(options.clone()).value(value.map(|v| SharedString::from(v.to_string()))).on_change(move |v, _, cx| {
                    this.update(cx, |s, cx| {
                        set(s, v.parse().ok());
                        cx.notify();
                    })
                }),
            )
        };
        let card_bg = with_alpha(t.studio_bg, 0.4);
        let stat = |label: &'static str, value: String| {
            div().flex_1().p_3().tw_rounded_xl().border_1().border_color(with_alpha(t.border, 0.6)).bg(card_bg).child(div().tw_text_xs().text_color(t.muted_foreground).child(rexa_ui::tracked_text::tracked(label, 0.14))).child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(value))
        };
        let block = |label: &'static str, stmts: &[String], empty: &'static str| {
            let text = if stmts.is_empty() { empty.to_string() } else { stmts.iter().map(|s| format!("{s};")).collect::<Vec<_>>().join("\n\n") };
            div()
                .flex_1()
                .min_w_0()
                .p_3()
                .tw_rounded_xl()
                .border_1()
                .border_color(with_alpha(t.border, 0.6))
                .bg(card_bg)
                .child(div().mb_2().tw_text_xs().text_color(t.muted_foreground).child(rexa_ui::tracked_text::tracked(label, 0.14)))
                .child(div().id(label).max_h(px(280.)).overflow_y_scroll().tw_rounded_lg().bg(with_alpha(t.background, 0.7)).p_3().tw_text_xs().font_family(MONO).child(text))
        };
        let results = self.result.clone().map(|r| {
            let mut d = div().mt_6().flex().flex_col().gap_4().child(div().flex().gap_3().child(stat("Source Statements", r.source_count.to_string())).child(stat("Target Statements", r.target_count.to_string())).child(stat("Status", if r.is_equal { "Match".into() } else { "Differences".into() })));
            if r.is_equal {
                d = d.child(div().p_3().tw_rounded_xl().border_1().border_color(with_alpha(t.border, 0.6)).bg(with_alpha(tw("emerald-500"), 0.1)).tw_text_sm().text_color(tw("emerald-700")).child("Schemas match. No changes required."));
            } else {
                let amber = tw("amber-500");
                d = d
                    .child(div().flex().items_start().gap_2().tw_rounded_lg().border_1().border_color(with_alpha(amber, 0.3)).bg(with_alpha(amber, 0.1)).px_3().py_2().tw_text_xs().text_color(tw("amber-700")).child(Icon::new(IconName::TriangleAlert).size_4().mt(px(2.))).child("This comparison uses schema statements from `pg_dump` and ignores data. Applying changes will run only missing statements on the target."))
                    .child(div().flex().gap_3().child(block("Will Apply", &r.missing_in_target, "No missing statements.")).child(block("Only In Target", &r.extra_in_target, "No extra statements.")))
                    .child(div().child(Button::new("cmp-apply-open").destructive().size(ButtonSize::Sm).label(if self.applying { "Applying..." } else { "Apply Source Schema to Target" }).disabled(self.applying).on_click(cx.listener(|v, _, _, cx| v.confirm_apply(cx)))));
            }
            d
        });
        let too_few = self.connections.len() < 2;
        div().size_full().bg(t.background).text_color(t.foreground).flex().flex_col().px_6().py_8().pt(px(44.)).child(
            div()
                .id("cmp-scroll")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .pb_8()
                .px_2()
                .child(
                    div().flex().items_center().gap_3().mb_8().child(Button::new("cmp-back").ghost().size(ButtonSize::Icon).icon(IconName::ArrowLeft).on_click(|_, _, cx| rexa_core::go_back(cx))).child(
                        div().child(div().tw_text_sm().font_weight(FontWeight::BOLD).child(rexa_ui::tight("Compare Schemas"))).child(div().text_color(t.muted_foreground).tw_text_sm().mt_1().child("Compare two PostgreSQL connections and optionally apply schema changes.")),
                    ),
                )
                .child(
                    Card::new().child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_4()
                            .child(div().flex().gap_4().child(picker("cmp-source", "Source (authoritative)", "Select source connection", self.source, |s, v| s.source = v)).child(picker("cmp-target", "Target (to update)", "Select target connection", self.target, |s, v| s.target = v)))
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .gap_2()
                                    .child(Button::new("cmp-run").size(ButtonSize::Sm).label(if self.loading { "Comparing..." } else { "Compare Schemas" }).disabled(self.loading || too_few).on_click(cx.listener(|v, _, _, cx| v.run_compare(true, cx))))
                                    .child(Button::new("cmp-reset").outline().size(ButtonSize::Sm).label("Reset").on_click(cx.listener(|v, _, _, cx| {
                                        v.source = None;
                                        v.target = None;
                                        v.error = None;
                                        v.result = None;
                                        cx.notify();
                                    }))),
                            )
                            .children(self.error.clone().map(|e| div().tw_text_xs().text_color(t.destructive).child(e)))
                            .when(too_few, |d| d.child(div().tw_text_xs().text_color(t.muted_foreground).child("Add at least two PostgreSQL connections to compare schemas."))),
                    ),
                )
                .children(results),
        )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn compares_statements() {
        let a = "-- c\nSET x = 1;\nCREATE TABLE a (id int);\nCREATE TABLE b (id   int);";
        let b = "CREATE TABLE b (id int);\nCREATE TABLE c (id int);";
        let r = super::compare(a, b);
        assert!(!r.is_equal);
        assert_eq!(r.missing_in_target, vec!["CREATE TABLE a (id int)"]);
        assert_eq!(r.extra_in_target, vec!["CREATE TABLE c (id int)"]);
        assert_eq!((r.source_count, r.target_count), (2, 2));
    }
}
