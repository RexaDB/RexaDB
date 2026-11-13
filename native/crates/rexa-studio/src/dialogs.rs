//! Dialogs of the studio shell: components/ui/dialog.tsx frame (bg-black/80
//! overlay, centered rounded-lg border bg-background p-6 card), the settings
//! modal (80vw × 80vh, overlay black/40), close-dirty-dialog.tsx,
//! rename-dialog.tsx, the sidebar's "Rename tag" / "Tags as folders" dialogs
//! and the destructive confirms of the table context menu (use-confirm).

use crate::studio::{ConfirmAction, Dialog, RenameTarget, Studio};
use gpui::{deferred, div, prelude::*, px, relative, AnyElement, Context, MouseButton, SharedString, Window};
use rexa_ui::{ActiveTokens, Button, ButtonSize, TextInput, Tw};

/// Full-window overlay with `content` centered; clicking the backdrop dismisses.
pub fn modal_layer(
    id: &'static str,
    overlay_alpha: f32,
    content: AnyElement,
    cx: &mut Context<Studio>,
    on_dismiss: impl Fn(&mut Studio, &mut Window, &mut Context<Studio>) + 'static,
) -> AnyElement {
    deferred(
        div()
            .id(id)
            .absolute()
            .inset_0()
            .flex()
            .items_center()
            .justify_center()
            .bg(gpui::hsla(0., 0., 0., overlay_alpha))
            .occlude()
            .on_mouse_down(MouseButton::Left, cx.listener(move |this, _, window, cx| on_dismiss(this, window, cx)))
            .child(div().on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(content)),
    )
    .with_priority(1)
    .into_any_element()
}

/// DialogContent card (sm:max-w-sm → 384px).
pub fn dialog_card(title: impl Into<SharedString>, body: AnyElement, footer: AnyElement, width: f32, cx: &mut Context<Studio>) -> AnyElement {
    let t = cx.tokens().clone();
    div()
        .w(px(width))
        .flex()
        .flex_col()
        .gap_4()
        .tw_rounded_lg()
        .border_1()
        .border_color(t.border)
        .bg(t.background)
        .text_color(t.foreground)
        .p_6()
        .shadow_lg()
        .child(
            div()
                .tw_text_sm()
                .tw_leading_none()
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .child(rexa_ui::tight(title.into())),
        )
        .child(body)
        .child(div().flex().justify_end().gap_2().child(footer))
        .into_any_element()
}

pub const TAG_COLORS: [&str; 7] = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#fb7185", "#f472b6", "#94a3b8"];

impl Studio {
    pub fn open_rename_tag(&mut self, name: &str, window: &mut Window, cx: &mut Context<Self>) {
        let n = name.to_string();
        self.tag_input.update(cx, |i, cx| {
            i.set_value(n.clone(), window, cx);
            i.focus(window, cx);
        });
        self.dialog = Some(Dialog::Rename { title: "Rename tag".into(), target: RenameTarget::Tag(name.to_string()) });
        cx.notify();
    }

    pub fn open_tag_manager(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.tag_input.update(cx, |i, cx| {
            i.set_value("", window, cx);
            i.focus(window, cx);
        });
        self.dialog = Some(Dialog::TagManager { color: TAG_COLORS[0].into() });
        cx.notify();
    }

