//! Port of components/studio/payments/{views/shared,views/customers-view,views/revenue-view,
//! views/plans-view,plans-tab,features-tab,product-sheet,feature-sheet,paykit-shared,revenue-charts}.tsx
//! and lib/supabase-paykit/{queries,analytics,currencies,validation,types}.ts.
//!
//! Plans uses contained ProductSheet + FeatureSheet (`crate::ui::studio_sheet`).
//! Setup/sync live in `setup.rs` / `deploy.rs`. Approximations: recharts area/bar
//! charts are painted with GPUI paths (flat-alpha fill, no hover tooltip).

mod currencies;
mod deploy;
mod drafts;
mod plans;
mod prompt;
mod setup;
mod sql;
mod templates;

pub use drafts::*;
pub use plans::PlansView;
pub use setup::SetupView;

use crate::common::Grid;
use crate::data_table::{Column, DataTable, Row, TableState};
use crate::supabase;
use crate::ui;
use gpui::{canvas, div, point, prelude::*, px, AnyElement, AnyView, App, AppContext, Bounds, Context, Entity, FontWeight, PathBuilder, Pixels, SharedString, Window};
use rexa_core::{Session, StudioEvent, TabSpec};
use rexa_ui::widgets::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, Tw, MONO};
use serde_json::Value;
use std::sync::Arc;

pub fn build_tab(view: &str, _params: &Value, session: Arc<Session>, window: &mut Window, cx: &mut App) -> Option<AnyView> {
    Some(match view {
        "payments-customers" => cx.new(|cx| ListView::new(session, ListKind::Customers, cx)).into(),
        "payments-subscriptions" => cx.new(|cx| ListView::new(session, ListKind::Subscriptions, cx)).into(),
        "payments-webhooks" => cx.new(|cx| ListView::new(session, ListKind::Webhooks, cx)).into(),
        "payments-revenue" => cx.new(|cx| RevenueView::new(session, cx)).into(),
        "payments-plans" => cx.new(|cx| PlansView::new(session, window, cx)).into(),
        "payments-setup" => cx.new(|cx| SetupView::new(session, window, cx)).into(),
        _ => return None,
    })
}

// ---- queries --------------------------------------------------------------------------------

const P: &str = "paykit";

