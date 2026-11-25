//! Connection analytics derived from the same persisted query history shown by
//! the Query History screen.

use crate::store::{HistoryEntry, SqlStore};
use gpui::{div, prelude::*, Context, FontWeight, Window};
use gpui_component::scroll::ScrollableElement;
use rexa_core::Session;
use rexa_ui::{ActiveTokens, Tw};
use std::{collections::BTreeMap, sync::Arc};

pub struct AnalyticsView {
    connection_name: String,
    history: Vec<HistoryEntry>,
}

impl AnalyticsView {
    pub fn new(session: Arc<Session>, _cx: &mut Context<Self>) -> Self {
        let history = SqlStore::open()
            .and_then(|store| store.history(session.connection.id))
            .unwrap_or_default()
            .into_iter()
            .rev()
            .collect();
        Self { connection_name: session.connection.name.clone(), history }
    }

    fn metric(label: &'static str, value: String, detail: String, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        div()
            .flex_1()
            .min_w_40()
            .rounded_md()
            .border_1()
            .border_color(t.border)
            .bg(t.card)
            .p_4()
            .flex()
            .flex_col()
            .gap_2()
            .child(div().tw_text_xs().text_color(t.muted_foreground).child(label))
            .child(div().text_size(gpui::px(24.)).font_weight(FontWeight::SEMIBOLD).child(value))
            .child(div().tw_text_xs().text_color(t.muted_foreground).child(detail))
    }
}

impl Render for AnalyticsView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let total = self.history.len();
        let successes = self.history.iter().filter(|entry| entry.status == "success").count();
        let errors = self.history.iter().filter(|entry| entry.status == "error").count();
        let average_ms = if total == 0 { 0 } else { self.history.iter().map(|entry| entry.duration).sum::<i64>() / total as i64 };
        let mut daily = BTreeMap::<String, usize>::new();
        for entry in &self.history {
            let day = chrono::DateTime::from_timestamp_millis(entry.executed_at)
                .map(|date| date.format("%b %-d").to_string())
                .unwrap_or_else(|| "Unknown date".into());
            *daily.entry(day).or_default() += 1;
        }
        let max_daily = daily.values().copied().max().unwrap_or(1);

        div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground)
            .child(div().px_5().py_4().border_b_1().border_color(t.border)
                .child(div().tw_text_lg().font_weight(FontWeight::SEMIBOLD).child("Connection Analytics"))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child(self.connection_name.clone())))
            .child(div().flex_1().overflow_y_scrollbar().p_5().flex().flex_col().gap_5()
                .child(div().flex().flex_wrap().gap_3()
                    .child(Self::metric("Queries recorded", total.to_string(), "All saved query history".into(), cx))
                    .child(Self::metric("Successful", successes.to_string(), if total == 0 { "No queries recorded".into() } else { format!("{:.1}% success rate", successes as f64 * 100. / total as f64) }, cx))
                    .child(Self::metric("Errors", errors.to_string(), "Failed query executions".into(), cx))
                    .child(Self::metric("Average duration", format!("{average_ms} ms"), "Across recorded executions".into(), cx)))
                .child(div().flex().flex_col().gap_3()
                    .child(div().font_weight(FontWeight::SEMIBOLD).child("Query activity"))
                    .when(daily.is_empty(), |el| el.child(div().rounded_md().border_1().border_color(t.border).p_4().tw_text_sm().text_color(t.muted_foreground).child("Run queries to start seeing connection activity.")))
                    .children(daily.into_iter().map(|(day, count)| {
                        let width = (count as f32 / max_daily as f32 * 100.).max(3.);
                        div().flex().items_center().gap_3()
                            .child(div().w_16().tw_text_xs().text_color(t.muted_foreground).child(day))
                            .child(div().flex_1().h_2().rounded_full().bg(t.muted).child(div().h_full().rounded_full().bg(t.accent).w(gpui::relative(width / 100.))))
                            .child(div().w_8().text_right().tw_text_xs().child(count.to_string()))
                    })))
                .child(div().flex().flex_col().gap_3()
                    .child(div().font_weight(FontWeight::SEMIBOLD).child("Recent queries"))
                    .when(self.history.is_empty(), |el| el.child(div().rounded_md().border_1().border_color(t.border).p_4().tw_text_sm().text_color(t.muted_foreground).child("No query history is available for this connection.")))
                    .children(self.history.iter().take(10).map(|entry| {
                        let status_color = if entry.status == "success" { t.var_or("--color-green-500", t.accent) } else { t.destructive };
                        let query = entry.query.lines().next().unwrap_or_default().trim().to_string();
                        div().flex().items_center().gap_3().border_b_1().border_color(t.border).py_2()
                            .child(div().w_2().h_2().rounded_full().bg(status_color))
                            .child(div().flex_1().min_w_0().truncate().font_family(rexa_ui::MONO).tw_text_xs().child(query))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} ms", entry.duration)))
                    }))))
    }
}
