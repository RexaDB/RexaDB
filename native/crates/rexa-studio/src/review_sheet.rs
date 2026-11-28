//! Port of components/studio/review-sheet.tsx for the studio-level `pendingActions`
//! (`rexa_core::review`, filled by `addReviewAction` in review mode): grouped
//! actions with their SQL, remove per action, Clear All, Commit Changes
//! (`handleCommitChanges` runs them in one transaction). Table cell edits keep
//! their own per-tab review sheet in rexa-grid.

use crate::studio::Studio;
use gpui::{div, prelude::*, px, AnyElement, Context, FontWeight};
use rexa_core::review;
use rexa_ui::{with_alpha, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, Toast, Tw};

impl Studio {
    fn commit_review(&mut self, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        let actions = review::actions(cx);
        if actions.is_empty() || self.review_committing {
            return;
        }
        self.review_committing = true;
        cx.notify();
        let statements: Vec<String> = actions.iter().map(|a| a.sql.trim().trim_end_matches(';').to_string()).collect();
        let driver = session.driver.clone();
        let task = rexa_core::runtime::spawn(async move { driver.transaction(&statements).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.review_committing = false;
                match result {
                    Ok(_) => {
                        review::clear(cx);
                        review::set_open(false, cx);
                        Toast::success("Changes committed successfully").show(cx);
                        rexa_core::emit_studio(rexa_core::StudioEvent::SchemaChanged, cx);
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

    pub(crate) fn render_review_sheet(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !review::is_open(cx) {
            return None;
        }
        let t = cx.tokens().clone();
        let actions = review::actions(cx);
        let total = actions.len();
        let mut groups: Vec<(String, Vec<review::ReviewAction>)> = Vec::new();
        for a in actions {
            match groups.iter_mut().find(|(k, _)| *k == a.kind) {
                Some((_, v)) => v.push(a),
                None => groups.push((a.kind.clone(), vec![a])),
            }
        }
        let fmt = |k: &str| k.split('_').filter(|w| !w.is_empty()).map(|w| w[..1].to_uppercase() + &w[1..]).collect::<Vec<_>>().join(" ");
        let mut body = div().p_4().flex().flex_col().gap_4();
        if total > 0 {
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(div().flex().items_center().justify_between().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Actions")).child(Badge::new(total.to_string()).variant(BadgeVariant::Secondary)))
                    .children(groups.into_iter().map(|(k, list)| {
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(div().flex().items_center().justify_between().tw_text_xs().child(div().font_weight(FontWeight::MEDIUM).child(fmt(&k))).child(Badge::new(list.len().to_string()).variant(BadgeVariant::Outline)))
                            .children(list.into_iter().map(|a| {
                                let id = a.id;
                                div()
                                    .p_2()
                                    .rounded(px(4.))
                                    .border_1()
                                    .border_color(t.border)
                                    .bg(with_alpha(t.muted, 0.5))
                                    .tw_text_xs()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(
                                        div()
                                            .flex()
                                            .items_start()
                                            .justify_between()
                                            .gap_2()
                                            .child(div().flex_1().text_color(t.muted_foreground).child(a.description.clone()))
                                            .child(Button::new(("review-rm", id as usize)).ghost().size(ButtonSize::IconXs).icon(IconName::X).on_click(move |_, _, cx| review::remove(id, cx))),
                                    )
                                    .child(div().p_1().rounded(px(4.)).bg(with_alpha(t.background, 0.5)).font_family(rexa_ui::MONO).text_size(px(10.)).child(a.sql.clone()))
                            }))
                    })),
            );
        } else {
            body = body.child(div().text_center().py_8().tw_text_sm().text_color(t.muted_foreground).child("No pending changes"));
        }
        let committing = self.review_committing;
        let header = div()
            .flex()
            .h_9()
            .flex_shrink_0()
            .items_center()
            .justify_between()
            .border_b_1()
            .border_color(t.border)
            .pl_3()
            .pr_2()
            .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{total} pending change{}", if total != 1 { "s" } else { "" })))
            .child(Button::new("review-close").ghost().size(ButtonSize::IconSm).icon(IconName::X).on_click(|_, _, cx| review::set_open(false, cx)));
        let footer = div()
            .flex()
            .justify_end()
            .gap_2()
            .border_t_1()
            .border_color(t.border)
            .px_3()
            .py_2()
            .child(Button::new("review-clear").outline().size(ButtonSize::Sm).icon(IconName::Trash).label("Clear All").disabled(total == 0 || committing).on_click(|_, _, cx| review::clear(cx)))
            .child(
                Button::new("review-commit")
                    .size(ButtonSize::Sm)
                    .icon(if committing { IconName::LoaderCircle } else { IconName::Check })
                    .label("Commit Changes")
                    .disabled(total == 0 || committing)
                    .on_click(cx.listener(|this, _, _, cx| this.commit_review(cx))),
            );
        Some(
            div()
                .id("studio-review-sheet")
                .absolute()
                .top_0()
                .right_0()
                .bottom_0()
                .w(px(420.))
                .flex()
                .flex_col()
                .bg(t.background)
                .text_color(t.foreground)
                .border_l_1()
                .border_color(t.border)
                .shadow(rexa_ui::popup::shadow_lg())
                .occlude()
                .child(header)
                .child(div().id("studio-review-body").flex_1().min_h_0().overflow_y_scroll().child(body))
                .child(footer)
                .into_any_element(),
        )
    }
}
