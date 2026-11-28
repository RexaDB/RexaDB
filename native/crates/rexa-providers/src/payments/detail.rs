//! Port of `components/studio/payments/{product-detail,feature-detail}.tsx`
//! (plus the `PaykitProductIdentity` / `useCopyId` bits of `paykit-shared.tsx`).
//!
//! Child module of `plans` so it can read `PlansView`'s private state.
//! CSS notes: `lg:grid-cols-[minmax(0,1fr)_260px]` is rendered as a flex row
//! with a fixed 260px aside (the studio tab is always wider than `lg`);
//! `hover:underline` on the back link is emulated with a hover text decoration.

use super::super::drafts::{format_plan_price, is_paid, FeatureDraft, PlanDraft, PlanInclude};
use super::PlansView;
use gpui::{div, prelude::*, px, AnyElement, Context, FontWeight, SharedString};
use rexa_ui::widgets::Icon;
use rexa_ui::{tight, tw, with_alpha, ActiveTokens, Align, Button, ButtonSize, DropdownMenu, IconName, MenuItem, Select, SelectOption, Tokens, Tw, MONO};
use std::time::Duration;

/// `planPriceLabel`.
pub(super) fn plan_price_label(p: &PlanDraft) -> String {
    match format_plan_price(p) {
        (main, Some(sub)) => format!("{main} · {sub}"),
        (main, None) => main,
    }
}

fn include_for(f: &FeatureDraft) -> PlanInclude {
    if f.feature_type == "metered" {
        PlanInclude { feature_id: f.id.clone(), limit: Some(100.), reset: Some("month".into()) }
    } else {
        PlanInclude { feature_id: f.id.clone(), limit: None, reset: None }
    }
}

fn pill(label: &str, border: gpui::Hsla, bg: gpui::Hsla, fg: gpui::Hsla) -> gpui::Div {
    div()
        .flex_shrink_0()
        .rounded_full()
        .border_1()
        .border_color(border)
        .bg(bg)
        .px_2()
        .py(px(2.))
        .text_size(px(11.))
        .line_height(px(16.))
        .font_weight(FontWeight::MEDIUM)
        .text_color(fg)
        .child(label.to_string())
}

fn section_title(title: impl IntoElement) -> gpui::Div {
    div().tw_text_base().font_weight(FontWeight::SEMIBOLD).child(title)
}

fn dashed_empty(t: &Tokens) -> gpui::Div {
    div().tw_rounded_lg().border_1().border_dashed().border_color(t.border).px_3().py_8().text_center().tw_text_xs().text_color(t.muted_foreground)
}

fn detail_row(label: &str, value: String, mono: bool, t: &Tokens) -> AnyElement {
    div()
        .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child(label.to_string()))
        .child(div().mt(px(2.)).tw_text_xs().when(mono, |d| d.font_family(MONO)).child(value))
        .into_any_element()
}

impl PlansView {
    pub(super) fn back_to_list(&mut self, cx: &mut Context<Self>) {
        self.selected_product = None;
        self.selected_feature = None;
        self.add_feature_id = None;
        self.attach_open = false;
        self.attach_plan = None;
        cx.notify();
    }

    /// `removePlan` / `removeFeature`: also drop the selection when it pointed at the removed row.
    pub(super) fn remove_plan(&mut self, i: usize, cx: &mut Context<Self>) {
        if i >= self.drafts.plans.len() {
            return;
        }
        self.update(|d| {
            d.plans.remove(i);
        }, cx);
        match self.selected_product {
            Some(s) if s == i => self.back_to_list(cx),
            Some(s) if s > i => self.selected_product = Some(s - 1),
            _ => {}
        }
    }

    pub(super) fn remove_feature(&mut self, i: usize, cx: &mut Context<Self>) {
        if i >= self.drafts.features.len() {
            return;
        }
        self.update(|d| {
            d.features.remove(i);
        }, cx);
        match self.selected_feature {
            Some(s) if s == i => self.back_to_list(cx),
            Some(s) if s > i => self.selected_feature = Some(s - 1),
            _ => {}
        }
    }

