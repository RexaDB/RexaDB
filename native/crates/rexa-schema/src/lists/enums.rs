//! Port of components/studio/database/enums-list.tsx (+ `handleDeleteEnum` from
//! hooks/use-studio.ts).

use super::{fetch, ListBase, ListView};
use crate::actions;
use crate::common;
use crate::data_table::{Column, DataTable, Row};
use crate::prefill;
use gpui::{div, prelude::*, px, Context, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::EnumType;
use rexa_ui::{ActiveTokens, Button, ButtonSize, DropdownMenu, IconName, MenuItem, Side, Align, Tooltip};
use std::sync::Arc;

pub struct EnumsList {
    base: ListBase,
    enums: Vec<EnumType>,
}

impl ListView for EnumsList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let fut = rexa_core::runtime::spawn(async move { d.enums().await });
        fetch(cx, fut, |v: &mut Self, e| v.enums = e);
    }
}

impl EnumsList {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec, session, schema, "Search for a type", window, cx);
        let mut this = EnumsList { base, enums: Vec::new() };
        this.load(cx);
        this
    }

    fn delete(&mut self, schema: String, name: String, cx: &mut Context<Self>) {
        let sql = format!("DROP TYPE IF EXISTS {}.{} CASCADE;", actions::dq(&schema), actions::dq(&name));
        let this = cx.entity().downgrade();
        actions::confirm_run(
            &self.base.session,
            "Delete Enum Type",
            format!("Are you sure you want to delete the enum type \"{schema}\".\"{name}\"?"),
            "Delete",
            sql,
            format!("Enum \"{name}\" deleted successfully"),
            "Failed to delete enum",
            cx,
            move |_, cx| {
                this.update(cx, |v, cx| v.load(cx)).ok();
            },
        );
    }
}

impl Render for EnumsList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.base.loading && self.enums.is_empty() && !self.base.loaded_once {
            return common::list_skeleton("enums-sk", &[64., 96., 160.], cx);
        }
        let t = cx.tokens().clone();
        let search = self.base.query(cx);
        let schema = self.base.schema.clone();
        let needle = search.to_lowercase();
        let filtered: Vec<EnumType> = self
            .enums
            .iter()
            .filter(|e| !e.values.is_empty() && e.schema == schema && (needle.is_empty() || e.name.to_lowercase().contains(&needle)))
            .cloned()
            .collect();
        let this = cx.entity();
        let create = {
            let schema = schema.clone();
            move |_: &mut Window, cx: &mut gpui::App| prefill::open_create("enum", Some(&schema), cx)
        };

        let body = if filtered.is_empty() && search.is_empty() {
            common::list_empty_state(
                "enums-empty-create",
                IconName::List,
                "No enumerated types created yet",
                format!("There are no enumerated types found in the schema \"{schema}\""),
                "Create type",
                create.clone(),
                cx,
            )
        } else {
            let rows = filtered.into_iter().map(|e| {
                let values = e.values.join(", ");
                let (s1, n1, v1) = (e.schema.clone(), e.name.clone(), e.values.clone());
                let (s2, n2) = (e.schema.clone(), e.name.clone());
                let this = this.clone();
                let menu = DropdownMenu::new(SharedString::from(format!("enum-menu-{}.{}", e.schema, e.name)))
                    .side(Side::Bottom)
                    .align(Align::End)
                    .trigger(Tooltip::new("More options").side(Side::Bottom).child(Button::new(SharedString::from(format!("enum-more-{}.{}", e.schema, e.name))).outline().size(ButtonSize::IconSm).icon(IconName::EllipsisVertical)))
                    .menu(move |m, _, _| {
                        let (s1, n1, v1) = (s1.clone(), n1.clone(), v1.clone());
                        let (s2, n2) = (s2.clone(), n2.clone());
                        let this = this.clone();
                        m.w(128.)
                            .item(MenuItem::new("Update type").icon(IconName::Pen).on_select(move |_, cx| prefill::open_edit_enum(&s1, &n1, &v1, cx)))
                            .item(MenuItem::new("Delete type").icon(IconName::Trash).on_select(move |_, cx| {
                                let (s, n) = (s2.clone(), n2.clone());
                                this.update(cx, |v, cx| v.delete(s, n, cx));
                            }))
                    });
                Row::new(format!("{}.{}", e.schema, e.name))
                    .sort("schema", e.schema.clone())
                    .sort("name", e.name.clone())
                    .sort("values", values.clone())
                    .cell(div().w(px(80.)).truncate().text_color(t.muted_foreground).child(e.schema.clone()))
                    .cell(div().truncate().font_weight(gpui::FontWeight::MEDIUM).child(e.name.clone()))
                    .cell(div().truncate().text_color(t.muted_foreground).child(values))
                    .cell(div().flex().justify_end().items_center().child(menu))
            });
            div()
                .pb_8()
                .child(
                    DataTable::new("enums-table", &self.base.table)
                        .columns([
                            Column::new("schema", "Schema").fr(0.6).sortable(),
                            Column::new("name", "Name").fr(1.).sortable(),
                            Column::new("values", "Values").fr(1.6),
                            Column::new("actions", "").px(48.).right(),
                        ])
                        .rows(rows)
                        .paginate(10, "types")
                        .empty(common::no_results(&search, cx)),
                )
                .into_any_element()
        };

        let this2 = cx.entity();
        common::page(cx)
            .child(common::list_header("Database Enumerated Types", "Custom data types that you can use in your database tables or functions", cx))
            .child(
                common::toolbar()
                    .child(
                        common::filters()
                            .child(common::schema_dropdown(
                                "enums-schema",
                                &self.base.schemas,
                                &schema,
                                false,
                                move |s, _, cx| this2.update(cx, |v, cx| ListBase::set_schema(v, s, cx)),
                                cx,
                            ))
                            .child(common::search_input(&self.base.search, cx)),
                    )
                    .child(common::create_button("enums-create", "Create type", create)),
            )
            .child(div().id("enums-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().child(body))
            .into_any_element()
    }
}
