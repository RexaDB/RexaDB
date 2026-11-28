//! Port of components/studio/database/database-object-view.tsx (the
//! `database-object` tab, `params.databaseObject`) and DATABASE_OBJECT_LABELS
//! (lib/studio/database-objects.ts). The read-only definition uses the
//! tree-sitter SQL `Editor` instead of Monaco.

use gpui::{div, prelude::*, AnyView, App, AppContext, ClipboardItem, Context, Entity, FontWeight, Window};
use rexa_ui::widgets::{Editor, EditorState, Icon};
use rexa_ui::{ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, Toast, Tw, MONO};

pub fn label(kind: &str) -> &'static str {
    match kind {
        "function" => "Function",
        "procedure" => "Procedure",
        "package" => "Package",
        "trigger" => "Trigger",
        "sequence" => "Sequence",
        "enum" => "Enum",
        "index" => "Index",
        "synonym" => "Synonym",
        "materialized-view" => "Materialized View",
        "db-link" => "DB Link",
        _ => "Object",
    }
}

#[derive(Clone, Default)]
struct Obj {
    kind: String,
    schema: String,
    name: String,
    signature: Option<String>,
    definition: String,
    metadata: Vec<(String, String)>,
}

pub struct DatabaseObjectView {
    object: Option<Obj>,
    editor: Option<Entity<EditorState>>,
}

pub fn build(params: &serde_json::Value, window: &mut Window, cx: &mut App) -> AnyView {
    let o = params.get("databaseObject").filter(|v| v.is_object()).map(|v| {
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
        Obj {
            kind: s("kind"),
            schema: s("schema"),
            name: s("name"),
            signature: v.get("signature").and_then(|x| x.as_str()).map(str::to_string),
            definition: s("definition"),
            metadata: v
                .get("metadata")
                .and_then(|m| m.as_array())
                .map(|a| a.iter().filter_map(|e| Some((e.get("label")?.as_str()?.to_string(), e.get("value").map(|x| x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string()))?))).collect())
                .unwrap_or_default(),
        }
    });
    cx.new(|cx| {
        let editor = o.as_ref().filter(|o| !o.definition.is_empty()).map(|o| {
            let def = o.definition.clone();
            cx.new(|cx| {
                let mut s = EditorState::new(window, cx).language("sql");
                s.set_value(def, window, cx);
                s
            })
        });
        DatabaseObjectView { object: o, editor }
    })
    .into()
}

impl Render for DatabaseObjectView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let Some(o) = self.object.clone() else {
            return div().size_full().flex().items_center().justify_center().bg(t.studio_bg).tw_text_sm().text_color(t.muted_foreground).child("This object is no longer available. Open it again from the sidebar.");
        };
        let qualified = if o.schema.is_empty() { o.name.clone() } else { format!("{}.{}", o.schema, o.name) };
        let title = if matches!(o.kind.as_str(), "function" | "procedure") { format!("{qualified}({})", o.signature.clone().unwrap_or_default()) } else { qualified };
        let (def1, def2, name) = (o.definition.clone(), o.definition.clone(), o.name.clone());
        let header = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap_2()
            .border_b_1()
            .border_color(t.border)
            .px_4()
            .py(gpui::px(10.))
            .child(div().min_w_0().truncate().font_family(MONO).tw_text_sm().font_weight(FontWeight::MEDIUM).child(title))
            .child(div().flex_shrink_0().child(Badge::new(label(&o.kind)).variant(BadgeVariant::Secondary)))
            .when(!o.definition.is_empty(), |d| {
                d.child(
                    div()
                        .ml_auto()
                        .flex()
                        .flex_shrink_0()
                        .items_center()
                        .gap(gpui::px(6.))
                        .child(Button::new("obj-copy").outline().size(ButtonSize::Sm).icon(IconName::Copy).label("Copy").on_click(move |_, _, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(def1.clone()));
                            Toast::success("Definition copied").show(cx);
                        }))
                        .child(Button::new("obj-open").outline().size(ButtonSize::Sm).icon(IconName::Code).label("Open in SQL Editor").on_click(move |_, _, cx| {
                            let id = format!("sql-object-{}", crate::common::short_id());
                            crate::common::open_sql(id, name.clone(), def2.clone(), cx);
                        })),
                )
            });
        let meta = (!o.metadata.is_empty()).then(|| {
            div().flex().flex_shrink_0().flex_wrap().gap_x_8().gap_y_1().border_b_1().border_color(t.border).px_4().py_2().tw_text_xs().children(o.metadata.iter().map(|(l, v)| {
                div().flex().min_w_0().items_baseline().gap(gpui::px(6.)).child(div().flex_shrink_0().text_color(t.muted_foreground).child(l.clone())).child(div().min_w_0().truncate().font_family(MONO).child(v.clone()))
            }))
        });
        let body = match &self.editor {
            None => div().size_full().flex().flex_col().items_center().justify_center().gap_2().p_6().text_center().tw_text_sm().text_color(t.muted_foreground).child(Icon::new(IconName::Database).size_5()).child("No source definition is available for this object.").into_any_element(),
            Some(e) => Editor::new(e).h(gpui::relative(1.)).bordered(false).disabled(true).into_any_element(),
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(header)
            .children(meta)
            .child(div().relative().flex_1().min_h_0().overflow_hidden().child(body))
    }
}