    fn add_plan_feature(&mut self, plan: usize, feature_id: &str, cx: &mut Context<Self>) {
        let Some(feat) = self.drafts.features.iter().find(|f| f.id == feature_id).cloned() else { return };
        self.update(|d| {
            if let Some(p) = d.plans.get_mut(plan) {
                if !p.includes.iter().any(|x| x.feature_id == feat.id) {
                    p.includes.push(include_for(&feat));
                }
            }
        }, cx);
    }

    fn remove_plan_feature(&mut self, plan: usize, feature_id: &str, cx: &mut Context<Self>) {
        let fid = feature_id.to_string();
        self.update(|d| {
            if let Some(p) = d.plans.get_mut(plan) {
                p.includes.retain(|x| x.feature_id != fid);
            }
        }, cx);
    }

    /// `useCopyId`: copy, show a check for 1.5s.
    fn copy_id(&mut self, value: String, cx: &mut Context<Self>) {
        cx.write_to_clipboard(gpui::ClipboardItem::new_string(value.clone()));
        self.copied_id = Some(value.clone());
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(1500)).await;
            this.update(cx, |s, cx| {
                if s.copied_id.as_deref() == Some(value.as_str()) {
                    s.copied_id = None;
                    cx.notify();
                }
            })
            .ok();
        })
        .detach();
    }

    fn back_link(&self, label: &'static str, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        div()
            .id(SharedString::from(format!("pd-back-{label}")))
            .flex()
            .items_center()
            .gap_1()
            .self_start()
            .tw_text_sm()
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.primary)
            .cursor_pointer()
            .hover(|d| d.underline())
            .on_click(cx.listener(|this, _, _, cx| this.back_to_list(cx)))
            .child(Icon::new(IconName::ChevronLeft).size(px(16.)))
            .child(label)
            .into_any_element()
    }

    fn copy_id_row(&self, id_key: &'static str, label: &str, value: &str, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let copied = self.copied_id.as_deref() == Some(value) && !value.is_empty();
        let v = value.to_string();
        div()
            .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child(label.to_string()))
            .child(
                div()
                    .mt(px(2.))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .font_family(MONO)
                    .tw_text_xs()
                    .child(div().min_w_0().flex_1().truncate().child(value.to_string()))
                    .child(
                        div()
                            .id(id_key)
                            .size_6()
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .tw_rounded_md()
                            .cursor_pointer()
                            .text_color(t.muted_foreground)
                            .hover(|d| d.bg(t.accent).text_color(t.accent_foreground))
                            .on_click(cx.listener(move |this, _, _, cx| this.copy_id(v.clone(), cx)))
                            .child(if copied {
                                Icon::new(IconName::Check).size(px(12.)).text_color(tw("emerald-500"))
                            } else {
                                Icon::new(IconName::Copy).size(px(12.))
                            }),
                    ),
            )
            .into_any_element()
    }

    fn metadata_section(&self, t: &Tokens) -> AnyElement {
        div().flex().flex_col().gap_3().child(section_title("Metadata")).child(dashed_empty(t).child("No metadata")).into_any_element()
    }

    /// `ProductDetail`.
    pub(super) fn render_product_detail(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let Some(plan) = self.drafts.plans.get(index).cloned() else { return div().into_any_element() };
        let features = self.drafts.features.clone();
        let paid = is_paid(&plan);
        let (main, sub) = format_plan_price(&plan);
        let currency_code = plan.price_currency.as_deref().filter(|c| !c.is_empty()).unwrap_or("usd").to_uppercase();
        let billing = if paid { if plan.price_interval.as_deref() == Some("year") { "Yearly" } else { "Monthly" } } else { "—" };
        let is_default = plan.default == Some(true);
        let w = cx.entity().downgrade();

        let title = if !plan.name.is_empty() {
            plan.name.clone()
        } else if !plan.id.is_empty() {
            plan.id.clone()
        } else {
            "New product".into()
        };

        let header_menu = {
            let w = w.clone();
            DropdownMenu::new("pd-actions")
                .align(Align::End)
                .trigger(Button::new("pd-actions-btn").outline().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
                .menu(move |m, _, _| {
                    let (w1, w2) = (w.clone(), w.clone());
                    m.item(MenuItem::new("Duplicate").icon(IconName::Copy).on_select(move |_, cx| {
                        w1.update(cx, |s, cx| s.duplicate(index, cx)).ok();
                    }))
                    .item(MenuItem::new("Delete").icon(IconName::Trash).destructive().on_select(move |_, cx| {
                        w2.update(cx, |s, cx| s.remove_plan(index, cx)).ok();
                    }))
                })
        };

        let header = div()
            .flex()
            .items_start()
            .justify_between()
            .gap_3()
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_start()
                    .gap_3()
                    .child(
                        div()
                            .size(px(44.))
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(with_alpha(t.border, 0.7))
                            .bg(with_alpha(t.muted, 0.3))
                            .text_color(t.muted_foreground)
                            .child(Icon::new(IconName::Package).size(px(20.))),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap_2()
                                    .child(div().truncate().tw_text_xl().font_weight(FontWeight::SEMIBOLD).child(tight(title)))
                                    .child(if is_default {
                                        pill("Default", with_alpha(t.primary, 0.2), with_alpha(t.primary, 0.1), t.primary)
                                    } else {
                                        pill("Draft", t.border, with_alpha(t.muted, 0.4), t.muted_foreground)
                                    }),
                            )
                            .child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child(plan_price_label(&plan))),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(6.))
                    .child(
                        Button::new("pd-edit")
                            .outline()
                            .size(ButtonSize::Sm)
                            .label("Edit product")
                            .on_click(cx.listener(move |this, _, win, cx| this.open_product_sheet(Some(index), win, cx))),
                    )
                    .child(header_menu),
            );

        // Pricing table: Price | Billing | Features | Status | ⋯
        let cols = |d: gpui::Div| d.flex().items_center().gap_2();
        let col = |f: f32| div().flex_grow(f).flex_basis(px(0.)).min_w_0();
        let price_menu = {
            let w = w.clone();
            DropdownMenu::new("pd-price-actions")
                .align(Align::End)
                .trigger(Button::new("pd-price-btn").ghost().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
                .menu(move |m, _, _| {
                    let (w1, w2) = (w.clone(), w.clone());
                    m.item(MenuItem::new("Edit price").on_select(move |win, cx| {
                        w1.update(cx, |s, cx| s.open_product_sheet(Some(index), win, cx)).ok();
                    }))
                    .item(MenuItem::new("Remove price").icon(IconName::Trash).destructive().disabled(!paid).on_select(move |_, cx| {
                        w2.update(cx, |s, cx| {
                            s.update(|d| {
                                if let Some(p) = d.plans.get_mut(index) {
                                    p.price_amount = None;
                                }
                            }, cx)
                        })
                        .ok();
                    }))
                })
        };
        let n_inc = plan.includes.len();
        let pricing = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(section_title("Pricing"))
            .child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.7))
                    .min_w(px(560.))
                    .child(
                        cols(div())
                            .border_b_1()
                            .border_color(with_alpha(t.border, 0.7))
                            .px_3()
                            .py_2()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(col(1.4).child("Price"))
                            .child(col(1.).child("Billing"))
                            .child(col(1.).child("Features"))
                            .child(col(0.8).child("Status"))
                            .child(div().w(px(36.))),
                    )
                    .child(
                        cols(div())
                            .px_3()
                            .py(px(10.))
                            .child(
                                col(1.4)
                                    .child(div().truncate().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(main))
                                    .children(sub.map(|s| div().truncate().text_size(px(11.)).line_height(px(16.)).text_color(t.muted_foreground).child(s))),
                            )
                            .child(col(1.).truncate().tw_text_xs().text_color(t.muted_foreground).child(billing))
                            .child(col(1.).truncate().tw_text_xs().text_color(t.muted_foreground).child(if n_inc == 0 {
                                "—".to_string()
                            } else {
                                format!("{n_inc} feature{}", if n_inc == 1 { "" } else { "s" })
                            }))
                            .child(col(0.8).child(if is_default {
                                pill("Default", with_alpha(t.primary, 0.2), with_alpha(t.primary, 0.1), t.primary).h(px(22.)).flex().items_center().py_0().into_any_element()
                            } else {
                                div().tw_text_xs().text_color(t.muted_foreground).child("—").into_any_element()
                            }))
                            .child(div().w(px(36.)).child(price_menu)),
                    ),
            );

        // Features section.
        let available: Vec<FeatureDraft> = features.iter().filter(|f| !plan.includes.iter().any(|x| x.feature_id == f.id)).cloned().collect();
        let feature_list: AnyElement = if plan.includes.is_empty() {
            dashed_empty(&t).child("No features yet").into_any_element()
        } else {
            div()
                .overflow_hidden()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.border, 0.7))
                .children(plan.includes.iter().enumerate().map(|(k, inc)| {
                    let feat = features.iter().find(|f| f.id == inc.feature_id).cloned();
                    let fid = inc.feature_id.clone();
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .px_3()
                        .py(px(10.))
                        .when(k > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                        .child(
                            div()
                                .size_5()
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .rounded_full()
                                .map(|d| {
                                    if feat.is_some() {
                                        d.bg(with_alpha(tw("emerald-500"), 0.15)).text_color(if t.dark { tw("emerald-400") } else { tw("emerald-600") })
                                    } else {
                                        d.bg(t.muted).text_color(t.muted_foreground)
                                    }
                                })
                                .child(Icon::new(IconName::Check).size(px(12.))),
                        )
                        .child(div().min_w_0().flex_1().truncate().font_family(MONO).tw_text_xs().child(inc.feature_id.clone()))
                        .children(feat.as_ref().map(|f| {
                            div()
                                .flex_shrink_0()
                                .rounded_full()
                                .border_1()
                                .border_color(t.border)
                                .bg(with_alpha(t.muted, 0.4))
                                .px_2()
                                .py(px(2.))
                                .text_size(px(10.))
                                .line_height(px(14.))
                                .font_weight(FontWeight::SEMIBOLD)
                                .text_color(t.muted_foreground)
                                .child(f.feature_type.clone())
                        }))
                        .when(feat.as_ref().is_some_and(|f| f.feature_type == "metered") && inc.limit.is_some(), |d| {
                            d.child(
                                div()
                                    .flex_shrink_0()
                                    .font_family(MONO)
                                    .text_size(px(11.))
                                    .text_color(t.muted_foreground)
                                    .child(format!("{}/{}", inc.limit.unwrap_or(0.) as i64, inc.reset.as_deref().unwrap_or("month"))),
                            )
                        })
                        .child(
                            div()
                                .id(SharedString::from(format!("pd-rmf-{fid}")))
                                .size_7()
                                .flex_shrink_0()
                                .flex()
                                .items_center()
                                .justify_center()
                                .tw_rounded_md()
                                .cursor_pointer()
                                .text_color(t.muted_foreground)
                                .hover(|d| d.bg(t.accent).text_color(t.destructive))
                                .on_click(cx.listener(move |this, _, _, cx| this.remove_plan_feature(index, &fid, cx)))
                                .child(Icon::new(IconName::Trash).size(px(14.))),
                        )
                }))
                .into_any_element()
        };
        let adder: AnyElement = if !available.is_empty() {
            let add_id = self.add_feature_id.clone().filter(|id| available.iter().any(|f| &f.id == id));
            let w2 = w.clone();
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(
                    div().flex_1().min_w_0().child(
                        Select::new("pd-add-feature")
                            .w_full()
                            .small()
                            .placeholder("Select feature")
                            .options(available.iter().map(|f| SelectOption::new(f.id.clone(), format!("{} ({})", f.id, f.feature_type))))
                            .value(add_id.clone())
                            .on_change(move |v, _, cx| {
                                w2.update(cx, |s, cx| {
                                    s.add_feature_id = Some(v.to_string());
                                    cx.notify();
                                })
                                .ok();
                            }),
                    ),
                )
                .child(
                    Button::new("pd-add")
                        .outline()
                        .size(ButtonSize::Sm)
                        .icon(IconName::Plus)
                        .label("Add")
                        .disabled(add_id.is_none())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(id) = this.add_feature_id.take() {
                                this.add_plan_feature(index, &id, cx);
                            }
                        })),
                )
                .into_any_element()
        } else {
            div()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(if features.is_empty() { "Create features in the Features tab first." } else { "All features are already included." })
                .into_any_element()
        };
        let features_section = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(section_title(
                div().flex().gap_1().child("Features").child(div().font_weight(FontWeight::NORMAL).text_color(t.muted_foreground).child(format!("({n_inc})"))),
            ))
            .child(feature_list)
            .child(adder);

        let details = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(section_title("Details"))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(self.copy_id_row("pd-copy-id", "Product ID", &plan.id, cx))
                    .child(detail_row("Group", plan.group.clone(), true, &t))
                    .child(detail_row("Billing", billing.to_string(), false, &t))
                    .child(detail_row("Currency", if paid { currency_code } else { "—".into() }, true, &t))
                    .child(detail_row("Default", if is_default { "Yes" } else { "No" }.into(), false, &t)),
            );

        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(self.back_link("Products", cx))
            .child(header)
            .child(
                div()
                    .flex()
                    .gap_8()
                    .child(div().flex().flex_col().gap_8().flex_1().min_w_0().child(pricing).child(features_section))
                    .child(div().flex().flex_col().gap_8().w(px(260.)).flex_shrink_0().child(details).child(self.metadata_section(&t))),
            )
            .into_any_element()
    }

    /// `FeatureDetail`.
    pub(super) fn render_feature_detail(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let Some(feature) = self.drafts.features.get(index).cloned() else { return div().into_any_element() };
        let plans = self.drafts.plans.clone();
        let name = feature.description.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let display_name = name.clone().unwrap_or_else(|| feature.id.clone());
        let containing: Vec<(usize, PlanDraft)> =
            plans.iter().cloned().enumerate().filter(|(_, p)| p.includes.iter().any(|x| x.feature_id == feature.id)).collect();
        let attachable: Vec<(usize, PlanDraft)> =
            plans.iter().cloned().enumerate().filter(|(_, p)| !p.includes.iter().any(|x| x.feature_id == feature.id)).collect();
        let w = cx.entity().downgrade();
        let fid = feature.id.clone();

        let header_menu = {
            let w = w.clone();
            DropdownMenu::new("fd-actions")
                .align(Align::End)
                .trigger(Button::new("fd-actions-btn").outline().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
                .menu(move |m, _, _| {
                    let (w1, w2) = (w.clone(), w.clone());
                    m.item(MenuItem::new("Edit").icon(IconName::Pencil).on_select(move |win, cx| {
                        w1.update(cx, |s, cx| s.open_feature_sheet(Some(index), win, cx)).ok();
                    }))
                    .item(MenuItem::new("Delete").icon(IconName::Trash).destructive().on_select(move |_, cx| {
                        w2.update(cx, |s, cx| s.remove_feature(index, cx)).ok();
                    }))
                })
        };
        let none_attachable = attachable.is_empty();
        let header = div()
            .flex()
            .items_start()
            .justify_between()
            .gap_3()
            .child(
                div().min_w_0().child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap_2()
                        .child(div().truncate().tw_text_xl().font_weight(FontWeight::SEMIBOLD).child(tight(display_name)))
                        .child(pill(
                            "Active",
                            with_alpha(tw("emerald-500"), 0.25),
                            with_alpha(tw("emerald-500"), 0.1),
                            if t.dark { tw("emerald-400") } else { tw("emerald-600") },
                        )),
                ),
            )
            .child(
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap(px(6.))
                    .child(
                        Button::new("fd-attach-toggle")
                            .size(ButtonSize::Sm)
                            .label("Attach to product")
                            .disabled(none_attachable)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.attach_open = !this.attach_open;
                                cx.notify();
                            })),
                    )
                    .child(header_menu),
            );

        let attach_row = (self.attach_open && !none_attachable).then(|| {
            let sel = self.attach_plan.filter(|i| attachable.iter().any(|(k, _)| k == i));
            let w2 = w.clone();
            let fid = fid.clone();
            div()
                .flex()
                .items_center()
                .gap(px(6.))
                .child(
                    div().flex_1().min_w_0().child(
                        Select::new("fd-attach-plan")
                            .w_full()
                            .small()
                            .placeholder("Select product")
                            .options(attachable.iter().map(|(i, p)| {
                                let name = if !p.name.is_empty() {
                                    p.name.clone()
                                } else if !p.id.is_empty() {
                                    p.id.clone()
                                } else {
                                    "New product".into()
                                };
                                SelectOption::new(i.to_string(), format!("{name} ({})", if p.id.is_empty() { "no-id" } else { &p.id }))
                            }))
                            .value(sel.map(|i| i.to_string()))
                            .on_change(move |v, _, cx| {
                                w2.update(cx, |s, cx| {
                                    s.attach_plan = v.parse().ok();
                                    cx.notify();
                                })
                                .ok();
                            }),
                    ),
                )
                .child(
                    Button::new("fd-attach")
                        .size(ButtonSize::Sm)
                        .icon(IconName::Plus)
                        .label("Attach")
                        .disabled(sel.is_none())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(i) = this.attach_plan.take() {
                                this.add_plan_feature(i, &fid, cx);
                                this.attach_open = false;
                                cx.notify();
                            }
                        })),
                )
        });

        let col = |f: f32| div().flex_grow(f).flex_basis(px(0.)).min_w_0();
        let list: AnyElement = if containing.is_empty() {
            dashed_empty(&t)
                .flex()
                .justify_center()
                .gap_1()
                .child("No products currently contain this feature.")
                .child(
                    div()
                        .id("fd-attach-link")
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(t.primary)
                        .when(!none_attachable, |d| d.cursor_pointer().hover(|d| d.underline()))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if !none_attachable {
                                this.attach_open = true;
                                cx.notify();
                            }
                        }))
                        .child("Attach to product"),
                )
                .into_any_element()
        } else {
            div()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.border, 0.7))
                .min_w(px(480.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .border_b_1()
                        .border_color(with_alpha(t.border, 0.7))
                        .px_3()
                        .py_2()
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .child(col(1.6).child("Product"))
                        .child(col(1.).child("Price"))
                        .child(div().w(px(36.))),
                )
                .children(containing.into_iter().enumerate().map(|(k, (i, p))| {
                    let fid = fid.clone();
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_3()
                        .py(px(10.))
                        .when(k > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                        .child(col(1.6).child(product_identity(&p.name, &p.id, &t)))
                        .child(col(1.).truncate().tw_text_xs().text_color(t.muted_foreground).child(plan_price_label(&p)))
                        .child(
                            div().w(px(36.)).child(
                                div()
                                    .id(("fd-detach", i))
                                    .size_7()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .tw_rounded_md()
                                    .cursor_pointer()
                                    .text_color(t.muted_foreground)
                                    .hover(|d| d.bg(t.accent).text_color(t.destructive))
                                    .on_click(cx.listener(move |this, _, _, cx| this.remove_plan_feature(i, &fid, cx)))
                                    .child(Icon::new(IconName::Trash).size(px(14.))),
                            ),
                        )
                }))
                .into_any_element()
        };

        let products_section = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(section_title("Products containing this feature"))
            .children(attach_row)
            .child(list);

        let details = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(
                div().flex().items_center().justify_between().child(section_title("Details")).child(
                    Button::new("fd-edit")
                        .outline()
                        .size(ButtonSize::IconSm)
                        .icon(IconName::Pencil)
                        .on_click(cx.listener(move |this, _, win, cx| this.open_feature_sheet(Some(index), win, cx))),
                ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(self.copy_id_row("fd-copy-id", "Lookup key", &feature.id, cx))
                    .child(detail_row("Name", name.unwrap_or_else(|| "—".into()), false, &t))
                    .child(detail_row("Type", feature.feature_type.clone(), false, &t)),
            );

        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(self.back_link("Features", cx))
            .child(header)
            .child(
                div()
                    .flex()
                    .gap_8()
                    .child(div().flex().flex_col().gap_8().flex_1().min_w_0().child(products_section))
                    .child(div().flex().flex_col().gap_8().w(px(260.)).flex_shrink_0().child(details).child(self.metadata_section(&t))),
            )
            .into_any_element()
    }
}

/// `PaykitProductIdentity`.
pub(super) fn product_identity(name: &str, id: &str, t: &Tokens) -> AnyElement {
    let title = if !name.is_empty() {
        name.to_string()
    } else if !id.is_empty() {
        id.to_string()
    } else {
        "New product".into()
    };
    div()
        .flex()
        .min_w_0()
        .items_center()
        .gap(px(10.))
        .child(
            div()
                .size_9()
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_lg()
                .border_1()
                .border_color(with_alpha(t.border, 0.7))
                .bg(with_alpha(t.muted, 0.3))
                .text_color(t.muted_foreground)
                .child(Icon::new(IconName::Package).size(px(16.))),
        )
        .child(
            div()
                .min_w_0()
                .child(div().truncate().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(title))
                .child(div().truncate().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(if id.is_empty() { "no-id-yet".to_string() } else { id.to_string() })),
        )
        .into_any_element()
}