fn q_customers() -> String {
    format!("SELECT c.id, c.email, c.name, c.stripe_customer_id, c.created_at,
    (SELECT count(*) FROM {P}.subscription s WHERE s.customer_id = c.id AND s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL) AS active_subs,
    (SELECT count(*) FROM {P}.subscription s WHERE s.customer_id = c.id) AS total_subs
  FROM {P}.customer c ORDER BY c.created_at DESC LIMIT 200")
}
fn q_subscriptions() -> String {
    format!("SELECT s.id, s.customer_id, c.email AS customer_email, s.product_internal_id,
    p.name AS plan_name, s.status, s.canceled, s.cancel_at_period_end,
    s.current_period_end_at, s.quantity, s.updated_at, s.stripe_subscription_id
  FROM {P}.subscription s
  LEFT JOIN {P}.customer c ON c.id = s.customer_id
  LEFT JOIN {P}.product p ON p.internal_id = s.product_internal_id
  ORDER BY s.updated_at DESC LIMIT 200")
}
fn q_invoices() -> String {
    format!("SELECT i.id, i.customer_id, c.email AS customer_email, i.subscription_id,
    i.status, i.amount, i.currency, i.hosted_url, i.period_start_at, i.period_end_at, i.created_at
  FROM {P}.invoice i
  LEFT JOIN {P}.customer c ON c.id = i.customer_id
  ORDER BY i.created_at DESC LIMIT 200")
}
fn q_kpis() -> String {
    format!("SELECT
    (SELECT coalesce(sum(amount),0) FROM {P}.invoice WHERE status = 'paid') AS paid_total,
    (SELECT count(*) FROM {P}.subscription WHERE status IN ('active','trialing') AND canceled = false AND ended_at IS NULL) AS active_subs,
    (SELECT count(*) FROM {P}.customer) AS customers,
    (SELECT count(*) FROM {P}.invoice WHERE status = 'failed') AS failed_invoices")
}
fn q_mrr() -> String {
    format!("SELECT coalesce(sum(p.price_amount * s.quantity),0) AS mrr_cents
  FROM {P}.subscription s
  JOIN {P}.product p ON p.internal_id = s.product_internal_id
  WHERE s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL
    AND p.price_amount IS NOT NULL AND p.price_interval = 'month'")
}
fn q_webhooks() -> String {
    format!("SELECT id, type, status, error, received_at, processed_at, stripe_event_id
  FROM {P}.webhook_event ORDER BY received_at DESC LIMIT 200")
}
fn q_revenue_daily() -> String {
    format!("SELECT date_trunc('day', created_at)::date AS day, coalesce(sum(amount), 0) AS cents, count(*) AS orders FROM {P}.invoice WHERE status = 'paid' GROUP BY 1 ORDER BY 1")
}
fn q_mrr_daily() -> String {
    format!("SELECT d.day AS day, coalesce(sum(p.price_amount * s.quantity), 0) AS cents
    FROM (SELECT date_trunc('day', now() - (n || ' days')::interval)::date AS day FROM generate_series(0, 400) AS n) d
    LEFT JOIN {P}.subscription s ON s.status IN ('active', 'trialing') AND s.canceled = false AND d.day >= date_trunc('day', coalesce(s.started_at, s.created_at))::date AND (s.ended_at IS NULL OR d.day < date_trunc('day', s.ended_at)::date)
    LEFT JOIN {P}.product p ON p.internal_id = s.product_internal_id AND p.price_interval = 'month' AND p.price_amount IS NOT NULL
    GROUP BY 1 ORDER BY 1")
}
fn q_active_daily() -> String {
    format!("SELECT d.day AS day, count(DISTINCT s.id) AS subs
    FROM (SELECT date_trunc('day', now() - (n || ' days')::interval)::date AS day FROM generate_series(0, 400) AS n) d
    LEFT JOIN {P}.subscription s ON s.status IN ('active', 'trialing') AND s.canceled = false AND d.day >= date_trunc('day', coalesce(s.started_at, s.created_at))::date AND (s.ended_at IS NULL OR d.day < date_trunc('day', s.ended_at)::date)
    GROUP BY 1 ORDER BY 1")
}
fn q_checkouts_daily() -> String {
    format!("SELECT date_trunc('day', created_at)::date AS day, count(*) AS checkouts FROM {P}.metadata WHERE type = 'checkout_session' GROUP BY 1 ORDER BY 1")
}
fn q_cancels_daily() -> String {
    format!("SELECT date_trunc('day', coalesce(ended_at, updated_at))::date AS day, count(*) AS cancels FROM {P}.subscription WHERE canceled = true OR ended_at IS NOT NULL GROUP BY 1 ORDER BY 1")
}
fn q_recent_customers() -> String {
    format!("SELECT id, email, name, created_at FROM {P}.customer ORDER BY created_at DESC LIMIT 30")
}

/// `isMissingTable`.
pub fn is_missing_table(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("relation \"paykit.") || m.contains("relation paykit.") || (m.contains("schema") && m.contains("paykit") && m.contains("does not exist")) || (m.contains("paykit_") && m.contains("does not exist"))
}

#[derive(Default, Clone)]
pub struct PaykitResult {
    pub grid: Grid,
    pub error: Option<String>,
    pub missing: bool,
}

async fn query_paykit(driver: Arc<dyn rexa_drivers::Driver>, sql: String) -> PaykitResult {
    match driver.execute(&sql, 1000).await {
        Ok(r) => PaykitResult { grid: Grid::from_result(r), error: None, missing: false },
        Err(e) => {
            let m = format!("{e:#}");
            PaykitResult { grid: Grid::default(), missing: is_missing_table(&m), error: Some(m) }
        }
    }
}

fn group_thousands(n: f64, decimals: usize) -> String {
    let s = format!("{:.*}", decimals, n.abs());
    let (int, frac) = s.split_once('.').map(|(a, b)| (a.to_string(), Some(b.to_string()))).unwrap_or((s.clone(), None));
    let mut out = String::new();
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    format!("{}{}{}", if n < 0. { "-" } else { "" }, out, frac.map(|f| format!(".{f}")).unwrap_or_default())
}

/// `formatMoney` (Intl en-US currency; symbols for the common codes).
pub fn format_money(cents: Option<f64>, currency: &str) -> String {
    let Some(c) = cents.filter(|c| c.is_finite()) else { return "—".into() };
    let code = if currency.is_empty() { "USD".to_string() } else { currency.to_uppercase() };
    let dollars = c / 100.;
    match code.as_str() {
        "USD" => format!("${}", group_thousands(dollars, 2)),
        "EUR" => format!("€{}", group_thousands(dollars, 2)),
        "GBP" => format!("£{}", group_thousands(dollars, 2)),
        "JPY" => format!("¥{}", group_thousands(dollars, 0)),
        other => format!("{other}\u{a0}{}", group_thousands(dollars, 2)),
    }
}

// ---- shared view pieces ---------------------------------------------------------------------

/// `ViewShell` header (title text-lg semibold + muted description, actions, Refresh).
fn shell(title: &str, description: Option<&str>, actions: Option<AnyElement>, refresh: Option<(bool, Box<dyn Fn(&mut Window, &mut App)>)>, body: AnyElement, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .id("pay-scroll")
        .size_full()
        .overflow_y_scroll()
        .bg(t.studio_bg)
        .text_color(t.foreground)
        .child(
            div()
                .mx_auto()
                .w_full()
                .max_w(px(1152.))
                .flex()
                .flex_col()
                .gap_4()
                .p_6()
                .child(
                    div()
                        .flex()
                        .items_start()
                        .gap_3()
                        .child(div().flex_1().min_w_0().child(div().tw_text_lg().font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(title.to_string()))).children(description.map(|d| div().mt(px(2.)).tw_text_xs().text_color(t.muted_foreground).child(d.to_string()))))
                        .children(actions)
                        .children(refresh.map(|(loading, f)| Button::new("pay-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(loading).on_click(move |_, w, cx| f(w, cx)))),
                )
                .child(body),
        )
        .into_any_element()
}

fn view_error(msg: &str, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div().flex().gap_2().tw_rounded_xl().border_1().border_color(with_alpha(t.destructive, 0.3)).bg(with_alpha(t.destructive, 0.05)).p_3().tw_text_xs().child(Icon::new(IconName::TriangleAlert).size(px(16.)).text_color(t.destructive)).child(div().flex_1().min_w_0().child(msg.to_string())).into_any_element()
}

fn setup_cta(cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex()
        .flex_col()
        .items_center()
        .gap_2()
        .tw_rounded_xl()
        .border_1()
        .border_dashed()
        .border_color(with_alpha(t.studio_border, 0.6))
        .px_4()
        .py_10()
        .text_center()
        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Billing schema not found"))
        .child(div().max_w(px(448.)).tw_text_xs().text_color(t.muted_foreground).child(ui::inline(vec![div().child("This project has no").into_any_element(), div().font_family(MONO).child("paykit").into_any_element(), div().child("schema tables yet. Push the schema and deploy the edge functions to start accepting payments.").into_any_element()])))
        .child(div().mt_1().child(Button::new("pay-setup").size(ButtonSize::Sm).label("Open Setup").on_click(|_, _, cx| rexa_core::open_tab(TabSpec::View { view: "payments-setup".into(), params: Value::Object(Default::default()) }, cx))))
        .into_any_element()
}

fn view_loading() -> AnyElement {
    div().flex().items_center().justify_center().py_16().child(rexa_ui::Spinner::new(20.)).into_any_element()
}

fn empty(msg: &str, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div().tw_rounded_xl().border_1().border_color(with_alpha(t.studio_border, 0.6)).px_4().py_10().text_center().tw_text_xs().text_color(t.muted_foreground).child(msg.to_string()).into_any_element()
}

/// `StatusBadge`.
fn status_badge(status: &str) -> AnyElement {
    let s = status.to_lowercase();
    let v = if matches!(s.as_str(), "active" | "paid" | "processed" | "trialing") {
        BadgeVariant::Default
    } else if matches!(s.as_str(), "failed" | "canceled" | "unpaid") {
        BadgeVariant::Destructive
    } else {
        BadgeVariant::Secondary
    };
    div().font_family(MONO).child(Badge::new(status.to_string()).variant(v)).into_any_element()
}

fn cell_text(v: &str, mono: bool, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div().truncate().text_color(t.muted_foreground).when(mono, |d| d.font_family(MONO).text_size(px(11.))).child(if v.is_empty() { "—".to_string() } else { v.to_string() }).into_any_element()
}

fn yes_no(v: &str) -> String {
    if v.is_empty() { "—".into() } else if ui::truthy(v) { "yes".into() } else { "no".into() }
}

// ---- customers / subscriptions / webhooks ------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum ListKind {
    Customers,
    Subscriptions,
    Webhooks,
}

pub struct ListView {
    session: Arc<Session>,
    kind: ListKind,
    result: PaykitResult,
    loading: bool,
    table: Entity<TableState>,
    expanded: Option<String>,
    payload: Option<String>,
    payload_loading: bool,
}

impl ListView {
    fn new(session: Arc<Session>, kind: ListKind, cx: &mut Context<Self>) -> Self {
        let table = cx.new(|_| TableState::default());
        cx.observe(&table, |_, _, cx| cx.notify()).detach();
        let view = match kind {
            ListKind::Customers => "payments-customers",
            ListKind::Subscriptions => "payments-subscriptions",
            ListKind::Webhooks => "payments-webhooks",
        };
        cx.subscribe(&rexa_core::studio_bus(cx), move |this: &mut Self, _, e: &StudioEvent, cx| {
            if let StudioEvent::TabCommand { tab: TabSpec::View { view: v, .. }, command } = e {
                if v == view && command == "REFRESH_CURRENT_TAB" {
                    this.load(cx);
                }
            }
        })
        .detach();
        let mut this = Self { session, kind, result: PaykitResult::default(), loading: true, table, expanded: None, payload: None, payload_loading: false };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let sql = match self.kind {
            ListKind::Customers => q_customers(),
            ListKind::Subscriptions => q_subscriptions(),
            ListKind::Webhooks => q_webhooks(),
        };
        let driver = self.session.driver.clone();
        ui::run(cx, async move { Ok(query_paykit(driver, sql).await) }, |this, r, _| {
            this.loading = false;
            if let Ok(r) = r {
                this.result = r;
            }
        });
    }

    fn toggle_payload(&mut self, id: String, cx: &mut Context<Self>) {
        if self.expanded.as_deref() == Some(&id) {
            self.expanded = None;
            self.payload = None;
            cx.notify();
            return;
        }
        self.expanded = Some(id.clone());
        self.payload_loading = true;
        cx.notify();
        let driver = self.session.driver.clone();
        let sql = format!("SELECT payload FROM {P}.webhook_event WHERE id = '{}' LIMIT 1", ui::lit(&id));
        ui::run(cx, async move { Ok(query_paykit(driver, sql).await) }, |this, r, _| {
            this.payload_loading = false;
            this.payload = r.ok().and_then(|r| r.grid.rows.first().map(|row| r.grid.get(row, "payload").to_string())).filter(|p| !p.is_empty()).map(|p| serde_json::from_str::<Value>(&p).ok().and_then(|v| serde_json::to_string_pretty(&v).ok()).unwrap_or(p));
        });
    }
}

impl Render for ListView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let (title, desc, empty_msg) = match self.kind {
            ListKind::Customers => ("Customers", "Billing customers synced from Stripe checkout and the PayKit API.", "No customers yet. Customers appear after the first checkout or API upsert."),
            ListKind::Subscriptions => ("Subscriptions", "Active and historical subscriptions across all plans.", "No subscriptions yet. They appear after the first successful checkout."),
            ListKind::Webhooks => ("Webhooks", "Stripe events received by paykit-webhook, newest first. Failed events are retried by Stripe.", "No webhook events yet. Send a test event from the Stripe Dashboard after registering the endpoint."),
        };
        let g = self.result.grid.clone();
        let body: AnyElement = if self.loading {
            view_loading()
        } else if self.result.missing {
            setup_cta(cx)
        } else {
            let mut parts: Vec<AnyElement> = vec![];
            if let Some(e) = &self.result.error {
                parts.push(view_error(e, cx));
            }
            if g.rows.is_empty() {
                parts.push(empty(empty_msg, cx));
            } else if self.kind == ListKind::Webhooks {
                parts.push(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .children(g.rows.iter().map(|r| {
                            let id = g.get(r, "id").to_string();
                            let open = self.expanded.as_deref() == Some(&id);
                            let err = g.get(r, "error").to_string();
                            let id2 = id.clone();
                            div()
                                .overflow_hidden()
                                .tw_rounded_xl()
                                .border_1()
                                .border_color(with_alpha(t.studio_border, 0.6))
                                .child(
                                    div()
                                        .id(SharedString::from(format!("wh-{id}")))
                                        .flex()
                                        .w_full()
                                        .items_center()
                                        .gap_2()
                                        .px_3()
                                        .py_2()
                                        .tw_text_xs()
                                        .cursor_pointer()
                                        .hover(|d| d.bg(with_alpha(t.muted, 0.2)))
                                        .on_click(cx.listener(move |this, _, _, cx| this.toggle_payload(id2.clone(), cx)))
                                        .child(status_badge(g.get(r, "status")))
                                        .child(div().flex_1().min_w_0().truncate().font_family(MONO).text_size(px(11.)).child(g.get(r, "type").to_string()))
                                        .child(div().flex_shrink_0().text_size(px(10.)).text_color(t.muted_foreground).child(ui::date_locale(g.get(r, "received_at")))),
                                )
                                .when(!err.is_empty(), |d| d.child(div().border_t_1().border_color(with_alpha(t.studio_border, 0.4)).px_3().py(px(6.)).text_size(px(11.)).text_color(t.destructive).child(err.chars().take(500).collect::<String>())))
                                .when(open, |d| {
                                    d.child(
                                        div()
                                            .id(SharedString::from(format!("wh-p-{id}")))
                                            .max_h(px(256.))
                                            .overflow_y_scroll()
                                            .border_t_1()
                                            .border_color(with_alpha(t.studio_border, 0.4))
                                            .bg(gpui::hsla(0., 0., 0., 0.3))
                                            .p_3()
                                            .font_family(MONO)
                                            .text_size(px(10.5))
                                            .child(if self.payload_loading { "Loading…".to_string() } else { self.payload.clone().unwrap_or_else(|| "No payload stored.".into()) }),
                                    )
                                })
                        }))
                        .into_any_element(),
                );
            } else {
                let (cols, rows): (Vec<Column>, Vec<Row>) = match self.kind {
                    ListKind::Customers => (
                        vec![Column::new("id", "Customer"), Column::new("email", "Email"), Column::new("name", "Name"), Column::new("stripe", "Stripe ID"), Column::new("active", "Active subs"), Column::new("total", "Total subs"), Column::new("created", "Created")],
                        g.rows
                            .iter()
                            .enumerate()
                            .map(|(i, r)| {
                                let active = g.get(r, "active_subs").parse::<f64>().unwrap_or(0.) > 0.;
                                Row::new(i.to_string())
                                    .cell(cell_text(g.get(r, "id"), true, cx))
                                    .cell(cell_text(g.get(r, "email"), false, cx))
                                    .cell(cell_text(g.get(r, "name"), false, cx))
                                    .cell(cell_text(g.get(r, "stripe_customer_id"), true, cx))
                                    .cell(status_badge(if active { "active" } else { "none" }))
                                    .cell(cell_text(g.get(r, "total_subs"), false, cx))
                                    .cell(cell_text(&ui::date_locale(g.get(r, "created_at")), false, cx))
                            })
                            .collect(),
                    ),
                    _ => (
                        vec![Column::new("customer", "Customer"), Column::new("plan", "Plan"), Column::new("status", "Status"), Column::new("cancel", "Cancels at period end"), Column::new("ends", "Period ends"), Column::new("stripe", "Stripe ID")],
                        g.rows
                            .iter()
                            .enumerate()
                            .map(|(i, r)| {
                                Row::new(i.to_string())
                                    .cell(cell_text(g.get(r, "customer_email"), false, cx))
                                    .cell(cell_text(g.get(r, "plan_name"), false, cx))
                                    .cell(status_badge(g.get(r, "status")))
                                    .cell(cell_text(&if ui::truthy(g.get(r, "cancel_at_period_end")) { "yes".to_string() } else { "no".to_string() }, false, cx))
                                    .cell(cell_text(&ui::date_locale(g.get(r, "current_period_end_at")), false, cx))
                                    .cell(cell_text(g.get(r, "stripe_subscription_id"), true, cx))
                            })
                            .collect(),
                    ),
                };
                parts.push(DataTable::new("pay-list", &self.table).columns(cols).rows(rows).into_any_element());
            }
            div().flex().flex_col().gap_4().children(parts).into_any_element()
        };
        let w = cx.entity().downgrade();
        let _ = yes_no;
        shell(title, Some(desc), None, Some((self.loading, Box::new(move |_, cx| { w.update(cx, |s, cx| s.load(cx)).ok(); }))), body, cx)
    }
}

// ---- revenue (analytics + charts) ------------------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
pub enum Range {
    All,
    M12,
    M3,
    D30,
    Today,
}

impl Range {
    const ALL: [(Range, &'static str); 5] = [(Range::All, "All Time"), (Range::M12, "12m"), (Range::M3, "3m"), (Range::D30, "30d"), (Range::Today, "Today")];
    fn days(self) -> Option<i64> {
        match self {
            Range::All => None,
            Range::M12 => Some(365),
            Range::M3 => Some(90),
            Range::D30 => Some(30),
            Range::Today => Some(1),
        }
    }
}

const MONTHS_SHORT: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

fn day_key(d: chrono::DateTime<chrono::Local>) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// `formatAxisDay` ("Nov 05").
pub fn format_axis_day(key: &str) -> String {
    let mut it = key.split('-').skip(1).map(|p| p.parse::<usize>().unwrap_or(1));
    let (m, d) = (it.next().unwrap_or(1), it.next().unwrap_or(1));
    format!("{} {:02}", MONTHS_SHORT[(m.max(1) - 1).min(11)], d)
}

/// `formatRangeLabel`.
pub fn format_range_label(range: Range, now: chrono::DateTime<chrono::Local>) -> String {
    use chrono::Datelike;
    let Some(days) = range.days() else { return "All time".into() };
    let end = format!("{} {}, {}", MONTHS_SHORT[now.month0() as usize], now.day(), now.year());
    if range == Range::Today {
        return end;
    }
    let start = now - chrono::Duration::days(days - 1);
    format!("{} {} – {}", MONTHS_SHORT[start.month0() as usize], start.day(), end)
}

fn filter_range(points: &[(String, f64)], range: Range, now: chrono::DateTime<chrono::Local>) -> Vec<(String, f64)> {
    match range.days() {
        None => points.to_vec(),
        Some(d) => {
            let cutoff = day_key(now - chrono::Duration::days(d - 1));
            points.iter().filter(|(day, _)| *day >= cutoff).cloned().collect()
        }
    }
}

/// `emptySeriesForRange`.
fn empty_series(range: Range, now: chrono::DateTime<chrono::Local>) -> Vec<(String, f64)> {
    use chrono::{Datelike, Timelike};
    match range {
        Range::Today => (0..24).map(|i| (format!("{:02}:00", (now - chrono::Duration::hours(23 - i)).hour()), 0.)).collect(),
        Range::M12 => (0..12)
            .map(|i| {
                let m = now.month0() as i32 - (11 - i);
                let (y, m) = (now.year() + m.div_euclid(12), m.rem_euclid(12) as usize);
                (format!("{} 01", MONTHS_SHORT[m]), 0. + 0. * y as f64)
            })
            .collect(),
        _ => {
            let days = if range == Range::All { 90 } else { range.days().unwrap_or(30) };
            (0..days).map(|i| (format_axis_day(&day_key(now - chrono::Duration::days(days - 1 - i))), 0.)).collect()
        }
    }
}

fn dominant_currency(g: &Grid) -> String {
    let mut counts: std::collections::HashMap<String, usize> = Default::default();
    for r in &g.rows {
        let c = g.get(r, "currency").to_uppercase();
        if !c.is_empty() {
            *counts.entry(c).or_default() += 1;
        }
    }
    let mut best = ("USD".to_string(), 0);
    for (c, n) in counts {
        if n > best.1 {
            best = (c, n);
        }
    }
    best.0
}

fn time_ago_short(v: &str) -> String {
    let Some(t) = ui::parse_ts(v) else { return "—".into() };
    let m = (chrono::Local::now() - t).num_minutes().max(0);
    if m < 1 {
        "just now".into()
    } else if m < 60 {
        format!("{m}m ago")
    } else if m / 60 < 24 {
        format!("{}h ago", m / 60)
    } else if m / 1440 < 30 {
        format!("{}d ago", m / 1440)
    } else if m / 43200 < 12 {
        format!("{}mo ago", m / 43200)
    } else {
        format!("{}y ago", m / 518400)
    }
}

pub const CHART_ACCENT: u32 = 0x5b8cff;

/// recharts `AreaChart` stand-in: dashed vertical grid, filled area + 2px line.
fn area_chart(values: Vec<f64>, height: f32, grid: gpui::Hsla) -> AnyElement {
    let accent: gpui::Hsla = gpui::rgb(CHART_ACCENT).into();
    canvas(
        |_, _, _| {},
        move |bounds: Bounds<Pixels>, _, window, _| {
            let n = values.len().max(2);
            let max = values.iter().cloned().fold(0., f64::max).max(1e-9);
            let w = f32::from(bounds.size.width);
            let h = f32::from(bounds.size.height) - 4.;
            let x = |i: usize| bounds.origin.x + px(w * i as f32 / (n - 1) as f32);
            let y = |v: f64| bounds.origin.y + px(4. + h * (1. - (v / max) as f32));
            for k in 0..=6 {
                let gx = bounds.origin.x + px(w * k as f32 / 6.);
                let mut b = PathBuilder::stroke(px(1.)).dash_array(&[px(4.), px(4.)]);
                b.move_to(point(gx, bounds.origin.y));
                b.line_to(point(gx, bounds.origin.y + bounds.size.height));
                if let Ok(p) = b.build() {
                    window.paint_path(p, grid);
                }
            }
            let pts: Vec<_> = (0..n).map(|i| point(x(i), y(values.get(i).copied().unwrap_or(0.)))).collect();
            let mut fill = PathBuilder::fill();
            fill.move_to(point(x(0), bounds.origin.y + bounds.size.height));
            for p in &pts {
                fill.line_to(*p);
            }
            fill.line_to(point(x(n - 1), bounds.origin.y + bounds.size.height));
            fill.close();
            if let Ok(p) = fill.build() {
                window.paint_path(p, with_alpha(accent, 0.15));
            }
            let mut line = PathBuilder::stroke(px(2.));
            line.move_to(pts[0]);
            for p in &pts[1..] {
                line.line_to(*p);
            }
            if let Ok(p) = line.build() {
                window.paint_path(p, accent);
            }
        },
    )
    .w_full()
    .h(px(height))
    .into_any_element()
}

fn metric_card(label: &str, value: String, range_label: &str, values: Vec<f64>, chart_h: f32, big: bool, axis: Option<(String, String)>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex_1()
        .min_w_0()
        .tw_rounded_xl()
        .border_1()
        .border_color(with_alpha(t.border, 0.7))
        .bg(with_alpha(t.card, 0.4))
        .p_5()
        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(label.to_string()))
        .child(div().mt_2().text_size(px(36.)).line_height(px(40.)).font_weight(FontWeight::SEMIBOLD).child(rexa_ui::tight(value)))
        .child(div().mt_2().flex().items_center().gap(px(6.)).tw_text_xs().text_color(t.muted_foreground).child(div().size_2().rounded_full().border_2().border_color(gpui::rgb(CHART_ACCENT))).child(range_label.to_string()))
        .child(div().mt_3().child(area_chart(values, chart_h, with_alpha(t.border, if big { 0.6 } else { 0.5 }))))
        .children(axis.map(|(a, b)| div().flex().justify_between().pt_1().text_size(px(11.)).text_color(t.muted_foreground).child(a).child(b)))
        .into_any_element()
}

#[derive(Default)]
struct RevenueData {
    invoices: Grid,
    kpis: Grid,
    mrr: Option<f64>,
    revenue_daily: Vec<(String, f64, f64)>,
    mrr_daily: Vec<(String, f64)>,
    active_daily: Vec<(String, f64)>,
    checkouts_daily: Vec<(String, f64)>,
    cancels_daily: Vec<(String, f64)>,
    customers: Grid,
    webhooks: Grid,
    missing: bool,
    error: Option<String>,
}

pub struct RevenueView {
    session: Arc<Session>,
    data: RevenueData,
    loading: bool,
    range: Range,
    timeline_all: bool,
    metrics: Vec<&'static str>,
    table: Entity<TableState>,
}

const METRICS: [(&str, &str); 6] = [("revenue", "Revenue"), ("mrr", "Monthly Recurring Revenue"), ("active", "Active Subscriptions"), ("orders", "Orders"), ("checkouts", "Checkouts"), ("cancellations", "Cancellations")];

impl RevenueView {
    fn new(session: Arc<Session>, cx: &mut Context<Self>) -> Self {
        let table = cx.new(|_| TableState::default());
        cx.observe(&table, |_, _, cx| cx.notify()).detach();
        // `rexadb-revenue-metrics:<connection string>` (per connection).
        let key = format!("rexadb-revenue-metrics:{}", session.connection.connection_string);
        let saved = rexa_store::Store::open().ok().and_then(|s| s.setting(&key).ok().flatten()).or_else(|| rexa_store::WebStore::open()?.get(&key).ok().flatten());
        let metrics: Vec<&'static str> = saved.and_then(|r| serde_json::from_str::<Vec<String>>(&r).ok()).map(|v| METRICS.iter().map(|(id, _)| *id).filter(|id| v.iter().any(|x| x == id)).collect::<Vec<_>>()).filter(|v| !v.is_empty()).unwrap_or_else(|| vec!["revenue", "mrr", "active", "orders", "checkouts"]);
        let mut this = Self { session, data: RevenueData::default(), loading: true, range: Range::D30, timeline_all: false, metrics, table };
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let d = self.session.driver.clone();
        ui::run(
            cx,
            async move {
                let qs = [q_invoices(), q_kpis(), q_mrr(), q_revenue_daily(), q_mrr_daily(), q_active_daily(), q_checkouts_daily(), q_cancels_daily(), q_recent_customers(), q_webhooks()];
                let mut out = vec![];
                for q in qs {
                    out.push(query_paykit(d.clone(), q).await);
                }
                Ok(out)
            },
            |this, r, _| {
                this.loading = false;
                let Ok(r) = r else { return };
                let day = |g: &Grid, row: &[String]| g.get(row, "day").chars().take(10).collect::<String>();
                let num = |g: &Grid, row: &[String], k: &str| g.get(row, k).parse::<f64>().unwrap_or(0.);
                let series = |res: &PaykitResult, k: &str| res.grid.rows.iter().map(|row| (day(&res.grid, row), num(&res.grid, row, k))).collect::<Vec<_>>();
                this.data = RevenueData {
                    invoices: r[0].grid.clone(),
                    kpis: r[1].grid.clone(),
                    mrr: r[2].grid.rows.first().and_then(|row| r[2].grid.get(row, "mrr_cents").parse().ok()),
                    revenue_daily: r[3].grid.rows.iter().map(|row| (day(&r[3].grid, row), num(&r[3].grid, row, "cents"), num(&r[3].grid, row, "orders"))).collect(),
                    // The original maps the MRR KPI rows here (a quirk kept as-is).
                    mrr_daily: series(&r[2], "cents"),
                    active_daily: series(&r[5], "subs"),
                    checkouts_daily: series(&r[6], "checkouts"),
                    cancels_daily: series(&r[7], "cancels"),
                    customers: r[8].grid.clone(),
                    webhooks: r[9].grid.clone(),
                    missing: r[0].missing || r[1].missing,
                    error: r.iter().find(|x| !x.missing && x.error.is_some()).and_then(|x| x.error.clone()),
                };
            },
        );
    }
}

impl Render for RevenueView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let now = chrono::Local::now();
        let range = self.range;
        let pills = div()
            .flex()
            .items_center()
            .gap_2()
            .child(div().flex().items_center().gap(px(2.)).rounded_full().bg(with_alpha(t.muted, 0.6)).p_1().children(Range::ALL.iter().enumerate().map(|(i, (r, label))| {
                let r = *r;
                let active = r == range;
                div()
                    .id(("rng", i))
                    .h_7()
                    .flex()
                    .items_center()
                    .rounded_full()
                    .px_3()
                    .tw_text_xs()
                    .cursor_pointer()
                    .when(active, |d| d.bg(t.card).font_weight(FontWeight::MEDIUM).text_color(t.foreground).shadow_sm())
                    .when(!active, |d| d.text_color(t.muted_foreground).hover(|d| d.text_color(t.foreground)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.range = r;
                        cx.notify();
                    }))
                    .child(*label)
            })))
            .child(Button::new("rev-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))))
            .into_any_element();
        let body: AnyElement = if self.loading {
            view_loading()
        } else if self.data.missing {
            setup_cta(cx)
        } else {
            let d = &self.data;
            let currency = dominant_currency(&d.invoices);
            let range_label = format_range_label(range, now);
            let rev: Vec<(String, f64)> = d.revenue_daily.iter().map(|(day, c, _)| (day.clone(), c / 100.)).collect();
            let mut hero = filter_range(&rev, range, now);
            if hero.is_empty() {
                hero = empty_series(range, now);
            } else {
                hero = hero.into_iter().map(|(day, v)| (format_axis_day(&day), v)).collect();
            }
            let hero_total: f64 = hero.iter().map(|(_, v)| v).sum();
            let axis = (hero.first().map(|p| p.0.clone()).unwrap_or_default(), hero.last().map(|p| p.0.clone()).unwrap_or_default());
            let spark = |s: &[(String, f64)]| {
                let f = filter_range(s, range, now);
                if f.is_empty() { empty_series(range, now) } else { f }
            };
            let kpi = |k: &str| d.kpis.rows.first().map(|r| d.kpis.get(r, k).to_string()).unwrap_or_default();
            let mut minis: Vec<AnyElement> = vec![];
            for id in &self.metrics {
                let label = METRICS.iter().find(|(m, _)| m == id).map(|(_, l)| *l).unwrap_or("");
                let (value, series): (String, Vec<(String, f64)>) = match *id {
                    "mrr" => (d.mrr.map(|m| format_money(Some(m), &currency)).unwrap_or_else(|| "—".into()), spark(&d.mrr_daily.iter().map(|(a, b)| (a.clone(), b / 100.)).collect::<Vec<_>>())),
                    "active" => (if kpi("active_subs").is_empty() { "0".into() } else { kpi("active_subs") }, spark(&d.active_daily)),
                    "orders" => {
                        let s = spark(&d.revenue_daily.iter().map(|(a, _, o)| (a.clone(), *o)).collect::<Vec<_>>());
                        (format!("{}", s.iter().map(|p| p.1).sum::<f64>()), s)
                    }
                    "checkouts" => {
                        let s = spark(&d.checkouts_daily);
                        (format!("{}", s.iter().map(|p| p.1).sum::<f64>()), s)
                    }
                    "cancellations" => {
                        let s = spark(&d.cancels_daily);
                        (format!("{}", s.iter().map(|p| p.1).sum::<f64>()), s)
                    }
                    _ => continue,
                };
                minis.push(metric_card(label, value, &range_label, series.into_iter().map(|p| p.1).collect(), 110., false, None, cx));
            }
            let mini_rows: Vec<AnyElement> = minis.chunks_mut(2).map(|c| div().flex().gap_3().children(c.iter_mut().map(|e| std::mem::replace(e, div().into_any_element()))).into_any_element()).collect();
            // Monthly bars (last 3 months).
            use chrono::Datelike;
            let mut buckets: std::collections::HashMap<String, f64> = Default::default();
            for (day, c, _) in &d.revenue_daily {
                *buckets.entry(day.chars().take(7).collect()).or_default() += c;
            }
            let months: Vec<(String, String, f64)> = [2, 1, 0]
                .iter()
                .map(|back| {
                    let m = now.month0() as i32 - back;
                    let (y, m) = (now.year() + m.div_euclid(12), m.rem_euclid(12) as usize);
                    let key = format!("{y}-{:02}", m + 1);
                    let cents = buckets.get(&key).copied().unwrap_or(0.);
                    (MONTHS_LONG[m].to_string(), format_money(Some(cents), &currency), cents / 100.)
                })
                .collect();
            let max = months.iter().map(|m| m.2).fold(0., f64::max);
            let card = || div().flex_1().min_w_0().h(px(360.)).overflow_hidden().flex().flex_col().tw_rounded_xl().border_1().border_color(with_alpha(t.border, 0.7)).bg(with_alpha(t.card, 0.4)).p_5();
            let bars = card()
                .child(div().flex().items_baseline().justify_between().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Revenue")).child(div().tw_text_xs().text_color(t.muted_foreground).child("Last 3 Months")))
                .child(div().flex_1().min_h(px(176.)).flex().items_end().gap_6().px_4().pt_3().border_b_1().border_dashed().border_color(with_alpha(t.border, 0.6)).children(months.iter().map(|m| {
                    let top = m.2 > 0. && m.2 == max;
                    div().flex_1().rounded(px(8.)).h(gpui::relative(if max > 0. { (m.2 / max) as f32 } else { 0. }.max(0.02))).bg(if top { gpui::rgb(CHART_ACCENT).into() } else { with_alpha(t.muted, 0.5) })
                })))
                .child(div().flex().gap_2().children(months.iter().map(|m| div().flex_1().child(div().tw_text_xs().child(m.0.clone())).child(div().tw_text_xs().text_color(t.muted_foreground).child(m.1.clone())))));
            // Timeline.
            let mut items: Vec<(i64, String, String, String, IconName)> = vec![];
            for r in &d.webhooks.rows {
                let ty = d.webhooks.get(r, "type");
                let pretty = ty.split(['.', '_']).map(|w| { let mut c = w.chars(); c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default() }).collect::<Vec<_>>().join(" ");
                let at = d.webhooks.get(r, "received_at");
                items.push((ui::parse_ts(at).map(|x| x.timestamp_millis()).unwrap_or(0), time_ago_short(at), if pretty.is_empty() { "Webhook event".into() } else { pretty }, d.webhooks.get(r, "status").to_string(), IconName::Diamond));
            }
            if self.timeline_all {
                for r in &d.customers.rows {
                    let at = d.customers.get(r, "created_at");
                    let sub = [d.customers.get(r, "name"), d.customers.get(r, "email")].into_iter().find(|s| !s.is_empty()).unwrap_or("").to_string();
                    items.push((ui::parse_ts(at).map(|x| x.timestamp_millis()).unwrap_or(0), time_ago_short(at), "Customer Created".into(), sub, IconName::User));
                }
                for r in &d.invoices.rows {
                    if d.invoices.get(r, "status") != "paid" {
                        continue;
                    }
                    let at = d.invoices.get(r, "created_at");
                    let cur = d.invoices.get(r, "currency");
                    items.push((ui::parse_ts(at).map(|x| x.timestamp_millis()).unwrap_or(0), time_ago_short(at), "Order Paid".into(), format_money(d.invoices.get(r, "amount").parse().ok(), if cur.is_empty() { &currency } else { cur }), IconName::ShoppingBag));
                }
            }
            items.retain(|i| i.0 > 0);
            items.sort_by(|a, b| b.0.cmp(&a.0));
            items.truncate(12);
            let all = self.timeline_all;
            let seg = div().flex().items_center().gap(px(2.)).rounded_full().bg(with_alpha(t.muted, 0.6)).p(px(2.)).children([(false, "System"), (true, "All")].into_iter().map(|(v, l)| {
                let active = v == all;
                div()
                    .id(SharedString::from(format!("tl-{l}")))
                    .h_6()
                    .flex()
                    .items_center()
                    .rounded_full()
                    .px(px(10.))
                    .text_size(px(11.))
                    .cursor_pointer()
                    .when(active, |d| d.bg(t.card).font_weight(FontWeight::MEDIUM).shadow_sm())
                    .when(!active, |d| d.text_color(t.muted_foreground))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.timeline_all = v;
                        cx.notify();
                    }))
                    .child(l)
            }));
            let timeline = card().child(div().flex().items_center().justify_between().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Timeline")).child(seg)).child(
                div().id("tl-list").mt_3().flex_1().min_h_0().overflow_y_scroll().flex().flex_col().gap_4().when(items.is_empty(), |d| d.child(div().py_6().text_center().tw_text_xs().text_color(t.muted_foreground).child("No events yet."))).children(items.into_iter().map(|(_, ago, title, sub, icon)| {
                    div()
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(div().size_8().flex_shrink_0().flex().items_center().justify_center().rounded_full().bg(with_alpha(t.muted, 0.6)).child(Icon::new(icon).size(px(14.)).text_color(t.muted_foreground)))
                        .child(div().flex_1().min_w_0().child(div().truncate().tw_text_xs().font_weight(FontWeight::MEDIUM).child(title)).child(div().truncate().text_size(px(11.)).text_color(t.muted_foreground).child(sub)))
                        .child(div().flex_shrink_0().text_size(px(11.)).text_color(t.muted_foreground).child(ago))
                })),
            );
            let collected = format_money(Some(kpi("paid_total").parse().unwrap_or(0.)), &currency);
            let balance = card()
                .child(div().flex().items_baseline().justify_between().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Available balance")).child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(collected)))
                .child(div().mt_3().tw_text_xs().text_color(t.muted_foreground).child("Collected revenue settles through Stripe payouts. Payout timing depends on your Stripe account schedule."))
                .child(div().mt_3().child(Button::new("rev-stripe").outline().size(ButtonSize::Sm).icon(IconName::Zap).label("Open Stripe payouts").on_click(|_, _, cx| cx.open_url("https://dashboard.stripe.com/balance"))));
            let inv = &d.invoices;
            let invoices: AnyElement = if inv.rows.is_empty() {
                empty("No invoices yet. Paid and failed invoices land here via webhooks.", cx)
            } else {
                let rows = inv.rows.iter().enumerate().map(|(i, r)| {
                    let url = inv.get(r, "hosted_url").to_string();
                    Row::new(i.to_string())
                        .cell(cell_text(inv.get(r, "customer_email"), false, cx))
                        .cell(status_badge(inv.get(r, "status")))
                        .cell(cell_text(&format_money(inv.get(r, "amount").parse().ok(), inv.get(r, "currency")), false, cx))
                        .cell(cell_text(&ui::date_locale(inv.get(r, "period_end_at")), false, cx))
                        .cell(if url.is_empty() { cell_text("", false, cx) } else { div().id(SharedString::from(format!("rcpt-{i}"))).text_color(t.primary).cursor_pointer().hover(|d| d.underline()).on_click(move |_, _, cx| cx.open_url(&url)).child("Open").into_any_element() })
                });
                DataTable::new("pay-invoices", &self.table).columns([Column::new("customer", "Customer"), Column::new("status", "Status"), Column::new("amount", "Amount"), Column::new("end", "Period end"), Column::new("receipt", "Receipt")]).rows(rows).into_any_element()
            };
            div()
                .flex()
                .flex_col()
                .gap_4()
                .children(d.error.clone().map(|e| view_error(&e, cx)))
                .child(metric_card("Revenue", format_money(Some((hero_total * 100.).round()), &currency), &range_label, hero.iter().map(|p| p.1).collect(), 260., true, Some(axis), cx))
                .children(mini_rows)
                .child(div().flex().gap_3().child(bars).child(timeline).child(balance))
                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Invoices"))
                .child(invoices)
                .into_any_element()
        };
        shell("Overview", Some("Revenue, subscriptions and payouts."), Some(pills), None, body, cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money() {
        assert_eq!(format_money(Some(123456.), "usd"), "$1,234.56");
        assert_eq!(format_money(Some(500.), "EUR"), "€5.00");
        assert_eq!(format_money(None, "usd"), "—");
        assert_eq!(format_money(Some(100.), "SEK"), "SEK\u{a0}1.00");
    }

    #[test]
    fn missing_schema() {
        assert!(is_missing_table("relation \"paykit.customer\" does not exist"));
        assert!(is_missing_table("schema \"paykit\" does not exist"));
        assert!(!is_missing_table("permission denied"));
    }

    #[test]
    fn drafts_roundtrip_smoke() {
        // Full FeatureDraft / validation coverage lives in drafts::tests.
        let d: DraftState = serde_json::from_str(r#"{"version":1,"features":[{"id":"msgs","type":"boolean"}],"plans":[{"id":"pro","name":"Pro","group":"base","priceAmount":29,"priceInterval":"month","includes":[]}],"updatedAt":1}"#).unwrap();
        assert_eq!(d.features[0].feature_type, "boolean");
        assert_eq!(format_plan_price(&d.plans[0]).0, "$29.00 USD");
        assert!(validate_drafts(&d).is_empty());
    }

    #[test]
    fn axis_and_ranges() {
        assert_eq!(format_axis_day("2026-11-05"), "Nov 05");
        let now = chrono::Local::now();
        assert_eq!(empty_series(Range::Today, now).len(), 24);
        assert_eq!(empty_series(Range::M12, now).len(), 12);
        assert_eq!(empty_series(Range::D30, now).len(), 30);
        assert_eq!(format_range_label(Range::All, now), "All time");
    }
}
