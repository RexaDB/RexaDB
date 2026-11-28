//! PostgreSQL database advisor. The check catalogue and result formatting are a
//! port of lib/db/advisor (see `advisor_checks`); the page layout is an
//! approximation of components/advisor/advisor-view.tsx (one card per check, no
//! severity tabs / detail sheet).

use gpui::{div, prelude::*, px, App, AppContext, Context, Subscription, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_drivers::Kind;
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use std::sync::Arc;

use crate::advisor_checks::{self, AdvisorResult, Row, CHECKS};

pub struct Advisor {
    session: Arc<Session>,
    results: Vec<AdvisorResult>,
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
                    Ok(result) => {
                        let rows: Vec<Row> = result
                            .rows
                            .iter()
                            .map(|row| result.columns.iter().cloned().zip(row.iter().map(|cell| cell.display().to_string())).collect())
                            .collect();
                        results.push(advisor_checks::format_result(check, rows, None));
                    }
                    Err(error) => results.push(advisor_checks::format_result(check, Vec::new(), Some(format!("{error:#}")))),
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
            .filter(|r| !r.passed)
            .map(|r| r.rows.len().max(1))
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
                            let check = result.check;
                            let failed = result.detail.starts_with("Check failed");
                            let category = format!("{}{} · {}", check.category[..1].to_uppercase(), &check.category[1..], check.severity.label());
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
                                                .child(div().tw_text_sm().font_weight(gpui::FontWeight::MEDIUM).child(check.title))
                                                .child(div().tw_text_xs().text_color(t.muted_foreground).child(check.description)),
                                        )
                                        .child(
                                            div()
                                                .tw_text_10()
                                                .flex_shrink_0()
                                                .text_color(if failed { t.muted_foreground } else if !result.passed { t.destructive } else { t.primary })
                                                .child(result.detail.clone()),
                                        ),
                                )
                                .child(div().tw_text_10().text_color(t.muted_foreground).child(category))
                                .when(!result.rows.is_empty(), |el| {
                                    el.child(div().flex().flex_col().gap_1().children(result.rows.iter().take(50).map(|row| {
                                        div().rounded(px(4.)).bg(t.studio_bg).px_2().py_1().tw_text_xs().child(advisor_checks::entity_label(check.id, row))
                                    })))
                                })
                                .when_some(result.suggestion.clone(), |el, s| el.child(div().tw_text_xs().text_color(t.muted_foreground).child(s)))
                                .when_some(result.sql_statement.clone(), |el, sql| {
                                    el.child(div().rounded(px(4.)).bg(t.studio_bg).px_2().py_1().font_family(rexa_ui::MONO).text_size(px(11.)).child(sql))
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
