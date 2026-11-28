//! Ports of components/studio/database/{sessions-list,locks-list}.tsx: live
//! `pg_stat_activity` / `pg_locks` views with auto-refresh (15s / 10s), cancel /
//! terminate actions.
//!
//! Approximation: `toLocaleString()` of `query_start` is rendered from the
//! timestamp text as `M/D/YYYY, h:mm:ss AM` (server time zone, not converted).

use super::{fetch, ListBase, ListView};
use gpui::{div, prelude::*, px, AnyElement, Context, FontWeight, Hsla, SharedString, Window};
use rexa_core::{runtime, Session, TabSpec};
use rexa_drivers::Record;
use rexa_ui::widgets::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, Spinner, Toast, Tw, MONO};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq)]
pub enum ActivityKind {
    Sessions,
    Locks,
}

pub struct ActivityList {
    base: ListBase,
    kind: ActivityKind,
    rows: Vec<Record>,
    action_pid: Option<(i64, &'static str)>,
}

impl ListView for ActivityList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        cx.notify();
        let d = self.base.session.driver.clone();
        let kind = self.kind;
        let fut = runtime::spawn(async move {
            let r = match kind {
                ActivityKind::Sessions => d.sessions().await?,
                ActivityKind::Locks => d.locks().await?,
            };
            Ok(r.records())
        });
        fetch(cx, fut, |v: &mut Self, rows| v.rows = rows);
    }
}

/// `new Date(x).toLocaleString()` (en-US) from a timestamp string.
pub fn locale_datetime(s: &str) -> String {
    let s = s.trim();
    let (date, time) = match s.split_once(|c| c == ' ' || c == 'T') {
        Some(p) => p,
        None => return s.to_string(),
    };
    let d: Vec<&str> = date.split('-').collect();
    let tm: Vec<&str> = time.split(|c: char| c == ':' || c == '.' || c == '+' || c == 'Z').collect();
    if d.len() < 3 || tm.len() < 3 {
        return s.to_string();
    }
    let (Ok(h), Ok(m), Ok(sec)) = (tm[0].parse::<u32>(), tm[1].parse::<u32>(), tm[2].get(..2).unwrap_or(tm[2]).parse::<u32>()) else { return s.to_string() };
    let (ampm, h12) = if h >= 12 { ("PM", if h == 12 { 12 } else { h - 12 }) } else { ("AM", if h == 0 { 12 } else { h }) };
    let num = |x: &str| x.trim_start_matches('0').to_string();
    format!("{}/{}/{}, {}:{:02}:{:02} {}", num(d[1]), num(d[2]), d[0], h12, m, sec, ampm)
}

