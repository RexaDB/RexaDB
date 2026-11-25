//! PostgreSQL database advisor: security and schema checks.

use gpui::{div, prelude::*, px, App, AppContext, Context, Subscription, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_drivers::Kind;
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use std::sync::Arc;

struct Check {
    title: &'static str,
    category: &'static str,
    description: &'static str,
    sql: &'static str,
}

const CHECKS: &[Check] = &[
    Check {
        title: "Tables without Row-Level Security",
        category: "Security · Critical",
        description: "Public tables without RLS can be exposed to roles granted table access.",
        sql: "SELECT n.nspname AS schema_name, c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity ORDER BY c.relname",
    },
    Check {
        title: "Tables without a primary key",
        category: "Schema · Warning",
        description: "Primary keys help identify rows and support replication and reliable editing.",
        sql: "SELECT n.nspname AS schema_name, c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_constraint pk ON pk.conrelid=c.oid AND pk.contype='p' WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND c.relkind IN ('r','p') AND pk.oid IS NULL ORDER BY n.nspname,c.relname",
    },
    Check {
        title: "RLS enabled without policies",
        category: "Security · Info",
        description: "With RLS enabled and no policies, normal roles cannot read or modify any rows.",
        sql: "SELECT n.nspname AS schema_name,c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relrowsecurity AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) ORDER BY n.nspname,c.relname",
    },
    Check {
        title: "Unused indexes",
        category: "Performance · Warning",
        description: "Indexes with no scans can increase storage and write costs. Review before dropping.",
        sql: "SELECT schemaname,tablename,indexname,idx_scan FROM pg_stat_user_indexes WHERE idx_scan=0 AND indexrelid NOT IN (SELECT conindid FROM pg_constraint WHERE contype IN ('p','u')) ORDER BY schemaname,tablename,indexname LIMIT 100",
    },
    Check {
        title: "Disabled triggers",
        category: "Schema · Warning",
        description: "Disabled triggers may prevent expected data validation or derived updates.",
        sql: "SELECT n.nspname AS schema_name,c.relname AS table_name,t.tgname AS trigger_name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND t.tgenabled='D' ORDER BY n.nspname,c.relname,t.tgname",
    },
];

#[derive(Clone)]
struct CheckResult {
    title: &'static str,
    category: &'static str,
    description: &'static str,
    rows: Vec<Vec<String>>,
    error: Option<String>,
}

pub struct Advisor {
    session: Arc<Session>,
    results: Vec<CheckResult>,
    busy: bool,
    error: Option<String>,
    spec: TabSpec,
    _sub: Subscription,
}

impl Advisor {
    fn new(session: Arc<Session>, spec: TabSpec, cx: &mut Context<Self>) -> Self {
        let sub = cx.subscribe(&rexa_core::studio_bus(cx), move |this, _, event: &rexa_core::StudioEvent, cx| {
            if matches!(event, rexa_core::StudioEvent::TabCommand { tab, command } if tab == &this.spec && command == "REFRESH_CURRENT_TAB") { this.load(cx); }
        });
        let mut this = Self {
            session,
            results: Vec::new(),
            busy: false,
            error: None,
            spec,
            _sub: sub,
        };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        if !matches!(
            self.session.driver.kind(),
            Kind::Postgres | Kind::SupabaseMgmt
        ) {
            self.error = Some(
                "Database Advisor checks currently support PostgreSQL connections only.".into(),
            );
            self.results.clear();
            self.busy = false;
            cx.notify();
            return;
        }
        self.busy = true;
        self.error = None;
        cx.notify();
        let driver = self.session.driver.clone();
        let task = runtime::spawn(async move {
            let mut results = Vec::with_capacity(CHECKS.len());
            for check in CHECKS {
                match driver.execute_readonly(check.sql, 500).await {
                    Ok(result) => results.push(CheckResult {
                        title: check.title,
                        category: check.category,
                        description: check.description,
                        rows: result
                            .rows
                            .iter()
                            .map(|row| row.iter().map(|cell| cell.display().to_string()).collect())
                            .collect(),
                        error: None,
                    }),
                    Err(error) => results.push(CheckResult {
                        title: check.title,
                        category: check.category,
                        description: check.description,
                        rows: Vec::new(),
                        error: Some(format!("Check unavailable: {error:#}")),
                    }),
                }
            }
            Ok(results)
        });
        cx.spawn(async move |this, cx| {
            let results = task.await.unwrap_or_default();
            this.update(cx, |this, cx| {
                this.results = results;
                this.busy = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

impl Render for Advisor {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let issues = self
            .results
            .iter()
            .filter(|r| r.error.is_none())
            .map(|r| r.rows.len())
            .sum::<usize>();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .px_5()
                    .py_3()
                    .border_b_1()
                    .border_color(t.border)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .tw_text_sm()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .child("Database Advisor"),
                            )
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(
                                if self.busy {
                                    "Running PostgreSQL security and schema checks…".to_string()
                                } else {
                                    format!(
                                        "{issues} issue(s) found across {} checks",
                                        self.results.len()
                                    )
                                },
                            )),
                    )
                    .child(
                        Button::new("advisor-refresh")
                            .outline()
                            .size(ButtonSize::Sm)
                            .icon(IconName::RefreshCw)
                            .label(if self.busy { "Running…" } else { "Refresh" })
                            .disabled(self.busy)
                            .on_click(cx.listener(|this, _, _, cx| this.load(cx))),
                    ),
            )
            .when_some(self.error.clone(), |el, error| {
                el.child(
                    div()
                        .mx_5()
                        .mt_4()
                        .rounded(px(8.))
                        .border_1()
                        .border_color(t.border)
                        .bg(t.card)
                        .p_4()
                        .tw_text_sm()
                        .child(error),
                )
            })
            .child(
                div().flex_1().min_h_0().overflow_y_scrollbar().child(
                    div()
                        .mx_auto()
                        .max_w(px(1000.))
                        .flex()
                        .flex_col()
                        .gap_3()
                        .p_5()
                        .children(self.results.iter().map(|result| {
                            let rows = result.rows.len();
                            div()
                                .flex()
                                .flex_col()
                                .gap_2()
                                .rounded(px(8.))
                                .border_1()
                                .border_color(t.border)
                                .bg(t.card)
                                .p_4()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .justify_between()
                                        .gap_3()
                                        .child(
                                            div()
                                                .flex()
                                                .flex_col()
                                                .gap_1()
                                                .child(
                                                    div()
                                                        .tw_text_sm()
                                                        .font_weight(gpui::FontWeight::MEDIUM)
                                                        .child(result.title),
                                                )
                                                .child(
                                                    div()
                                                        .tw_text_xs()
                                                        .text_color(t.muted_foreground)
                                                        .child(result.description),
                                                ),
                                        )
                                        .child(
                                            div()
                                                .tw_text_10()
                                                .text_color(if result.error.is_some() {
                                                    t.muted_foreground
                                                } else if rows > 0 {
                                                    t.destructive
                                                } else {
                                                    t.primary
                                                })
                                                .child(result.error.clone().unwrap_or_else(|| {
                                                    if rows == 0 {
                                                        "No issues".into()
                                                    } else {
                                                        format!("{rows} result(s)")
                                                    }
                                                })),
                                        ),
                                )
                                .child(
                                    div()
                                        .tw_text_10()
                                        .text_color(t.muted_foreground)
                                        .child(result.category),
                                )
                                .when(rows > 0, |el| {
                                    el.child(div().flex().flex_col().gap_1().children(
                                        result.rows.iter().take(50).map(|row| {
                                            let label = row
                                                .iter()
                                                .filter(|v| !v.is_empty())
                                                .cloned()
                                                .collect::<Vec<_>>()
                                                .join(" · ");
                                            div()
                                                .rounded(px(4.))
                                                .bg(t.studio_bg)
                                                .px_2()
                                                .py_1()
                                                .tw_text_xs()
                                                .child(label)
                                        }),
                                    ))
                                })
                        })),
                ),
            )
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-features-advisor", |spec, session, _window, cx| {
        let TabSpec::View { view, .. } = spec else {
            return None;
        };
        if view != "advisor" {
            return None;
        }
        let spec = spec.clone();
        Some(cx.new(|cx| Advisor::new(session, spec, cx)).into())
    });
}
