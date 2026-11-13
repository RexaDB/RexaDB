//! Port of the TablesPanel of components/studio/studio-shell-sidebar.tsx (search,
//! filter, database / schema pickers, A-Z ⇄ Tags toggle, virtualized table list,
//! tag folders, Schema Explorer object sections), lib/studio/table-filter.ts and
//! the table context / three-dot menu (components/studio/database/table-utils.tsx).

use crate::catalog;
use crate::icons;
use crate::menu::{MenuEntry, Tone};
use crate::studio::{ConfirmAction, Dialog, Studio, TypeFilter};
use gpui::{div, prelude::*, px, uniform_list, AnyElement, Context, MouseButton, SharedString, Window};
use rexa_drivers::TableRef;
use rexa_ui::{white, with_alpha, ActiveTokens, TextInput, Tw};

/// SQL LIKE (`%`, `_`, `\` escapes), whole-string.
fn like_match(name: &[char], pat: &[char]) -> bool {
    match pat.first() {
        None => name.is_empty(),
        Some('%') => (0..=name.len()).any(|i| like_match(&name[i..], &pat[1..])),
        Some('_') => !name.is_empty() && like_match(&name[1..], &pat[1..]),
        Some('\\') if pat.len() > 1 => name.first() == Some(&pat[1]) && like_match(&name[1..], &pat[2..]),
        Some(c) => name.first() == Some(c) && like_match(&name[1..], &pat[1..]),
    }
}

fn has_wildcards(q: &str) -> bool {
    let mut chars = q.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '%' | '_' => return true,
            _ => {}
        }
    }
    false
}

