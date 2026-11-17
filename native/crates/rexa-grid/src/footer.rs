//! Port of @rexadbapp/data-table `src/grid/pagination-footer.tsx`,
//! `infinite-scrolling-footer.tsx` and `lib/paging.ts#canAdvanceFastPage`.

use crate::view::TableEditor;
use gpui::{div, prelude::*, px, Context, FontWeight, SharedString, Window};
use rexa_ui::widgets::InputState;
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, SelectOption, TextInput, Tw};

/// `canAdvanceFastPage`.
pub fn can_advance_fast_page(page: usize, page_size: usize, record_count: usize, total: Option<u64>) -> bool {
    match total {
        None => record_count == page_size,
        Some(t) => (((page + 1) * page_size) as u64) < t,
    }
}

fn plural(n: u64) -> &'static str {
    if n == 1 {
        "record"
    } else {
        "records"
    }
}

impl TableEditor {
    pub(crate) fn render_footer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.infinite() {
            self.render_infinite_footer(window, cx).into_any_element()
        } else {
            self.render_pagination_footer(window, cx).into_any_element()
        }
    }

    fn page_size_options(&self, label: &str) -> Vec<SelectOption> {
        let mut sizes = vec![25usize, 50, 100, 200, 500];
        if !sizes.contains(&self.page_size) {
            sizes.push(self.page_size);
            sizes.sort();
        }
        sizes.into_iter().map(|s| SelectOption::new(s.to_string(), format!("{s} {label}"))).collect()
    }

    fn render_pagination_footer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let records = self.data.as_ref().map_or(0, |d| d.rows.len());
        let fast = self.settings.fast_table_loading;
        let total_pages = self.total_count.map(|c| ((c as f64 / self.page_size as f64).ceil() as u64).max(1));
        let label = match self.total_count {
            Some(c) => format!("{c} {}", plural(c)),
            None if fast => {
                if self.count_unavailable {
                    "Count unavailable".into()
                } else {
                    "Counting records…".into()
                }
            }
            None => format!("{records} {}", plural(records as u64)),
        };
        let next_disabled = (if fast {
            !can_advance_fast_page(self.page, self.page_size, records, self.total_count)
        } else {
            self.total_count.is_some_and(|c| ((self.page + 1) * self.page_size) as u64 >= c)
        }) || self.loading;
        let page = self.page;
        if self.toolbar.page_input.is_none() {
            self.toolbar.page_input = Some(cx.new(|cx| InputState::new(window, cx)));
        }
        let page_input = self.toolbar.page_input.clone().unwrap();
        let shown = (page + 1).to_string();
        if page_input.read(cx).value().as_ref() != shown {
            page_input.update(cx, |s, cx| s.set_value(shown.clone(), window, cx));
        }
        let custom = self.toolbar.custom_page_size.clone();
        let mut size_ctl = div().ml_2().flex().items_center().gap(px(6.));
        size_ctl = match custom {
            Some(input) => size_ctl.child(
                div()
                    .w(px(72.))
                    .capture_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, _, cx| match ev.keystroke.key.as_str() {
                        "enter" => this.submit_custom_page_size(cx),
                        "escape" => {
                            this.toolbar.custom_page_size = None;
                            cx.notify();
                        }
                        _ => {}
                    }))
                    .child(TextInput::new(&input).h(28.)),
            ),
            None => size_ctl.child(
                self.page_size_menu("page-size", "rows", Some(96.), true, false, window, cx),
            ),
        };
        let icon_btn = |id: &'static str, icon: IconName, disabled: bool| {
            Button::new(id).outline().size(ButtonSize::IconSm).icon(icon).disabled(disabled)
        };
        div()
            .flex_shrink_0()
            .border_t_1()
            .border_color(t.border)
            .bg(rexa_ui::with_alpha(t.studio_bg, 0.95))
            .px_3()
            .py(px(6.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(icon_btn("prev-page", IconName::ChevronLeft, page == 0 || self.loading).on_click(cx.listener(|this, _, _, cx| {
                                let p = this.page.saturating_sub(1);
                                this.set_page(p, cx)
                            })))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.))
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Page"))
                                    .child(div().w_12().child(TextInput::new(&page_input).h(28.).disabled(false)))
                                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(match total_pages {
                                        Some(n) => format!("of {n}"),
                                        None => "of —".into(),
                                    })),
                            )
                            .child(icon_btn("next-page", IconName::ChevronRight, next_disabled).on_click(cx.listener(|this, _, _, cx| {
                                let p = this.page + 1;
                                this.set_page(p, cx)
                            })))
                            .child(size_ctl),
                    )
                    .child(div().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::NORMAL).child(label)),
            )
    }

    /// shadcn `SelectTrigger` (`h-7 rounded border-border/70 bg-background text-xs`) + its list.
    #[allow(clippy::too_many_arguments)]
    fn page_size_menu(&mut self, id: &'static str, suffix: &'static str, w: Option<f32>, custom: bool, disabled: bool, _window: &mut Window, cx: &mut Context<Self>) -> gpui::AnyElement {
        let t = cx.tokens().clone();
        let options = self.page_size_options(suffix);
        let current = self.page_size;
        let this = cx.entity().downgrade();
        let trigger = div()
            .id(SharedString::from(format!("{id}-trigger")))
            .h_7()
            .when_some(w, |d, w| d.w(px(w)))
            .px_2()
            .gap_1()
            .flex()
            .items_center()
            .justify_between()
            .rounded(px(4.))
            .border_1()
            .border_color(rexa_ui::with_alpha(t.border, 0.7))
            .bg(t.background)
            .tw_text_xs()
            .whitespace_nowrap()
            .when(disabled, |d| d.opacity(0.5))
            .child(format!("{current} {suffix}"))
            .child(gpui_component::Icon::new(IconName::ChevronDown).size_4().text_color(rexa_ui::with_alpha(t.muted_foreground, 0.5)));
        if disabled {
            return trigger.into_any_element();
        }
        rexa_ui::DropdownMenu::new(id)
            .side(rexa_ui::Side::Top)
            .align(rexa_ui::Align::Start)
            .trigger(trigger)
            .menu(move |m, _, _| {
                let mut m = m;
                for o in &options {
                    let (this, v) = (this.clone(), o.value.clone());
                    m = m.item(rexa_ui::MenuItem::radio(o.label.clone(), o.value.as_ref() == current.to_string()).text_xs().on_select(move |_, cx| {
                        if let Ok(n) = v.parse::<usize>() {
                            this.update(cx, |this, cx| this.set_page_size(n, cx)).ok();
                        }
                    }));
                }
                if custom {
                    let this = this.clone();
                    m = m.item(rexa_ui::MenuItem::new("Custom...").text_xs().on_select(move |window, cx| {
                        this.update(cx, |this, cx| {
                            let current = this.page_size.to_string();
                            let input = cx.new(|cx| InputState::new(window, cx).default_value(current));
                            input.update(cx, |s, cx| {
                                s.focus(window, cx);
                                s.select_all(window, cx);
                            });
                            this.toolbar.custom_page_size = Some(input);
                            cx.notify();
                        })
                        .ok();
                    }));
                }
                m
            })
            .into_any_element()
    }

    fn submit_custom_page_size(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(input) = self.toolbar.custom_page_size.take() {
            if let Ok(n) = input.read(cx).value().trim().parse::<usize>() {
                if n > 0 {
                    self.set_page_size(n, cx);
                }
            }
        }
        cx.notify();
    }

    fn render_infinite_footer(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let records = self.data.as_ref().map_or(0, |d| d.rows.len());
        let status = if self.loading {
            "Loading rows…"
        } else if self.loading_more {
            "Loading more rows…"
        } else if self.load_more_error.is_some() {
            "Couldn’t load more rows."
        } else if self.has_more {
            "Scroll to load more"
        } else {
            "All rows loaded"
        };
        let busy = self.loading || self.loading_more;
        div()
            .flex()
            .flex_shrink_0()
            .flex_wrap()
            .items_center()
            .justify_between()
            .gap_2()
            .border_t_1()
            .border_color(t.border)
            .bg(rexa_ui::with_alpha(t.studio_bg, 0.95))
            .px_3()
            .py(px(6.))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_3()
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(match self.total_count {
                        None => format!("{records} rows loaded"),
                        Some(c) => format!("{records} of {c} rows loaded"),
                    }))
                    .child(
                        self.page_size_menu("batch-size", "rows per batch", None, false, busy, window, cx),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(status))
                    .when(self.has_more, |d| {
                        d.child(
                            Button::new("load-more")
                                .outline()
                                .size(ButtonSize::Sm)
                                .label(if self.load_more_error.is_some() { "Retry" } else { "Load more" })
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.load_more_error = None;
                                    this.load_more(cx)
                                })),
                        )
                    }),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::can_advance_fast_page;

    #[test]
    fn fast_paging() {
        assert!(can_advance_fast_page(0, 100, 100, None));
        assert!(!can_advance_fast_page(0, 100, 40, None));
        assert!(!can_advance_fast_page(1, 100, 100, Some(200)));
        assert!(can_advance_fast_page(0, 100, 100, Some(200)));
    }
}
