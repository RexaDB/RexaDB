//! Port of components/studio/sql-editor-panel.tsx (embedded body: the
//! "SQL Editor" / "Snippets" header tabs over a `SqlEditor` or the
//! `SnippetBrowser`), hosted by the studio shell as the `"sql-sheet"` panel.

use crate::snippet_browser::{SnippetBrowser, SnippetBrowserEvent};
use crate::sql_editor::SqlEditor;
use crate::sql_text::editor_label;
use gpui::{div, prelude::*, px, Context, Entity, FontWeight, Subscription, Window};
use rexa_core::{Session, StudioEvent, TabSpec};
use rexa_ui::{with_alpha, ActiveTokens, Button, ButtonSize, IconName, Tw};
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq)]
enum ViewMode {
    Editor,
    Snippets,
}

pub struct SqlEditorPanel {
    view_key: String,
    db_type: String,
    editor: Entity<SqlEditor>,
    browser: Entity<SnippetBrowser>,
    mode: ViewMode,
    _subs: Vec<Subscription>,
}

impl SqlEditorPanel {
    pub fn new(session: Arc<Session>, view_key: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let db_type = session.driver.kind().as_str().to_string();
        let connection_id = session.connection.id;
        let editor = cx.new(|cx| SqlEditor::new(session, format!("{view_key}-{connection_id}"), "Query".into(), String::new(), window, cx));
        let browser = cx.new(|cx| SnippetBrowser::new(connection_id, window, cx));
        let subs = vec![cx.subscribe_in(&browser, window, |this, _, ev: &SnippetBrowserEvent, window, cx| match ev {
            // `handleSelectSnippet`: load the snippet into the editor.
            SnippetBrowserEvent::Select(s) => {
                let q = s.query.clone();
                this.editor.update(cx, |e, cx| e.set_query_text(q, window, cx));
                this.mode = ViewMode::Editor;
                cx.notify();
            }
        })];
        SqlEditorPanel { view_key, db_type, editor, browser, mode: ViewMode::Editor, _subs: subs }
    }
}

impl Render for SqlEditorPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let count = self.browser.read(cx).snippets.len();
        let tab = |id: &'static str, active: bool| {
            div()
                .id(id)
                .flex()
                .items_center()
                .px_3()
                .tw_text_xs()
                .font_weight(FontWeight::MEDIUM)
                .border_b_2()
                .cursor_pointer()
                .when(active, |d| d.border_color(t.foreground).text_color(t.foreground))
                .when(!active, |d| d.border_color(gpui::transparent_black()).text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
        };
        let view_key = self.view_key.clone();
        div()
            .flex()
            .size_full()
            .min_h_0()
            .flex_col()
            .overflow_hidden()
            .text_color(t.foreground)
            .child(
                div()
                    .flex()
                    .h(px(44.))
                    .flex_shrink_0()
                    .items_center()
                    .border_b_1()
                    .border_color(t.border)
                    .px_1()
                    .child(
                        div()
                            .flex()
                            .h_full()
                            .child(tab("panel-editor", self.mode == ViewMode::Editor).on_click(cx.listener(|this, _, _, cx| {
                                this.mode = ViewMode::Editor;
                                cx.notify();
                            })).child(editor_label(&self.db_type)))
                            .child(
                                tab("panel-snippets", self.mode == ViewMode::Snippets)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.browser.update(cx, |b, cx| {
                                            b.reload();
                                            cx.notify();
                                        });
                                        let q = this.editor.read(cx).query.clone();
                                        this.browser.update(cx, |b, _| b.current_query = q);
                                        this.mode = ViewMode::Snippets;
                                        cx.notify();
                                    }))
                                    .child("Snippets")
                                    .when(count > 0, |d| d.child(div().ml(px(6.)).tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child(format!("({count})")))),
                            ),
                    )
                    .child(div().ml_auto().child(Button::new("panel-close").ghost().size(ButtonSize::Icon).icon(IconName::X).on_click(move |_, _, cx| {
                        rexa_core::emit_studio(StudioEvent::CloseTab(TabSpec::View { view: view_key.clone(), params: serde_json::Value::Null }), cx);
                    }))),
            )
            .child(div().flex().min_h_0().flex_1().overflow_hidden().map(|d| match self.mode {
                ViewMode::Editor => d.child(self.editor.clone()),
                ViewMode::Snippets => d.child(self.browser.clone()),
            }))
    }
}