fn unescape_like(q: &str) -> String {
    let mut out = String::new();
    let mut chars = q.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(&n) = chars.peek() {
                if matches!(n, '%' | '_' | '\\') {
                    out.push(n);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(c);
    }
    out
}

/// matchesTableName (mode "auto" or "substring" when wildcards are off).
pub fn matches_table_name(name: &str, query: &str, case_sensitive: bool, wildcards: bool) -> bool {
    let q = query.trim();
    if q.is_empty() {
        return true;
    }
    let (n, q) = if case_sensitive { (name.to_string(), q.to_string()) } else { (name.to_lowercase(), q.to_lowercase()) };
    if wildcards && has_wildcards(&q) {
        let nc: Vec<char> = n.chars().collect();
        let pc: Vec<char> = q.chars().collect();
        return like_match(&nc, &pc);
    }
    n.contains(&unescape_like(&q))
}

impl Studio {
    pub fn search_query(&self, cx: &gpui::App) -> String {
        self.search.read(cx).value().to_string()
    }

    /// filterTablesByNameAndType over tables ∪ views.
    pub fn filtered_tables(&self, cx: &gpui::App) -> Vec<TableRef> {
        let q = self.search_query(cx);
        self.tables
            .iter()
            .filter(|t| match self.type_filter {
                TypeFilter::All => true,
                TypeFilter::Tables => !t.is_view,
                TypeFilter::Views => t.is_view,
            })
            .filter(|t| matches_table_name(&t.name, &q, self.case_sensitive, self.wildcards))
            .cloned()
            .collect()
    }

    fn item_noun(&self) -> &'static str {
        match self.db_type {
            "mongodb" => "Collection",
            "redis" => "Key",
            _ => "Table",
        }
    }

    /// The table row menu (dropdown and context menu share it).
    pub fn table_menu(&self, table: &str, schema: &str) -> Vec<MenuEntry> {
        let noun = self.item_noun();
        let mongo = self.db_type == "mongodb";
        let editor = match self.db_type {
            "postgres" | "supabase-mgmt" => "SQL Editor",
            "mongodb" => "Mongo Editor",
            "redis" => "Redis Editor",
            _ => "Editor",
        };
        let (t, s) = (table.to_string(), schema.to_string());
        let c = |f: fn(&mut Studio, &str, &str, &mut Context<Studio>)| {
            let (t, s) = (t.clone(), s.clone());
            move |this: &mut Studio, _: &mut Window, cx: &mut Context<Studio>| f(this, &t, &s, cx)
        };
        let key = format!("{schema}.{table}");
        let mut tags_sub = Vec::new();
        if self.tags.is_empty() {
            tags_sub.push(MenuEntry::item("No tags defined", |_, _, _| {}).disabled(true));
        }
        for (name, color) in &self.tags {
            let has = self.table_tags.get(&key).is_some_and(|v| v.contains(name));
            let (tt, ss, nn) = (t.clone(), s.clone(), name.clone());
            tags_sub.push(
                MenuEntry::item(name.clone(), move |this, _, cx| this.toggle_table_tag(&ss, &tt, &nn, cx))
                    .swatch(rexa_ui::parse_color(color).unwrap_or_default())
                    .checked(has),
            );
        }
        let export = |fmt: &'static str| {
            let (t, s) = (t.clone(), s.clone());
            MenuEntry::item(fmt.to_uppercase(), move |this, _, cx| {
                let mut tab = crate::tabs::StudioTab::new("import-export", "import-export", "Export");
                tab.schema = Some(s.clone());
                tab.extra.insert("table".into(), t.clone().into());
                tab.extra.insert("format".into(), fmt.into());
                this.open_tab(tab, false, cx);
            })
        };
        let mut export_sub = vec![export("csv"), export("json")];
        if self.db_type != "mongodb" && self.db_type != "redis" {
            export_sub.push(export("sql"));
        }
        vec![
            MenuEntry::item(format!("Open {noun}"), c(|this, t, s, cx| this.open_table(t, Some(s), cx))),
            MenuEntry::item(format!("Open in {editor}"), c(|this, t, s, cx| this.open_sql_editor(Some(t), Some(s), None, cx))),
            MenuEntry::item("View Schema", c(|this, t, s, cx| {
                this.open_table(t, Some(s), cx);
                this.tab_command("VIEW_SCHEMA", cx);
            })),
            MenuEntry::item(format!("Copy {noun} Name"), c(|_, t, _, cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(t.to_string())))),
            MenuEntry::Separator,
            MenuEntry::Submenu { label: "Tags".into(), items: tags_sub },
            MenuEntry::Separator,
            MenuEntry::item(
                match self.db_type {
                    "mongodb" => "Copy Collection Definition",
                    "redis" => "Copy Key Name",
                    _ => "Copy SQL Definition",
                },
                c(|this, t, s, cx| this.copy_table_definition(t, s, cx)),
            ),
            MenuEntry::item(format!("Duplicate {noun}"), c(|this, t, s, cx| this.duplicate_table(t, s, cx))),
            MenuEntry::Separator,
            MenuEntry::Submenu { label: "Export Data".into(), items: export_sub },
            MenuEntry::Separator,
            MenuEntry::item(if mongo { "Empty Collection" } else { "Truncate Table" }, c(|this, t, s, cx| {
                let mongo = this.db_type == "mongodb";
                this.dialog = Some(Dialog::ConfirmDanger {
                    title: format!("{} \"{t}\"?", if mongo { "Empty collection" } else { "Empty table" }).into(),
                    description: if mongo {
                        "This will delete all documents in the collection. This action cannot be undone."
                    } else {
                        "This will delete all data in the table. This action cannot be undone."
                    }
                    .into(),
                    confirm: "Delete".into(),
                    action: ConfirmAction::TruncateTable(s.to_string(), t.to_string()),
                });
                cx.notify();
            }))
            .tone(Tone::Amber),
            MenuEntry::item(if mongo { "Delete Collection" } else { "Delete Table" }, c(|this, t, s, cx| {
                let mongo = this.db_type == "mongodb";
                this.dialog = Some(Dialog::ConfirmDanger {
                    title: format!("{} \"{t}\"?", if mongo { "Delete collection" } else { "Delete table" }).into(),
                    description: format!("Are you sure you want to delete this {}? This action cannot be undone.", if mongo { "collection" } else { "table" }).into(),
                    confirm: "Delete".into(),
                    action: ConfirmAction::DropTable(s.to_string(), t.to_string()),
                });
                cx.notify();
            }))
            .tone(Tone::Red),
        ]
    }

    /// copyTableSchema
    fn copy_table_definition(&mut self, table: &str, schema: &str, cx: &mut Context<Self>) {
        let Some(session) = self.session.clone() else { return };
        let r = TableRef { schema: schema.to_string(), name: table.to_string(), is_view: false };
        let qualified = self.qualified(schema, table);
        let task = rexa_core::runtime::spawn(async move {
            let d = &session.driver;
            match d.kind() {
                rexa_drivers::Kind::Sqlite => {
                    let res = d.execute(&format!("SELECT sql FROM sqlite_master WHERE name = '{}' LIMIT 1", r.name.replace('\'', "''")), 1).await?;
                    Ok(res.rows.first().and_then(|row| row.first()).map(|c| c.display().to_string()).unwrap_or_default() + ";")
                }
                rexa_drivers::Kind::MySql => {
                    let res = d.execute(&format!("SHOW CREATE TABLE {qualified}"), 1).await?;
                    Ok(res.rows.first().and_then(|row| row.get(1)).map(|c| c.display().to_string()).unwrap_or_default() + ";")
                }
                rexa_drivers::Kind::Postgres => {
                    let cols = d.columns(&r).await?;
                    let mut lines: Vec<String> = cols
                        .iter()
                        .map(|c| format!("  {} {}{}", d.quote_ident(&c.name), c.data_type, if c.nullable { "" } else { " NOT NULL" }))
                        .collect();
                    let pk: Vec<String> = cols.iter().filter(|c| c.is_primary_key).map(|c| d.quote_ident(&c.name)).collect();
                    if !pk.is_empty() {
                        lines.push(format!("  PRIMARY KEY ({})", pk.join(", ")));
                    }
                    anyhow::Ok(format!("CREATE TABLE {qualified} (\n{}\n);", lines.join(",\n")))
                }
            }
        });
        cx.spawn(async move |_, cx| {
            if let Ok(sql) = task.await {
                cx.update(|cx| cx.write_to_clipboard(gpui::ClipboardItem::new_string(sql)));
            }
        })
        .detach();
    }

    /// duplicateTable: `<table>_copy` with the data.
    fn duplicate_table(&mut self, table: &str, schema: &str, cx: &mut Context<Self>) {
        let src = self.qualified(schema, table);
        let dst = self.qualified(schema, &format!("{table}_copy"));
        let sql = match self.session.as_ref().map(|s| s.driver.kind()) {
            Some(rexa_drivers::Kind::Postgres) => format!("CREATE TABLE {dst} (LIKE {src} INCLUDING ALL); INSERT INTO {dst} SELECT * FROM {src};"),
            Some(rexa_drivers::Kind::MySql) => format!("CREATE TABLE {dst} LIKE {src}; INSERT INTO {dst} SELECT * FROM {src};"),
            _ => format!("CREATE TABLE {dst} AS SELECT * FROM {src};"),
        };
        self.run_ddl(sql, cx);
    }

    /// SidebarFlatTableRow
    pub fn render_table_row(&self, table: &TableRef, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let schema = self.selected_schema.clone().unwrap_or_default();
        let selected = self.selected_table.as_deref() == Some(table.name.as_str());
        let key = format!("{}.{}", schema, table.name);
        let group = SharedString::from(format!("trow-{key}"));
        let (n1, s1, n2, s2, n3, s3) = (table.name.clone(), schema.clone(), table.name.clone(), schema.clone(), table.name.clone(), schema.clone());
        let icon = if table.is_view { icons::lucide("eye") } else { icons::S_TABLE };
        let menu_id = format!("dd:table-{key}");
        let menu_open = self.menu_is_open(&menu_id) || self.menu_is_open(&format!("ctx:table-{key}"));
        self.sidebar_row(format!("table-{key}"), selected || menu_open, cx)
            .relative()
            .group(group.clone())
            .on_click(cx.listener(move |this, _, _, cx| this.open_table(&n1, Some(&s1), cx)))
            .on_mouse_down(MouseButton::Right, cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                let items = this.table_menu(&n2, &s2);
                this.open_menu(format!("ctx:table-{}.{}", s2, n2), e.position, 160., items, cx);
            }))
            .child(icon.el(16., t.muted_foreground))
            .child(div().flex_1().min_w_0().overflow_hidden().text_ellipsis().whitespace_nowrap().child(table.name.clone()))
            .child(
                div()
                    .id(SharedString::from(format!("tmenu-{key}")))
                    .absolute()
                    .right_1()
                    .top(px(4.))
                    .size_6()
                    .flex()
                    .items_center()
                    .justify_center()
                    .tw_rounded_md()
                    .text_color(t.muted_foreground)
                    .hover(move |s| s.bg(white(0.1)).text_color(t.foreground))
                    .opacity(0.)
                    .group_hover(group, |s| s.opacity(1.))
                    .on_mouse_down(MouseButton::Left, cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let items = this.table_menu(&n3, &s3);
                        this.open_menu(format!("dd:table-{}.{}", s3, n3), gpui::point(e.position.x - px(150.), e.position.y + px(12.)), 160., items, cx);
                    }))
                    .child(icons::lucide("ellipsis-vertical").el(14., t.muted_foreground)),
            )
            .into_any_element()
    }

    /// The bordered "schema / database" picker button (h-8 rounded-lg border-border/70 bg-white/[0.04] px-2 text-xs).
    fn picker(&self, id: &'static str, prefix: &str, value: &str, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        let open = self.menu_is_open(&format!("dd:{id}"));
        div()
            .id(id)
            .flex()
            .flex_1()
            .min_w_0()
            .h_8()
            .items_center()
            .gap(px(6.))
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.border, 0.7))
            .bg(white(if open { 0.06 } else { 0.04 }))
            .px_2()
            .tw_text_xs()
            .text_color(if open { t.foreground } else { t.muted_foreground })
            .cursor_pointer()
            .hover(move |s| s.bg(white(0.06)).text_color(t.foreground))
            .child(div().flex_shrink_0().text_color(with_alpha(t.muted_foreground, 0.7)).child(prefix.to_string()))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .overflow_hidden()
                    .text_ellipsis()
                    .whitespace_nowrap()
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(t.foreground)
                    .child(if value.is_empty() { "Select…".to_string() } else { value.to_string() }),
            )
            .child(icons::S_DOWN.el(14., t.muted_foreground).opacity(0.5))
    }

    fn square_button(&self, id: &'static str, ico: icons::Ico, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        div()
            .id(id)
            .size_8()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.border, 0.7))
            .bg(white(0.04))
            .text_color(t.muted_foreground)
            .cursor_pointer()
            .hover(move |s| s.bg(white(0.06)).text_color(t.foreground))
            .child(ico.el(14., t.muted_foreground))
    }

    fn filter_menu(&self) -> Vec<MenuEntry> {
        let tf = self.type_filter;
        let total = self.tables.iter().filter(|t| !t.is_view).count();
        let views = self.tables.iter().filter(|t| t.is_view).count();
        vec![
            MenuEntry::Label("Show".into()),
            MenuEntry::item("All", |s, _, cx| { s.type_filter = TypeFilter::All; cx.notify() }).checked(tf == TypeFilter::All),
            MenuEntry::item(format!("Tables ({total})"), |s, _, cx| { s.type_filter = TypeFilter::Tables; cx.notify() }).checked(tf == TypeFilter::Tables),
            MenuEntry::item(format!("Views ({views})"), |s, _, cx| { s.type_filter = TypeFilter::Views; cx.notify() }).checked(tf == TypeFilter::Views),
            MenuEntry::Separator,
            MenuEntry::item("Case sensitive", |s, _, cx| { s.case_sensitive = !s.case_sensitive; cx.notify() }).checked(self.case_sensitive),
            MenuEntry::item("Wildcards (% and _)", |s, _, cx| { s.wildcards = !s.wildcards; cx.notify() }).checked(self.wildcards),
            MenuEntry::Separator,
            MenuEntry::item("Refresh", |s, _, cx| s.refresh_tables(cx)).icon(icons::lucide("refresh-cw")).disabled(self.fetching_tables),
        ]
    }

    /// TagFoldersList
    fn render_tag_folders(&self, filtered: &[TableRef], cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let schema = self.selected_schema.clone().unwrap_or_default();
        let tags_for = |name: &str| self.table_tags.get(&format!("{schema}.{name}")).cloned().unwrap_or_default();
        let mut col = div().flex().min_w_0().flex_col().gap(px(1.)).py(px(2.));
        let folder_row = |this: &Studio, key: &str, name: &str, expanded: bool, color: Option<gpui::Hsla>, cx: &mut Context<Studio>| {
            let k = key.to_string();
            let ico = if expanded { icons::S_FOLDER_OPEN } else { icons::S_FOLDER };
            let _ = this;
            div()
                .id(SharedString::from(format!("folder-{key}")))
                .flex()
                .h_7()
                .w_full()
                .min_w_0()
                .items_center()
                .gap(px(6.))
                .tw_rounded_md()
                .px(px(6.))
                .text_size(px(13.))
                .text_color(t.muted_foreground)
                .cursor_pointer()
                .hover(move |s| s.bg(white(0.05)).text_color(t.foreground))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let cur = *this.expanded_tags.get(&k).unwrap_or(&true);
                    this.expanded_tags.insert(k.clone(), !cur);
                    cx.notify();
                }))
                .child(ico.el(16., color.unwrap_or_default()))
                .child(div().flex_1().min_w_0().overflow_hidden().text_ellipsis().whitespace_nowrap().child(name.to_string()))
        };
        let children = |this: &Studio, tables: Vec<TableRef>, empty: &str, cx: &mut Context<Studio>| {
            let mut c = div().relative().ml(px(15.)).flex().flex_col().gap(px(1.)).border_l_1().border_color(with_alpha(t.border, 0.5)).pl_1();
            if tables.is_empty() {
                c = c.child(div().px_2().py_1().tw_text_11().text_color(with_alpha(t.muted_foreground, 0.6)).child(empty.to_string()));
            }
            for tb in &tables {
                c = c.child(this.render_table_row(tb, cx));
            }
            c
        };
        if self.tags.is_empty() {
            col = col.child(
                div()
                    .id("no-tags")
                    .flex()
                    .h_7()
                    .items_center()
                    .gap(px(6.))
                    .tw_rounded_md()
                    .px(px(6.))
                    .text_size(px(13.))
                    .text_color(t.muted_foreground)
                    .hover(move |s| s.bg(white(0.05)).text_color(t.foreground))
                    .on_click(cx.listener(|this, _, w, cx| this.open_tag_manager(w, cx)))
                    .child(icons::lucide("tag").el(16., t.muted_foreground).opacity(0.6))
                    .child("No tags yet — create one"),
            );
        }
        for (name, color) in self.tags.clone() {
            let expanded = *self.expanded_tags.get(&name).unwrap_or(&true);
            let (n1, n2) = (name.clone(), name.clone());
            let row = folder_row(self, &name, &name, expanded, rexa_ui::parse_color(&color), cx).on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                    let (a, b) = (n1.clone(), n2.clone());
                    let items = vec![
                        MenuEntry::item("Rename tag", move |s, w, cx| s.open_rename_tag(&a, w, cx)),
                        MenuEntry::item("Delete tag", move |s, _, cx| s.remove_tag(&b, cx)).tone(Tone::Red),
                    ];
                    this.open_menu("ctx:tag", e.position, 160., items, cx);
                }),
            );
            col = col.child(row);
            if expanded {
                let tables: Vec<TableRef> = filtered.iter().filter(|tb| tags_for(&tb.name).contains(&name)).cloned().collect();
                col = col.child(children(self, tables, "No tables", cx));
            }
        }
        let expanded = *self.expanded_tags.get("__untagged").unwrap_or(&true);
        col = col.child(folder_row(self, "__untagged", "Untagged", expanded, None, cx));
        if expanded {
            let untagged: Vec<TableRef> = filtered.iter().filter(|tb| tags_for(&tb.name).is_empty()).cloned().collect();
            col = col.child(children(self, untagged, "Everything is tagged", cx));
        }
        col.into_any_element()
    }

    /// DatabaseObjectSections (Schema Explorer)
    fn render_object_sections(&self, query: &str, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.settings.schema_explorer {
            return None;
        }
        let t = cx.tokens().clone();
        let sections = catalog::sections(&self.objects, query);
        if sections.is_empty() {
            return None;
        }
        let mut col = div().flex().flex_col().gap_1();
        for s in sections {
            let key = s.kind.key().to_string();
            let expanded = !query.is_empty() || *self.expanded_sections.get(&key).unwrap_or(&true);
            let k = key.clone();
            col = col.child(
                div()
                    .id(SharedString::from(format!("section-{key}")))
                    .flex()
                    .w_full()
                    .items_center()
                    .gap(px(6.))
                    .tw_rounded_md()
                    .px_1()
                    .py_1()
                    .tw_text_xs()
                    .text_color(with_alpha(t.muted_foreground, 0.8))
                    .cursor_pointer()
                    .hover(move |st| st.text_color(t.foreground))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let cur = *this.expanded_sections.get(&k).unwrap_or(&true);
                        this.expanded_sections.insert(k.clone(), !cur);
                        cx.notify();
                    }))
                    .child(icons::S_RIGHT.el(12., t.muted_foreground).when(expanded, |s| s.with_transformation(gpui::Transformation::rotate(gpui::radians(std::f32::consts::FRAC_PI_2)))))
                    .child(icons::lucide(s.kind.icon()).el(14., t.muted_foreground))
                    .child(s.kind.section_label())
                    .child(div().text_color(with_alpha(t.muted_foreground, 0.5)).child(format!("({})", s.items.len()))),
            );
            if expanded {
                for o in s.items {
                    let obj = o.clone();
                    col = col.child(
                        self.sidebar_row(format!("obj-{}", o.key()), false, cx)
                            .on_click(cx.listener(move |this, _, _, cx| this.open_object_tab(&obj, cx)))
                            .child(icons::lucide(o.kind.icon()).el(16., t.muted_foreground))
                            .child(div().flex_1().min_w_0().overflow_hidden().text_ellipsis().whitespace_nowrap().child(o.name.clone())),
                    );
                }
            }
        }
        Some(col.into_any_element())
    }

    pub fn render_explorer(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let query = self.search_query(cx);
        let filtered = self.filtered_tables(cx);
        let filters_active = self.type_filter != TypeFilter::All || self.case_sensitive || !self.wildcards;
        let tag_view = self.sidebar_sort_mode == "tags";
        let schema = self.selected_schema.clone().unwrap_or_default();

        // Search row
        let filter_btn = div()
            .id("tables-filter")
            .relative()
            .size_6()
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .tw_rounded_md()
            .text_color(if filters_active { t.primary } else { t.muted_foreground })
            .hover(move |s| s.bg(white(0.1)).text_color(if filters_active { t.primary } else { t.foreground }))
            .on_mouse_down(MouseButton::Left, cx.listener(|this, e: &gpui::MouseDownEvent, _, cx| {
                cx.stop_propagation();
                let items = this.filter_menu();
                this.open_menu("dd:tables-filter", gpui::point(e.position.x - px(180.), e.position.y + px(14.)), 200., items, cx);
            }))
            .child(icons::lucide("list-filter").el(14., t.muted_foreground))
            .when(filters_active, |d| d.child(div().absolute().right_1().top_1().size(px(6.)).rounded_full().bg(t.primary)));
        let search = TextInput::new(&self.search)
            .h(32.)
            .prefix(icons::S_SEARCH.el(14., t.muted_foreground))
            .suffix(filter_btn);
        let refreshing = self.fetching_tables;
        let refresh = self
            .square_button("tables-refresh", icons::lucide("refresh-cw"), cx)
            .when(refreshing, |d| d.opacity(0.5))
            .on_click(cx.listener(|this, _, _, cx| {
                if !this.fetching_tables {
                    this.refresh_tables(cx)
                }
            }));
        let mut col = div().flex().h_full().min_h_0().flex_col().gap(px(2.)).child(
            div().my_1().flex().flex_shrink_0().items_center().gap_1().child(div().flex_1().min_w_0().child(search)).when(self.db_type != "mongodb", |d| d.child(refresh)),
        );

        // Database picker (Database Explorer, plain Postgres)
        if self.settings.database_explorer && self.db_type == "postgres" {
            let current = self.current_database.clone();
            col = col.child(div().mb_1().flex().flex_shrink_0().items_center().child(self.picker("database-picker", "database", &current, cx).on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, e: &gpui::MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    let mut items: Vec<MenuEntry> = this.databases.iter().map(|d| MenuEntry::item(d.clone(), |_, _, _| {}).checked(*d == this.current_database)).collect();
                    if items.is_empty() {
                        items.push(MenuEntry::item("No databases", |_, _, _| {}).disabled(true));
                    }
                    this.open_menu("dd:database-picker", gpui::point(e.position.x - px(60.), e.position.y + px(14.)), 232., items, cx);
                }),
            )));
        }

        // Schema picker + new table
        let new_btn = if self.db_type == "redis" {
            self.square_button("new-key", icons::lucide("key-round"), cx).on_click(cx.listener(|this, _, _, cx| this.open_simple("create-key", cx)))
        } else {
            self.square_button("new-table", icons::lucide("plus"), cx).on_click(cx.listener(|this, _, _, cx| this.open_simple("create-table", cx)))
        };
        col = col.child(
            div()
                .mb_1()
                .flex()
                .flex_shrink_0()
                .items_center()
                .gap_1()
                .child(self.picker("schema-picker", "schema", &schema, cx).on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|this, e: &gpui::MouseDownEvent, _, cx| {
                        cx.stop_propagation();
                        let current = this.selected_schema.clone().unwrap_or_default();
                        let mut items: Vec<MenuEntry> = this
                            .schemas
                            .iter()
                            .filter(|s| !s.starts_with("pg_"))
                            .map(|s| {
                                let s2 = s.clone();
                                MenuEntry::item(s.clone(), move |this, _, cx| this.set_selected_schema(s2.clone(), cx)).checked(*s == current)
                            })
                            .collect();
                        if items.is_empty() {
                            items.push(MenuEntry::item("No schemas", |_, _, _| {}).disabled(true));
                        }
                        this.open_menu("dd:schema-picker", gpui::point(e.position.x - px(60.), e.position.y + px(14.)), 200., items, cx);
                    }),
                ))
                .child(new_btn),
        );

        // A-Z / Tags toggle + count
        let seg = |id: &'static str, label: &'static str, on: bool, cx: &mut Context<Studio>| {
            div()
                .id(id)
                .h_full()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_md()
                .px_3()
                .cursor_pointer()
                .map(|d| if on { d.bg(white(0.1)).text_color(t.foreground) } else { d.text_color(t.muted_foreground).hover(move |s| s.text_color(t.foreground)) })
                .on_click(cx.listener(move |this, _, _, cx| this.set_sort_mode(if id == "sort-az" { "alphabetical" } else { "tags" }, cx)))
                .child(label)
        };
        let total = self.tables.len();
        let noun = self.item_noun().to_lowercase();
        let count_text = if !query.trim().is_empty() || filters_active { format!("{}/{}", filtered.len(), total) } else { total.to_string() };
        col = col.child(
            div()
                .mb_1()
                .flex()
                .flex_shrink_0()
                .items_center()
                .gap_2()
                .child(
                    div()
                        .flex()
                        .h_7()
                        .flex_shrink_0()
                        .items_center()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(with_alpha(t.border, 0.7))
                        .bg(white(0.04))
                        .p(px(2.))
                        .tw_text_xs()
                        .child(seg("sort-az", "A-Z", !tag_view, cx))
                        .child(seg("sort-tags", "Tags", tag_view, cx)),
                )
                .when(tag_view, |d| {
                    d.child(
                        div()
                            .id("new-tag")
                            .flex()
                            .h_7()
                            .flex_shrink_0()
                            .items_center()
                            .gap_1()
                            .px_1()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .cursor_pointer()
                            .hover(move |s| s.text_color(t.foreground))
                            .on_click(cx.listener(|this, _, w, cx| this.open_tag_manager(w, cx)))
                            .child(icons::lucide("plus").el(14., t.muted_foreground))
                            .when(self.sidebar_width >= 240., |d| d.child("New Tag")),
                    )
                })
                .when(self.settings.show_table_count && !(tag_view && self.sidebar_width < 205.), |d| {
                    d.child(
                        div()
                            .id("table-count")
                            .ml_auto()
                            .flex_shrink_0()
                            .pr(px(2.))
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .tooltip(move |w, cx| rexa_ui::overlay::tooltip::Tooltip::new(format!("{total} {noun}s")).build(w, cx))
                            .child(count_text),
                    )
                }),
        );

        // List
        if tag_view {
            col = col.child(div().id("tag-folders").flex_1().min_h_0().overflow_y_scroll().pb_1().child(self.render_tag_folders(&filtered, cx)));
        } else if filtered.is_empty() {
            let msg = if self.fetching_tables && self.tables.is_empty() { "" } else if query.is_empty() { "No tables" } else { "No matches" };
            col = col.child(div().px_2().py_2().tw_text_xs().text_color(t.muted_foreground).child(msg));
        } else {
            let items = filtered.clone();
            let ent = cx.entity();
            col = col.child(
                uniform_list("tables-list", items.len(), move |range, _, cx| {
                    let items = items.clone();
                    ent.update(cx, |this, cx| range.map(|i| div().pb(px(2.)).child(this.render_table_row(&items[i], cx))).collect::<Vec<_>>())
                })
                .flex_1()
                .min_h_0(),
            );
        }
        if let Some(sections) = self.render_object_sections(&query, cx) {
            col = col.child(
                div()
                    .id("object-sections")
                    .flex()
                    .flex_col()
                    .flex_shrink_0()
                    .max_h(gpui::relative(0.45))
                    .gap_1()
                    .overflow_y_scroll()
                    .border_t_1()
                    .border_color(with_alpha(t.border, 0.5))
                    .pt_1()
                    .child(sections),
            );
        }
        col.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::matches_table_name as m;

    #[test]
    fn like_and_substring() {
        assert!(m("users", "use", false, true));
        assert!(m("Users", "USE", false, true));
        assert!(!m("Users", "USE", true, true));
        assert!(m("proj_orders", "proj%", false, true));
        assert!(!m("xproj_orders", "proj%", false, true));
        assert!(m("proj_orders", "PROJ\\_", false, true));
        assert!(m("a%b", "%", false, false));
    }
}