impl ActivityList {
    pub fn new(kind: ActivityKind, spec: TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let placeholder = match kind {
            ActivityKind::Sessions => "Search by PID, username, database, or query...",
            ActivityKind::Locks => "Search by PID, mode, relation, or query...",
        };
        let base = ListBase::new(spec, session, None, placeholder, window, cx);
        let mut this = ActivityList { base, kind, rows: Vec::new(), action_pid: None };
        this.load(cx);
        let every = if kind == ActivityKind::Sessions { 15 } else { 10 };
        cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(Duration::from_secs(every)).await;
            if this.update(cx, |v, cx| v.load(cx)).is_err() {
                break;
            }
        })
        .detach();
        this
    }

    fn act(&mut self, pid: i64, action: &'static str, cx: &mut Context<Self>) {
        self.action_pid = Some((pid, action));
        cx.notify();
        let d = self.base.session.driver.clone();
        let fut = runtime::spawn(async move {
            if action == "kill" {
                d.kill_session(pid).await
            } else {
                d.cancel_session_query(pid).await
            }
        });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.action_pid = None;
                match r {
                    Ok(()) => {
                        Toast::success(if action == "kill" { format!("Session {pid} terminated") } else { format!("Query on session {pid} cancelled") }).show(cx);
                        v.load(cx);
                    }
                    Err(e) => {
                        Toast::error(format!("{e:#}")).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn badge(text: impl Into<SharedString>, fg: Hsla, bg: Hsla, border: Option<Hsla>, mono: bool) -> gpui::Div {
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .h_4()
            .px(px(6.))
            .tw_rounded_md()
            .bg(bg)
            .text_color(fg)
            .tw_text_xs()
            .when(mono, |d| d.font_family(MONO).h_5())
            .when_some(border, |d, b| d.border_1().border_color(b))
            .child(text.into())
    }

    fn sessions_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let q = self.base.query(cx).to_lowercase();
        let studio_border = t.var_or("--studio-border", t.border);
        let rows: Vec<&Record> = self
            .rows
            .iter()
            .filter(|s| {
                s.string("query").to_lowercase().contains(&q) || s.string("username").to_lowercase().contains(&q) || s.string("database").to_lowercase().contains(&q) || s.string("pid").contains(&q)
            })
            .collect();
        if rows.is_empty() {
            return empty(IconName::Terminal, if q.is_empty() { "No active sessions found." } else { "No sessions matching your search." }, cx);
        }
        let state_color = |s: &str| -> (Hsla, Hsla) {
            match s {
                "active" => (tw("emerald-500"), with_alpha(tw("emerald-500"), 0.1)),
                "idle in transaction" => (tw("amber-500"), with_alpha(tw("amber-500"), 0.1)),
                "idle in transaction (aborted)" => (tw("red-500"), with_alpha(tw("red-500"), 0.1)),
                "fastpath function call" => (tw("blue-500"), with_alpha(tw("blue-500"), 0.1)),
                _ => (t.muted_foreground, with_alpha(t.muted, 0.3)),
            }
        };
        let total = self.rows.len();
        let mut list = div().flex().flex_col().gap_3();
        for s in rows {
            let pid: i64 = s.string("pid").parse().unwrap_or(0);
            let state = s.string("state");
            let (fg, bg) = state_color(&state);
            let busy = self.action_pid.map(|(p, _)| p) == Some(pid);
            let busy_kind = self.action_pid.filter(|(p, _)| *p == pid).map(|(_, k)| k);
            let query = s.string("query");
            let field = |label: &'static str, value: String, mono: bool| {
                div()
                    .min_w_0()
                    .flex_1()
                    .child(div().text_color(t.muted_foreground).child(label))
                    .child(div().font_weight(FontWeight::MEDIUM).text_color(t.foreground).truncate().when(mono, |d| d.font_family(MONO)).child(value))
            };
            let amber = tw("amber-500");
            let red = tw("red-500");
            list = list.child(
                div()
                    .bg(with_alpha(t.background, 0.4))
                    .border_1()
                    .border_color(studio_border)
                    .tw_rounded_lg()
                    .p_4()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .items_start()
                            .justify_between()
                            .gap_2()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .min_w_0()
                                    .child(div().font_family(MONO).tw_text_xs().font_weight(FontWeight::SEMIBOLD).flex_shrink_0().child(format!("PID {pid}")))
                                    .child(Self::badge(if state.is_empty() { "unknown".to_string() } else { state.clone() }, fg, bg, None, false))
                                    .when_some(s.non_empty("wait_event_type"), |d, w| d.child(Self::badge(format!("{w}: {}", s.string("wait_event")), amber, gpui::transparent_black(), Some(with_alpha(amber, 0.3)), false))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .flex_shrink_0()
                                    .child(
                                        Button::new(SharedString::from(format!("ses-cancel-{pid}")))
                                            .ghost()
                                            .size(ButtonSize::Xs)
                                            .colors(gpui::transparent_black(), with_alpha(amber, 0.1), amber)
                                            .disabled(busy)
                                            .child(if busy_kind == Some("cancel") { Spinner::new(12.).into_any_element() } else { Icon::new(IconName::Ban).size_3().into_any_element() })
                                            .on_click(cx.listener(move |v, _, _, cx| v.act(pid, "cancel", cx))),
                                    )
                                    .child(
                                        Button::new(SharedString::from(format!("ses-kill-{pid}")))
                                            .ghost()
                                            .size(ButtonSize::Xs)
                                            .colors(gpui::transparent_black(), with_alpha(red, 0.1), red)
                                            .disabled(busy)
                                            .child(if busy_kind == Some("kill") { Spinner::new(12.).into_any_element() } else { Icon::new(IconName::CircleX).size_3().into_any_element() })
                                            .on_click(cx.listener(move |v, _, _, cx| v.act(pid, "kill", cx))),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .tw_text_xs()
                            .child(field("User", s.string("username"), false))
                            .child(field("Database", s.string("database"), false))
                            .child(field("Client", s.non_empty("client_addr").unwrap_or_else(|| "local".into()), true))
                            .child(field("Started", s.non_empty("query_start").map(|q| locale_datetime(&q)).unwrap_or_else(|| "-".into()), false)),
                    )
                    .when(!query.is_empty(), |d| {
                        let shown = if query.chars().count() > 500 { format!("{}...", query.chars().take(500).collect::<String>()) } else { query.clone() };
                        d.child(
                            div()
                                .pt_1()
                                .child(div().tw_text_xs().text_color(t.muted_foreground).mb_1().child("Query"))
                                .child(div().tw_text_xs().font_family(MONO).bg(with_alpha(t.muted, 0.2)).p_2().tw_rounded_lg().max_h(px(80.)).overflow_hidden().text_color(with_alpha(t.foreground, 0.8)).child(shown)),
                        )
                    }),
            );
        }
        list.child(div().tw_text_xs().text_color(t.muted_foreground).text_center().pt_2().child(format!("Auto-refreshes every 15s \u{b7} {total} session{}", if total != 1 { "s" } else { "" })))
            .into_any_element()
    }

    fn locks_body(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let q = self.base.query(cx).to_lowercase();
        let studio_border = t.var_or("--studio-border", t.border);
        let filtered: Vec<&Record> = self
            .rows
            .iter()
            .filter(|l| {
                l.string("pid").contains(&q)
                    || l.string("mode").to_lowercase().contains(&q)
                    || l.string("locktype").to_lowercase().contains(&q)
                    || l.string("relation_name").to_lowercase().contains(&q)
                    || l.string("query").to_lowercase().contains(&q)
            })
            .collect();
        if filtered.is_empty() {
            return empty(IconName::Lock, if q.is_empty() { "No active locks." } else { "No locks matching your search." }, cx);
        }
        let mut groups: BTreeMap<i64, Vec<&Record>> = BTreeMap::new();
        for l in &filtered {
            groups.entry(l.string("pid").parse().unwrap_or(0)).or_default().push(l);
        }
        let red = tw("red-500");
        let amber = tw("amber-500");
        let green = tw("emerald-500");
        let mode_color = |mode: &str| -> Hsla {
            if ["AccessExclusiveLock", "ExclusiveLock", "RowExclusiveLock"].iter().any(|m| mode.contains(m)) {
                red
            } else if ["ShareLock", "ShareRowExclusiveLock", "ShareUpdateExclusiveLock"].iter().any(|m| mode.contains(m)) {
                amber
            } else {
                green
            }
        };
        let n_groups = groups.len();
        let total = self.rows.len();
        let mut list = div().flex().flex_col().gap_4();
        for (pid, locks) in groups {
            let first = locks[0];
            let blocked = locks.iter().any(|l| !l.bool("granted"));
            let busy = self.action_pid.map(|(p, _)| p) == Some(pid);
            let query = first.string("query");
            let mut lines = div().flex().flex_col();
            for (i, l) in locks.iter().enumerate() {
                let c = mode_color(&l.string("mode"));
                let granted = l.bool("granted");
                let target = l.non_empty("relation_name").or(l.non_empty("transactionid")).or(l.non_empty("virtualtransaction")).unwrap_or_else(|| "-".into());
                lines = lines.child(
                    div()
                        .px_3()
                        .py_2()
                        .flex()
                        .items_center()
                        .gap_3()
                        .tw_text_xs()
                        .when(i > 0, |d| d.border_t_1().border_color(with_alpha(studio_border, 0.3)))
                        .child(Self::badge(l.string("mode"), c, with_alpha(c, 0.1), Some(with_alpha(c, 0.3)), true))
                        .child(div().w(px(80.)).flex_shrink_0().font_family(MONO).text_color(t.muted_foreground).child(l.string("locktype")))
                        .child(div().flex_1().min_w_0().truncate().font_family(MONO).child(target))
                        .child(if granted { Self::badge("Granted", green, with_alpha(green, 0.1), None, false) } else { Self::badge("Waiting", red, with_alpha(red, 0.1), None, false) }),
                );
            }
            list = list.child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .when(blocked, |d| d.border_color(with_alpha(red, 0.3)).bg(with_alpha(red, 0.02)))
                    .when(!blocked, |d| d.border_color(studio_border).bg(with_alpha(t.background, 0.4)))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .p_3()
                            .border_b_1()
                            .border_color(with_alpha(studio_border, 0.5))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(div().font_family(MONO).tw_text_xs().font_weight(FontWeight::SEMIBOLD).child(format!("PID {pid}")))
                                    .when(blocked, |d| d.child(Self::badge("Blocked", red, with_alpha(red, 0.1), None, false)))
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} @ {}", first.string("usename"), first.non_empty("application_name").unwrap_or_else(|| "?".into())))),
                            )
                            .child(
                                Button::new(SharedString::from(format!("lock-kill-{pid}")))
                                    .ghost()
                                    .size(ButtonSize::Xs)
                                    .colors(gpui::transparent_black(), with_alpha(red, 0.1), red)
                                    .disabled(busy)
                                    .child(if busy { Spinner::new(12.).into_any_element() } else { Icon::new(IconName::Lock).size_3().into_any_element() })
                                    .child(div().ml_1().child("Kill"))
                                    .on_click(cx.listener(move |v, _, _, cx| v.act(pid, "kill", cx))),
                            ),
                    )
                    .child(lines)
                    .when(!query.is_empty(), |d| {
                        let shown = if query.chars().count() > 300 { format!("{}...", query.chars().take(300).collect::<String>()) } else { query.clone() };
                        d.child(div().px_3().py_2().border_t_1().border_color(with_alpha(studio_border, 0.3)).child(div().tw_text_xs().font_family(MONO).text_color(with_alpha(t.foreground, 0.6)).max_h(px(48.)).overflow_hidden().child(shown)))
                    }),
            );
        }
        list.child(div().tw_text_xs().text_color(t.muted_foreground).text_center().pt_2().child(format!(
            "Auto-refreshes every 10s \u{b7} {total} lock{} across {n_groups} session{}",
            if total != 1 { "s" } else { "" },
            if n_groups != 1 { "s" } else { "" }
        )))
        .into_any_element()
    }
}