    pub fn close_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.dialog = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    fn confirm_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(dialog) = self.dialog.take() else { return };
        let value = self.tag_input.read(cx).value().to_string();
        match dialog {
            Dialog::Rename { target: RenameTarget::Tag(old), .. } => self.rename_tag(&old, &value, cx),
            Dialog::ConfirmDanger { action, .. } => match action {
                ConfirmAction::TruncateTable(schema, table) => {
                    let sql = if self.db_type == "sqlite" {
                        format!("DELETE FROM {}", self.qualified(&schema, &table))
                    } else {
                        format!("TRUNCATE TABLE {}", self.qualified(&schema, &table))
                    };
                    self.run_ddl(sql, cx);
                }
                ConfirmAction::DropTable(schema, table) => {
                    let sql = format!("DROP TABLE {}", self.qualified(&schema, &table));
                    self.run_ddl(sql, cx);
                }
            },
            Dialog::TagManager { color } => {
                self.add_tag(&value, &color, cx);
                self.tag_input.update(cx, |i, cx| i.set_value("", window, cx));
                self.dialog = Some(Dialog::TagManager { color });
                return cx.notify();
            }
        }
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub fn render_dialog(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let t = cx.tokens().clone();
        let input = self.tag_input.clone();
        let card = match self.dialog.as_ref()? {
            Dialog::Rename { title, .. } => {
                let empty = input.read(cx).value().trim().is_empty();
                let footer = div()
                    .flex()
                    .gap_2()
                    .child(Button::new("rename-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(cx.listener(|this, _, w, cx| this.close_dialog(w, cx))))
                    .child(Button::new("rename-ok").size(ButtonSize::Sm).label("Rename").disabled(empty).on_click(cx.listener(|this, _, w, cx| this.confirm_dialog(w, cx))));
                dialog_card(title.clone(), TextInput::new(&input).h(36.).into_any_element(), footer.into_any_element(), 384., cx)
            }
            Dialog::ConfirmDanger { title, description, confirm, .. } => {
                let footer = div()
                    .flex()
                    .gap_2()
                    .child(Button::new("confirm-cancel").outline().label("Cancel").on_click(cx.listener(|this, _, w, cx| this.close_dialog(w, cx))))
                    .child(Button::new("confirm-ok").destructive().label(confirm.clone()).on_click(cx.listener(|this, _, w, cx| this.confirm_dialog(w, cx))));
                let body = div().tw_text_sm().text_color(t.muted_foreground).child(description.clone());
                dialog_card(title.clone(), body.into_any_element(), footer.into_any_element(), 512., cx)
            }
            Dialog::TagManager { color } => {
                let color = color.clone();
                let empty = input.read(cx).value().trim().is_empty();
                let mut swatches = div().flex().items_center().gap(px(6.));
                for c in TAG_COLORS {
                    let sel = color.as_ref() == c;
                    let hex = rexa_ui::parse_color(c).unwrap_or_default();
                    swatches = swatches.child(
                        div()
                            .id(SharedString::from(format!("swatch-{c}")))
                            .size_5()
                            .rounded_full()
                            .border_1()
                            .border_color(if sel { t.foreground } else { t.border })
                            .bg(hex)
                            .cursor_pointer()
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.dialog = Some(Dialog::TagManager { color: c.into() });
                                cx.notify();
                            })),
                    );
                }
                let mut list = div().id("tag-list").flex().flex_col().gap(px(2.)).max_h(px(224.)).overflow_y_scroll();
                if self.tags.is_empty() {
                    list = list.child(div().px_1().py_2().tw_text_xs().text_color(t.muted_foreground).child("No tags yet. Create one, then right-click a table → Tags to assign it."));
                }
                for (name, c) in self.tags.clone() {
                    let n = name.clone();
                    list = list.child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .tw_rounded_md()
                            .px(px(6.))
                            .py(px(6.))
                            .hover(|s| s.bg(rexa_ui::white(0.05)))
                            .child(div().size(px(10.)).flex_shrink_0().rounded_full().bg(rexa_ui::parse_color(&c).unwrap_or_default()))
                            .child(div().flex_1().min_w_0().tw_text_sm().overflow_hidden().text_ellipsis().child(name.clone()))
                            .child(
                                div()
                                    .id(SharedString::from(format!("del-tag-{name}")))
                                    .size_6()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .tw_rounded_md()
                                    .text_color(t.muted_foreground)
                                    .hover(move |s| s.bg(rexa_ui::white(0.1)).text_color(t.destructive))
                                    .on_click(cx.listener(move |this, _, _, cx| this.remove_tag(&n, cx)))
                                    .child(crate::icons::lucide("x").el(14., gpui::Hsla::default())),
                            ),
                    );
                }
                let body = div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(div().flex_1().child(TextInput::new(&input)))
                            .child(Button::new("tag-add").size(ButtonSize::Sm).icon(rexa_ui::IconName::Plus).label("Add").disabled(empty).on_click(cx.listener(|this, _, w, cx| this.confirm_dialog(w, cx)))),
                    )
                    .child(swatches)
                    .child(list)
                    .child(div().tw_text_11().line_height(relative(1.625)).text_color(t.muted_foreground).child(
                        "Tip: use Tags view to browse tables grouped in tag folders. A table with several tags appears in each folder.",
                    ));
                let footer = Button::new("tag-done").ghost().size(ButtonSize::Sm).label("Done").on_click(cx.listener(|this, _, w, cx| this.close_dialog(w, cx)));
                dialog_card("Tags as folders", body.into_any_element(), footer.into_any_element(), 384., cx)
            }
        };
        let card = div()
            .on_key_down(cx.listener(|this, e: &gpui::KeyDownEvent, window, cx| match e.keystroke.key.as_str() {
                "escape" => this.close_dialog(window, cx),
                "enter" => this.confirm_dialog(window, cx),
                _ => {}
            }))
            .child(card)
            .into_any_element();
        Some(modal_layer("dialog-layer", 0.8, card, cx, |this, w, cx| this.close_dialog(w, cx)))
    }

    /// Settings modal: DialogContent h-[80vh] w-[80vw] p-0, overlay bg-black/40.
    pub fn render_settings_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let section = self.settings_section.clone()?;
        let t = cx.tokens().clone();
        let size = window.viewport_size();
        let body: AnyElement = match &self.settings_view {
            Some(v) => v.clone().into_any_element(),
            None => div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .tw_text_sm()
                .text_color(t.muted_foreground)
                .child(format!("Settings — {section}"))
                .into_any_element(),
        };
        let card = div()
            .w(size.width * 0.8)
            .h(size.height * 0.8)
            .flex()
            .flex_col()
            .overflow_hidden()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .shadow_lg()
            .on_key_down(cx.listener(|this, e: &gpui::KeyDownEvent, _, cx| {
                if e.keystroke.key == "escape" {
                    this.close_settings(cx);
                }
            }))
            .child(body)
            .into_any_element();
        Some(modal_layer("settings-layer", 0.4, card, cx, |this, _, cx| this.close_settings(cx)))
    }
}

#[allow(dead_code)]
/// close-dirty-dialog.tsx body text, for tabs that ask before discarding edits.
pub fn close_dirty_description(tab_name: &str) -> String {
    format!("Do you want to discard the changes made to {tab_name}?")
}
