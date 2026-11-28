//! Port of components/studio/request-query-approval-dialog.tsx and the
//! trigger in sql-editor.tsx: on a `workspace:` connection whose error says
//! the role is "Read & Request", offer to submit the query for approval.
//!
//! The submit call (`POST /connections/{id}/pending-queries` on the studio
//! API) belongs to the workspace backend: it installs a submitter with
//! [`set_pending_query_submitter`]. Without one, Submit shows the error toast
//! the original shows when the request fails.

use anyhow::Result;
use gpui::{div, prelude::*, px, App, Context, FontWeight, Global, Task, Window};
use gpui_component::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Badge, BadgeVariant, Button, Dialog, IconName, Select, SelectOption, Tw, MONO};
use std::rc::Rc;

#[derive(Clone, Debug)]
pub struct PendingQueryRequest {
    /// Workspace connection id (`connectionString` without `workspace:`).
    pub connection_id: String,
    pub sql: String,
    pub team_id: Option<i64>,
}

pub trait PendingQuerySubmitter {
    /// Returns the pending query's id (`res.data.id`).
    fn submit(&self, request: PendingQueryRequest, cx: &mut App) -> Task<Result<i64>>;
}

struct Submitter(Rc<dyn PendingQuerySubmitter>);
impl Global for Submitter {}

pub fn set_pending_query_submitter(s: Rc<dyn PendingQuerySubmitter>, cx: &mut App) {
    cx.set_global(Submitter(s));
}

/// `wsConnectionId`
pub fn workspace_connection_id(connection_string: &str) -> Option<String> {
    connection_string.strip_prefix("workspace:").map(str::to_string)
}

/// The error test in sql-editor.tsx's approval effect.
pub fn is_read_and_request_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("read_and_request")
        || lower.contains("read and request")
        || lower.contains("write query not allowed")
        || (lower.contains("read") && lower.contains("request"))
}

pub fn open_request_approval_dialog(
    connection_id: String,
    connection_name: String,
    sql: String,
    team_options: Vec<(i64, String)>,
    cx: &mut App,
) {
    let content = cx.new(|_| RequestQueryApproval {
        connection_id,
        connection_name,
        team_id: (team_options.len() == 1).then(|| team_options[0].0),
        sql,
        team_options,
        submitting: false,
        submitted_id: None,
    });
    rexa_ui::open_dialog(cx, move |_, cx| {
        let title = if content.read(cx).submitted_id.is_some() { "Query Submitted" } else { "Request Query Approval" };
        Dialog::new().max_w(480.).title(title).child(content.clone())
    });
}

struct RequestQueryApproval {
    connection_id: String,
    connection_name: String,
    sql: String,
    team_options: Vec<(i64, String)>,
    team_id: Option<i64>,
    submitting: bool,
    submitted_id: Option<i64>,
}

impl RequestQueryApproval {
    fn submit(&mut self, cx: &mut Context<Self>) {
        let Some(s) = cx.try_global::<Submitter>().map(|g| g.0.clone()) else {
            rexa_ui::toast::error("Failed to submit query", cx);
            return;
        };
        self.submitting = true;
        cx.notify();
        let task = s.submit(PendingQueryRequest { connection_id: self.connection_id.clone(), sql: self.sql.clone(), team_id: self.team_id }, cx);
        cx.spawn(async move |this, cx| {
            let res = task.await;
            this.update(cx, |this, cx| {
                this.submitting = false;
                match res {
                    Ok(id) => {
                        this.submitted_id = Some(id);
                        rexa_ui::toast::success("Query submitted for approval", cx);
                    }
                    Err(e) => {
                        rexa_ui::toast::error(format!("{e:#}"), cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

impl Render for RequestQueryApproval {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let label = |s: &'static str| div().tw_text_xs().text_color(t.muted_foreground).child(s);
        let sql_box = |max_h: f32| {
            div()
                .id("approval-sql")
                .tw_rounded_lg()
                .bg(with_alpha(t.studio_bg, 0.5))
                .border_1()
                .border_color(t.studio_border)
                .p_3()
                .font_family(MONO)
                .tw_text_xs()
                .max_h(px(max_h))
                .overflow_y_scroll()
                .child(self.sql.clone())
        };

        if let Some(id) = self.submitted_id {
            return div()
                .flex()
                .flex_col()
                .gap_4()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(Icon::new(IconName::CircleCheck).size(px(16.)).text_color(tw("green-500")))
                        .child(div().tw_text_sm().text_color(t.muted_foreground).child(format!(
                            "Your query has been submitted for review (ID: {id}). An approver will review and execute it shortly."
                        ))),
                )
                .child(sql_box(96.))
                .child(
                    div()
                        .flex()
                        .justify_end()
                        .gap_2()
                        .child(Button::new("approval-close").ghost().label("Close").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("approval-team").icon(IconName::ArrowRight).label("Go to Team Page").on_click(|_, _, cx| {
                            rexa_ui::close_top(cx);
                            rexa_core::navigate(rexa_core::Route::Team, cx);
                        })),
                )
                .into_any_element();
        }

        let weak = cx.entity().downgrade();
        let mut options = vec![SelectOption::new("", "Any approver")];
        options.extend(self.team_options.iter().map(|(id, name)| SelectOption::new(id.to_string(), name.clone())));
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_1()
                    .tw_text_sm()
                    .text_color(t.muted_foreground)
                    .child("This connection has")
                    .child(Badge::new("Read & Request").variant(BadgeVariant::Outline))
                    .child("access. Write queries require approval before execution."),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(div().child(label("Connection")).child(div().mt(px(2.)).tw_text_sm().font_weight(FontWeight::MEDIUM).child(self.connection_name.clone())))
                    .when(!self.team_options.is_empty(), |d| {
                        d.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(label("Submit to team (optional)"))
                                .child(
                                    Select::new("approval-team-select")
                                        .w_full()
                                        .options(options)
                                        .value(Some(self.team_id.map(|i| i.to_string()).unwrap_or_default()))
                                        .on_change(move |v, _, cx| {
                                            weak.update(cx, |this, cx| {
                                                this.team_id = v.parse().ok();
                                                cx.notify();
                                            })
                                            .ok();
                                        }),
                                )
                                .child(div().text_size(px(10.)).text_color(t.muted_foreground).child("Route to a specific team's approval queue")),
                        )
                    })
                    .child(div().flex().flex_col().gap_1().child(label("Query")).child(sql_box(128.))),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(Button::new("approval-cancel").ghost().label("Cancel").disabled(self.submitting).on_click(|_, _, cx| rexa_ui::close_top(cx)))
                    .child(
                        Button::new("approval-submit")
                            .icon(if self.submitting { IconName::LoaderCircle } else { IconName::Send })
                            .label(if self.submitting { "Submitting..." } else { "Submit for Approval" })
                            .disabled(self.submitting)
                            .on_click(cx.listener(|this, _, _, cx| this.submit(cx))),
                    ),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_trigger() {
        assert!(is_read_and_request_error("permission: READ_AND_REQUEST role"));
        assert!(is_read_and_request_error("Write query not allowed for this connection"));
        assert!(!is_read_and_request_error("relation \"nope\" does not exist"));
        assert_eq!(workspace_connection_id("workspace:42").as_deref(), Some("42"));
        assert_eq!(workspace_connection_id("postgres://x"), None);
    }
}