fn empty(icon: IconName, text: &'static str, cx: &mut gpui::App) -> AnyElement {
    let t = cx.tokens();
    div()
        .py_12()
        .px_4()
        .flex()
        .flex_col()
        .items_center()
        .text_center()
        .border_2()
        .border_dashed()
        .border_color(t.var_or("--studio-border", t.border))
        .tw_rounded_lg()
        .child(Icon::new(icon).size_8().mb_3().text_color(with_alpha(t.muted_foreground, 0.2)))
        .child(div().tw_text_sm().text_color(t.muted_foreground).child(text))
        .into_any_element()
}

impl Render for ActivityList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let (title, desc, loading_text) = match self.kind {
            ActivityKind::Sessions => ("Sessions", "Active database sessions. Monitor and manage running queries.", "Loading sessions..."),
            ActivityKind::Locks => ("Locks", "Active database locks. Monitor blocking sessions and contention.", "Loading locks..."),
        };
        let body = if self.base.loading && self.rows.is_empty() {
            div().flex().items_center().justify_center().py_16().text_color(t.muted_foreground).child(Spinner::new(20.)).child(div().ml_2().child(loading_text)).into_any_element()
        } else if self.kind == ActivityKind::Sessions {
            self.sessions_body(cx)
        } else {
            self.locks_body(cx)
        };
        let blocked: Vec<&Record> = if self.kind == ActivityKind::Locks { self.rows.iter().filter(|l| !l.bool("granted")).collect() } else { Vec::new() };
        let banner = (!blocked.is_empty()).then(|| {
            let mut pids: Vec<String> = blocked.iter().map(|l| l.string("pid")).collect();
            pids.sort();
            pids.dedup();
            let red = tw("red-500");
            div()
                .flex()
                .items_center()
                .gap_2()
                .p_3()
                .bg(with_alpha(red, 0.05))
                .border_1()
                .border_color(with_alpha(red, 0.2))
                .tw_rounded_lg()
                .tw_text_xs()
                .text_color(red)
                .child(Icon::new(IconName::TriangleAlert).size_4().flex_shrink_0())
                .child(format!(
                    "{} blocked lock{} detected across {} session{}. Check for blocking chains.",
                    blocked.len(),
                    if blocked.len() != 1 { "s" } else { "" },
                    pids.len(),
                    if pids.len() != 1 { "s" } else { "" }
                ))
        });
        let loading = self.base.loading;
        div().id("activity-scroll").size_full().overflow_y_scroll().bg(t.studio_bg).text_color(t.foreground).child(
            div()
                .max_w(px(1152.))
                .mx_auto()
                .w_full()
                .p_8()
                .flex()
                .flex_col()
                .gap_8()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(div().flex().flex_col().gap_1().child(div().tw_text_sm().font_weight(FontWeight::BOLD).child(rexa_ui::tight(title))).child(div().tw_text_sm().text_color(t.muted_foreground).child(desc)))
                        .child(Button::new("activity-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(loading).on_click(cx.listener(|v, _, _, cx| v.load(cx)))),
                )
                .children(banner)
                .child(div().w_full().max_w(px(448.)).child(rexa_ui::TextInput::new(&self.base.search).h(40.).prefix(Icon::new(IconName::Search).size_4().text_color(with_alpha(t.muted_foreground, 0.5)))))
                .child(body),
        )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn locale() {
        assert_eq!(super::locale_datetime("2026-11-08 15:04:05.123+00"), "11/8/2026, 3:04:05 PM");
        assert_eq!(super::locale_datetime("2026-01-02T00:10:09Z"), "1/2/2026, 12:10:09 AM");
    }
}
