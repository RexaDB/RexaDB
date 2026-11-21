//! Port of components/studio/database/schema-diagram.tsx (the read-only live
//! "Schema Diagram", `database-schema` / `TabSpec::Erd`): React Flow canvas with
//! Supabase-style table nodes (160px wide, 22px header/rows, PK / nullable /
//! unique / identity icons), smooth-step FK edges, dot background, zoom
//! controls, legend, and the top-right panel (schema menu, Copy SQL, Download,
//! Auto / Grid layout, Refresh).
//!
//! Emulated by hand (GPUI has no React Flow): pan by dragging the background,
//! wheel / pinch zoom around the cursor (0.2–2), node dragging by the header,
//! `fitView` (padding 0.2). Approximations / not ported: edge selection + its
//! relation badge, drag-to-connect (→ add-fk sheet), PNG/SVG download (toast),
//! filled "non-nullable" diamond (drawn as a solid rhombus), the ERD designer
//! (`erd/*`, editable mode).

pub mod layout;

use crate::common;
use gpui::{
    canvas, div, point, prelude::*, px, AnyElement, App, Bounds, ClipboardItem, Context, Entity, FontWeight, Hsla, MouseButton, MouseDownEvent, MouseMoveEvent, PathBuilder, Pixels, Point, SharedString,
    Window,
};
use layout::{LayoutNode, HEADER_HEIGHT, NODE_WIDTH, ROW_HEIGHT};
use rexa_core::{runtime, studio_bus, Session, StudioEvent, TabSpec};
use rexa_drivers::SchemaColumn;
use rexa_ui::widgets::Icon;
use rexa_ui::{with_alpha, ActiveTokens, Align, Button, ButtonSize, DropdownMenu, IconName, MenuItem, Spinner, Toast, Tw, MONO};
use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

#[derive(Clone, Debug, Default)]
pub struct DiagramColumn {
    pub name: String,
    pub r#type: String,
    pub is_primary: bool,
    pub is_nullable: bool,
    /// (schema, table, column)
    pub references: Option<(String, String, String)>,
}

#[derive(Clone, Debug, Default)]
pub struct DiagramTable {
    pub schema: String,
    pub name: String,
    pub columns: Vec<DiagramColumn>,
}

/// Group `all_tables_with_columns` rows into tables (the studio's `schemaData`).
pub fn tables_from_columns(rows: &[SchemaColumn]) -> Vec<DiagramTable> {
    let mut out: Vec<DiagramTable> = Vec::new();
    for r in rows {
        let col = DiagramColumn {
            name: r.column_name.clone(),
            r#type: r.data_type.clone(),
            is_primary: r.is_primary,
            is_nullable: r.is_nullable,
            references: match (&r.referenced_table_name, &r.referenced_column_name) {
                (Some(t), Some(c)) => Some((r.referenced_table_schema.clone().unwrap_or_else(|| r.table_schema.clone()), t.clone(), c.clone())),
                _ => None,
            },
        };
        match out.iter_mut().find(|t| t.schema == r.table_schema && t.name == r.table_name) {
            Some(t) => {
                if !t.columns.iter().any(|c| c.name == col.name) {
                    t.columns.push(col)
                }
            }
            None => out.push(DiagramTable { schema: r.table_schema.clone(), name: r.table_name.clone(), columns: vec![col] }),
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn quote(v: &str, db: &str) -> String {
    match db {
        "mysql" | "clickhouse" => format!("`{v}`"),
        "mssql" => format!("[{v}]"),
        _ => format!("\"{}\"", v.replace('"', "\"\"")),
    }
}

fn quote_table(schema: &str, table: &str, db: &str) -> String {
    if db == "sqlite" {
        quote(table, db)
    } else {
        format!("{}.{}", quote(schema, db), quote(table, db))
    }
}

fn svg_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Export the current diagram as a self-contained SVG image.
pub fn diagram_svg(tables: &[DiagramTable], positions: &HashMap<String, (f32, f32)>) -> String {
    let width = tables.iter().filter_map(|t| positions.get(&t.name).map(|(x, _)| x + NODE_WIDTH)).fold(640f32, f32::max) + 32.;
    let height = tables.iter().filter_map(|t| positions.get(&t.name).map(|(_, y)| y + layout::estimate_height(t.columns.len()))).fold(360f32, f32::max) + 32.;
    let mut out = format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width:.0}\" height=\"{height:.0}\" viewBox=\"0 0 {width:.0} {height:.0}\"><rect width=\"100%\" height=\"100%\" fill=\"#111827\"/>");
    for table in tables {
        let Some(&(x1, y1)) = positions.get(&table.name) else { continue };
        for col in &table.columns {
            let Some((_, target, _)) = &col.references else { continue };
            let Some(&(x2, y2)) = positions.get(target) else { continue };
            let (sx, sy) = (x1 + NODE_WIDTH, y1 + layout::estimate_height(table.columns.len()) / 2.);
            let (tx, ty) = (x2, y2 + layout::estimate_height(tables.iter().find(|t| t.name == *target).map_or(0, |t| t.columns.len())) / 2.);
            out.push_str(&format!("<path d=\"M {sx:.1} {sy:.1} C {:.1} {sy:.1}, {:.1} {ty:.1}, {tx:.1} {ty:.1}\" fill=\"none\" stroke=\"#6b7280\" stroke-width=\"1.5\"/>", sx+24., tx-24.));
        }
    }
    for table in tables {
        let Some(&(x, y)) = positions.get(&table.name) else { continue };
        let h = layout::estimate_height(table.columns.len());
        out.push_str(&format!("<rect x=\"{x:.1}\" y=\"{y:.1}\" width=\"{NODE_WIDTH}\" height=\"{h:.1}\" rx=\"5\" fill=\"#1f2937\" stroke=\"#4b5563\"/><rect x=\"{x:.1}\" y=\"{y:.1}\" width=\"{NODE_WIDTH}\" height=\"{HEADER_HEIGHT}\" rx=\"5\" fill=\"#374151\"/><text x=\"{:.1}\" y=\"{:.1}\" fill=\"#f9fafb\" font-family=\"monospace\" font-size=\"12\">{}</text>", x+8., y+15., svg_escape(&table.name)));
        for (i, col) in table.columns.iter().enumerate() {
            let cy = y + HEADER_HEIGHT + (i as f32 + 1.) * ROW_HEIGHT - 6.;
            out.push_str(&format!("<text x=\"{:.1}\" y=\"{cy:.1}\" fill=\"#e5e7eb\" font-family=\"monospace\" font-size=\"10\">{}</text><text x=\"{:.1}\" y=\"{cy:.1}\" fill=\"#9ca3af\" font-family=\"monospace\" font-size=\"9\" text-anchor=\"end\">{}</text>", x+8., svg_escape(&col.name), x+NODE_WIDTH-7., svg_escape(&col.r#type)));
        }
    }
    out.push_str("</svg>");
    out
}

fn diagram_png(svg: &str) -> anyhow::Result<Vec<u8>> {
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = resvg::usvg::Tree::from_str(svg, &options)?;
    let size = tree.size();
    let (w, h) = (size.width().ceil().max(1.), size.height().ceil().max(1.));
    // Export at 2x for crisp text while keeping large schemas bounded.
    let scale = 2f32.min(8192. / w).min(8192. / h).min((48_000_000f32 / (w * h)).sqrt());
    let (width, height) = ((w * scale).ceil() as u32, (h * scale).ceil() as u32);
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height).ok_or_else(|| anyhow::anyhow!("Diagram is too large to export as PNG."))?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    Ok(pixmap.encode_png()?)
}

/// `buildTableSql`.
pub fn build_table_sql(t: &DiagramTable, schema: &str, db: &str) -> String {
    let mut lines: Vec<String> = t
        .columns
        .iter()
        .map(|c| {
            let mut l = format!("  {} {}", quote(&c.name, db), c.r#type);
            if !c.is_nullable {
                l.push_str(" NOT NULL");
            }
            if let Some((s, tb, col)) = &c.references {
                l.push_str(&format!(" REFERENCES {} ({})", quote_table(s, tb, db), quote(col, db)));
            }
            l
        })
        .collect();
    let pks: Vec<String> = t.columns.iter().filter(|c| c.is_primary).map(|c| quote(&c.name, db)).collect();
    if !pks.is_empty() {
        lines.push(format!("  PRIMARY KEY ({})", pks.join(", ")));
    }
    format!("CREATE TABLE {} (\n{}\n);", quote_table(schema, &t.name, db), lines.join(",\n"))
}

/// `buildSchemaSql` (referenced tables first).
pub fn build_schema_sql(tables: &[DiagramTable], schema: &str, db: &str) -> String {
    let by: HashMap<&str, &DiagramTable> = tables.iter().map(|t| (t.name.as_str(), t)).collect();
    let mut visited = std::collections::HashSet::new();
    let mut visiting = std::collections::HashSet::new();
    let mut ordered: Vec<&DiagramTable> = Vec::new();
    fn visit<'a>(n: &'a str, by: &HashMap<&'a str, &'a DiagramTable>, schema: &str, visited: &mut std::collections::HashSet<&'a str>, visiting: &mut std::collections::HashSet<&'a str>, out: &mut Vec<&'a DiagramTable>) {
        if visited.contains(n) || visiting.contains(n) {
            return;
        }
        let Some(t) = by.get(n) else { return };
        visiting.insert(n);
        for c in &t.columns {
            if let Some((s, tb, _)) = &c.references {
                if s.eq_ignore_ascii_case(schema) {
                    if let Some(k) = by.keys().find(|k| **k == tb.as_str()) {
                        visit(k, by, schema, visited, visiting, out);
                    }
                }
            }
        }
        visiting.remove(n);
        visited.insert(n);
        out.push(t);
    }
    for t in tables {
        visit(&t.name, &by, schema, &mut visited, &mut visiting, &mut ordered);
    }
    ordered.iter().map(|t| build_table_sql(t, schema, db)).collect::<Vec<_>>().join("\n\n")
}

#[derive(Clone, Copy, PartialEq)]
enum LayoutMode {
    Auto,
    Grid,
}

enum Drag {
    Pan { start: Point<Pixels>, pan0: Point<f32> },
    Node { id: String, start: Point<Pixels>, pos0: (f32, f32) },
}

pub struct SchemaDiagram {
    session: Arc<Session>,
    _spec: TabSpec,
    db_type: &'static str,
    schema: String,
    schemas: Vec<String>,
    tables: Vec<DiagramTable>,
    loading: bool,
    positions: HashMap<String, (f32, f32)>,
    mode: LayoutMode,
    pan: Point<f32>,
    zoom: f32,
    drag: Option<Drag>,
    bounds: Rc<Cell<Bounds<Pixels>>>,
    needs_fit: bool,
    copied: bool,
    _subs: Vec<gpui::Subscription>,
}

impl SchemaDiagram {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, cx: &mut Context<Self>) -> Self {
        let my = spec.clone();
        let subs = vec![cx.subscribe(&studio_bus(cx), move |v: &mut Self, _, e: &StudioEvent, cx| match e {
            StudioEvent::SchemaChanged => v.load(cx),
            StudioEvent::TabCommand { tab, command } if *tab == my && command == "REFRESH_CURRENT_TAB" => v.load(cx),
            _ => {}
        })];
        let schema = schema.filter(|s| !s.is_empty()).unwrap_or_else(|| common::default_schema(&session));
        let mut this = SchemaDiagram {
            db_type: common::db_type(&session),
            session,
            _spec: spec,
            schema,
            schemas: Vec::new(),
            tables: Vec::new(),
            loading: true,
            positions: HashMap::new(),
            mode: LayoutMode::Auto,
            pan: point(0., 0.),
            zoom: 1.,
            drag: None,
            bounds: Rc::default(),
            needs_fit: false,
            copied: false,
            _subs: subs,
        };
        let fut = common::load_schemas(&this.session);
        cx.spawn(async move |this, cx| {
            if let Ok(s) = fut.await {
                this.update(cx, |v, cx| {
                    v.schemas = s;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
        this.load(cx);
        this
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        cx.notify();
        let d = self.session.driver.clone();
        let s = self.schema.clone();
        let fut = runtime::spawn(async move { d.all_tables_with_columns(Some(&s)).await });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loading = false;
                match r {
                    Ok(rows) => {
                        let schema = v.schema.clone();
                        v.tables = tables_from_columns(&rows).into_iter().filter(|t| t.schema.eq_ignore_ascii_case(&schema)).collect();
                        v.relayout(true);
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

    fn edges(&self) -> Vec<(String, String)> {
        let mut e = Vec::new();
        for t in &self.tables {
            for c in &t.columns {
                if let Some((s, tb, _)) = &c.references {
                    if *s == self.schema && self.tables.iter().any(|x| x.name == *tb) {
                        e.push((t.name.clone(), tb.clone()));
                    }
                }
            }
        }
        e
    }

    fn layout_key(&self) -> String {
        format!("rexadb:erd-layout:{}:{}", self.session.connection.id, self.schema)
    }

    fn saved_positions(&self) -> HashMap<String, (f32, f32)> {
        rexa_store::Store::open()
            .ok()
            .and_then(|s| s.setting(&self.layout_key()).ok().flatten())
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn save_positions(&self) {
        if let Ok(store) = rexa_store::Store::open() {
            let _ = store.set_setting(&self.layout_key(), &serde_json::to_string(&self.positions).unwrap_or_default());
        }
    }

    fn relayout(&mut self, restore_saved: bool) {
        let nodes: Vec<LayoutNode> = self.tables.iter().map(|t| LayoutNode { id: t.name.clone(), height: layout::estimate_height(t.columns.len()) }).collect();
        let edges = self.edges();
        self.positions = match self.mode {
            LayoutMode::Auto => layout::dagre(&nodes, &edges),
            LayoutMode::Grid => layout::grid(&nodes, &edges),
        };
        if restore_saved {
            for (name, position) in self.saved_positions() {
                if self.tables.iter().any(|t| t.name == name) { self.positions.insert(name, position); }
            }
        }
        self.save_positions();
        self.needs_fit = true;
    }

    fn content_bounds(&self, only: Option<&str>) -> Option<(f32, f32, f32, f32)> {
        let mut b: Option<(f32, f32, f32, f32)> = None;
        for t in &self.tables {
            if only.is_some_and(|o| o != t.name) {
                continue;
            }
            let Some(&(x, y)) = self.positions.get(&t.name) else { continue };
            let (x2, y2) = (x + NODE_WIDTH, y + layout::estimate_height(t.columns.len()));
            b = Some(match b {
                None => (x, y, x2, y2),
                Some((a, bb, c, d)) => (a.min(x), bb.min(y), c.max(x2), d.max(y2)),
            });
        }
        b
    }

    /// `fitView({ padding })`.
    fn fit(&mut self, only: Option<&str>, padding: f32) {
        let vb = self.bounds.get();
        let (vw, vh) = (f32::from(vb.size.width), f32::from(vb.size.height));
        let Some((x1, y1, x2, y2)) = self.content_bounds(only) else { return };
        if vw <= 0. || vh <= 0. {
            return;
        }
        let (bw, bh) = ((x2 - x1).max(1.), (y2 - y1).max(1.));
        let z = (vw / (bw * (1. + padding * 2.))).min(vh / (bh * (1. + padding * 2.))).clamp(0.2, 2.);
        self.zoom = z;
        self.pan = point(vw / 2. - (x1 + bw / 2.) * z, vh / 2. - (y1 + bh / 2.) * z);
    }

    fn zoom_at(&mut self, factor: f32, at: Point<f32>) {
        let z2 = (self.zoom * factor).clamp(0.2, 2.);
        let r = z2 / self.zoom;
        self.pan = point(at.x - (at.x - self.pan.x) * r, at.y - (at.y - self.pan.y) * r);
        self.zoom = z2;
    }

    fn local(&self, p: Point<Pixels>) -> Point<f32> {
        let o = self.bounds.get().origin;
        point(f32::from(p.x - o.x), f32::from(p.y - o.y))
    }

    fn copy_sql(&mut self, cx: &mut Context<Self>) {
        if matches!(self.db_type, "mongodb" | "redis" | "spacetimedb") {
            Toast::info("Copy as SQL is available for relational schemas only").show(cx);
            return;
        }
        cx.write_to_clipboard(ClipboardItem::new_string(build_schema_sql(&self.tables, &self.schema, self.db_type)));
        Toast::success("Schema SQL copied").show(cx);
        self.copied = true;
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(std::time::Duration::from_secs(2)).await;
            this.update(cx, |v, cx| {
                v.copied = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn set_schema(&mut self, s: String, cx: &mut Context<Self>) {
        if s != self.schema {
            self.schema = s;
            self.tables.clear();
            self.load(cx);
        }
    }

    fn node(&self, t: &DiagramTable, cx: &mut Context<Self>) -> AnyElement {
        let tk = cx.tokens().clone();
        let z = self.zoom;
        let Some(&(x, y)) = self.positions.get(&t.name) else { return div().into_any_element() };
        let s = |v: f32| px(v * z);
        let muted = tk.muted_foreground;
        let name = t.name.clone();
        let (n1, n2, n3, n4) = (name.clone(), name.clone(), name.clone(), name.clone());
        let sql = build_table_sql(t, &self.schema, self.db_type);
        let schema = self.schema.clone();
        let this = cx.entity();
        let menu = DropdownMenu::new(SharedString::from(format!("erd-menu-{name}")))
            .align(Align::End)
            .trigger(div().id(SharedString::from(format!("erd-mt-{name}"))).size(s(16.)).flex().items_center().justify_center().text_color(muted).hover(|st| st.text_color(tk.foreground)).child(Icon::new(IconName::EllipsisVertical).size(s(10.))))
            .menu(move |m, _, _| {
                let (a, b, c, d, sql, schema, this) = (n1.clone(), n2.clone(), n3.clone(), n4.clone(), sql.clone(), schema.clone(), this.clone());
                m.w(160.)
                    .item(MenuItem::new("Copy name").icon(IconName::Copy).on_select(move |_, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(a.clone()));
                        Toast::success("Table name copied").show(cx);
                    }))
                    .item(MenuItem::new("Copy SQL").icon(IconName::PencilLine).on_select(move |_, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(sql.clone()));
                        Toast::success("Table SQL copied").show(cx);
                        let _ = &b;
                    }))
                    .item(MenuItem::new("Table editor").icon(IconName::Rows3).on_select(move |_, cx| common::open_table(&schema, &c, cx)))
                    .item(MenuItem::new("Focus in schema").icon(IconName::GitFork).on_select(move |_, cx| {
                        let d = d.clone();
                        this.update(cx, |v, cx| {
                            v.fit(Some(&d), 0.5);
                            cx.notify();
                        })
                    }))
            });
        let header = div()
            .id(SharedString::from(format!("erd-h-{name}")))
            .h(s(HEADER_HEIGHT))
            .pl(s(8.))
            .pr(s(4.))
            .bg(tk.muted)
            .flex()
            .gap(s(8.))
            .items_center()
            .justify_between()
            .border_b(s(1.))
            .border_color(with_alpha(tk.border, 0.6))
            .cursor_grab()
            .text_size(s(8.8))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |v, e: &MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    if let Some(&p) = v.positions.get(&name) {
                        v.drag = Some(Drag::Node { id: name.clone(), start: e.position, pos0: p });
                    }
                }),
            )
            .child(div().min_w_0().flex().flex_shrink(1.).gap_x(s(4.)).items_center().child(Icon::new(IconName::Table).size(s(12.)).text_color(muted).flex_shrink_0()).child(div().truncate().text_color(with_alpha(tk.foreground, 0.9)).child(t.name.clone())))
            .child(menu);
        let mut card = div()
            .w(s(NODE_WIDTH))
            .overflow_hidden()
            .rounded(s(4.))
            .border(s(0.5))
            .border_color(tk.border)
            .bg(tk.card)
            .shadow(rexa_ui::popup::shadow_sm())
            .child(header);
        for c in &t.columns {
            let identity = { let l = c.r#type.to_lowercase(); l.contains("serial") || l.contains("identity") || l.contains("auto_increment") };
            let icons = div()
                .flex()
                .gap(s(3.84))
                .mx(s(8.))
                .items_center()
                .when(c.is_primary, |d| d.child(Icon::new(IconName::Key).size(s(8.)).text_color(muted)))
                .child(if c.is_nullable {
                    Icon::new(IconName::Diamond).size(s(8.)).text_color(muted).into_any_element()
                } else {
                    div().size(s(8.)).flex().items_center().justify_center().child(Icon::new(IconName::Diamond).size(s(8.)).text_color(muted)).child(div().absolute().size(s(4.)).bg(muted).rounded(s(1.))).relative().into_any_element()
                })
                .when(c.is_primary, |d| d.child(Icon::new(IconName::FingerprintPattern).size(s(8.)).text_color(muted)))
                .when(identity, |d| d.child(Icon::new(IconName::Hash).size(s(8.)).text_color(muted)));
            card = card.child(
                div()
                    .h(s(ROW_HEIGHT))
                    .flex()
                    .flex_row()
                    .items_center()
                    .bg(tk.card)
                    .border_t(s(0.5))
                    .border_color(with_alpha(tk.border, 0.6))
                    .hover(|st| st.bg(with_alpha(tk.muted, 0.4)))
                    .pr(s(4.))
                    .text_size(s(8.))
                    .child(icons)
                    .child(
                        div()
                            .flex()
                            .w_full()
                            .justify_between()
                            .min_w_0()
                            .child(div().truncate().min_w_0().max_w(gpui::relative(0.8)).text_color(with_alpha(tk.foreground, 0.8)).child(c.name.clone()))
                            .child(div().flex_shrink_0().pl(s(8.)).pr(s(4.)).font_family(MONO).text_color(with_alpha(muted, 0.6)).text_size(s(6.4)).child(c.r#type.clone())),
                    ),
            );
        }
        div().absolute().left(px(self.pan.x + x * z)).top(px(self.pan.y + y * z)).child(card).into_any_element()
    }

    /// Edge geometry in local coords: (sx, sy, tx, ty).
    fn edge_lines(&self) -> Vec<(f32, f32, f32, f32)> {
        let z = self.zoom;
        let mut out = Vec::new();
        for t in &self.tables {
            let Some(&(x, y)) = self.positions.get(&t.name) else { continue };
            for (ci, c) in t.columns.iter().enumerate() {
                let Some((s, tb, tc)) = &c.references else { continue };
                if *s != self.schema {
                    continue;
                }
                let Some(target) = self.tables.iter().find(|x| x.name == *tb) else { continue };
                let Some(&(tx, ty)) = self.positions.get(&target.name) else { continue };
                let ti = target.columns.iter().position(|x| x.name == *tc).unwrap_or(0);
                let sy = y + HEADER_HEIGHT + ROW_HEIGHT * ci as f32 + ROW_HEIGHT / 2.;
                let ty2 = ty + HEADER_HEIGHT + ROW_HEIGHT * ti as f32 + ROW_HEIGHT / 2.;
                out.push((self.pan.x + (x + NODE_WIDTH) * z, self.pan.y + sy * z, self.pan.x + tx * z, self.pan.y + ty2 * z));
            }
        }
        out
    }
}

/// React Flow's `getSmoothStepPath` (borderRadius 5, offset 20) for Right → Left handles.
fn smoothstep(sx: f32, sy: f32, tx: f32, ty: f32, z: f32) -> Vec<Point<f32>> {
    let off = 20. * z;
    if tx >= sx + 2. * off {
        let mx = (sx + tx) / 2.;
        vec![point(sx, sy), point(mx, sy), point(mx, ty), point(tx, ty)]
    } else {
        let my = (sy + ty) / 2.;
        vec![point(sx, sy), point(sx + off, sy), point(sx + off, my), point(tx - off, my), point(tx - off, ty), point(tx, ty)]
    }
}

fn paint_polyline(pts: &[Point<f32>], origin: Point<Pixels>, r: f32, width: f32, color: Hsla, window: &mut Window) {
    let p = |q: Point<f32>| point(origin.x + px(q.x), origin.y + px(q.y));
    let mut b = PathBuilder::stroke(px(width));
    b.move_to(p(pts[0]));
    for i in 1..pts.len() {
        let cur = pts[i];
        if i + 1 < pts.len() {
            let (prev, next) = (pts[i - 1], pts[i + 1]);
            let d1 = ((cur.x - prev.x).hypot(cur.y - prev.y)).max(0.001);
            let d2 = ((next.x - cur.x).hypot(next.y - cur.y)).max(0.001);
            let rr = r.min(d1 / 2.).min(d2 / 2.);
            let a = point(cur.x - (cur.x - prev.x) / d1 * rr, cur.y - (cur.y - prev.y) / d1 * rr);
            let c = point(cur.x + (next.x - cur.x) / d2 * rr, cur.y + (next.y - cur.y) / d2 * rr);
            b.line_to(p(a));
            b.curve_to(p(c), p(cur));
        } else {
            b.line_to(p(cur));
        }
    }
    if let Ok(path) = b.build() {
        window.paint_path(path, color);
    }
}

impl Render for SchemaDiagram {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        if self.needs_fit && f32::from(self.bounds.get().size.width) > 0. {
            self.needs_fit = false;
            self.fit(None, 0.2);
        } else if self.needs_fit {
            window.request_animation_frame();
        }
        if self.loading && self.tables.is_empty() {
            return div().size_full().flex().items_center().justify_center().bg(t.studio_bg).child(Spinner::new(20.)).child(common::width_tracker(self.bounds.clone())).relative().into_any_element();
        }
        if self.tables.is_empty() {
            let mongo = self.db_type == "mongodb";
            return div()
                .size_full()
                .relative()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .bg(t.studio_bg)
                .text_color(t.foreground)
                .child(
                    div()
                        .max_w(px(448.))
                        .px_6()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap_4()
                        .text_center()
                        .child(div().size_16().mb_2().tw_rounded_xl().rounded(px(16.)).bg(with_alpha(t.primary, 0.1)).border_1().border_color(with_alpha(t.primary, 0.2)).flex().items_center().justify_center().child(Icon::new(IconName::GitFork).size_8().text_color(t.primary)))
                        .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(if mongo { "No Collections Found" } else { "No Tables Found" }))
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .justify_center()
                                .tw_text_sm()
                                .text_color(t.muted_foreground)
                                .child(if mongo { "There are no collections in the\u{a0}" } else { "There are no tables in the\u{a0}" })
                                .child(div().bg(t.muted).px_1().rounded(px(4.)).font_family(MONO).child(self.schema.clone()))
                                .child(if mongo { "\u{a0}database to visualize." } else { "\u{a0}schema to visualize." }),
                        )
                        .child(Button::new("erd-refresh-empty").outline().icon(IconName::RefreshCw).label("Refresh Schema").on_click(cx.listener(|v, _, _, cx| v.load(cx)))),
                )
                .child(common::width_tracker(self.bounds.clone()))
                .into_any_element();
        }

        let z = self.zoom;
        let lines = self.edge_lines();
        let edge_color = with_alpha(t.primary, if t.dark { 0.4 } else { 0.6 });
        let dot = t.border;
        let (pan, gap) = (self.pan, 16. * z);
        let bg = canvas(
            |_, _, _| {},
            move |b, _, window, _| {
                if gap >= 6. {
                    let (w, h) = (f32::from(b.size.width), f32::from(b.size.height));
                    let r = (z * 0.5).max(0.5);
                    let mut x = pan.x.rem_euclid(gap);
                    while x < w {
                        let mut y = pan.y.rem_euclid(gap);
                        while y < h {
                            window.paint_quad(gpui::fill(Bounds::new(point(b.origin.x + px(x - r), b.origin.y + px(y - r)), gpui::size(px(r * 2.), px(r * 2.))), dot).corner_radii(px(r)));
                            y += gap;
                        }
                        x += gap;
                    }
                }
                for (sx, sy, tx, ty) in &lines {
                    paint_polyline(&smoothstep(*sx, *sy, *tx, *ty, z), b.origin, 5. * z, 1.5, edge_color, window);
                }
            },
        )
        .absolute()
        .inset_0();

        let tables = self.tables.clone();
        let nodes: Vec<AnyElement> = tables.iter().map(|tb| self.node(tb, cx)).collect();
        let ctl_btn = |id: &'static str, icon: IconName| div().id(id).size(px(26.)).flex().items_center().justify_center().bg(t.card).border_b_1().border_color(t.border).text_color(with_alpha(t.foreground, 0.5)).hover(|s| s.bg(t.muted)).cursor_pointer().child(Icon::new(icon).size(px(12.)));
        let controls = div()
            .absolute()
            .top(px(15.))
            .left(px(15.))
            .flex()
            .flex_col()
            .border_1()
            .border_color(t.border)
            .shadow(rexa_ui::popup::shadow_sm())
            .child(ctl_btn("erd-zin", IconName::Plus).on_click(cx.listener(|v, _, _, cx| {
                let c = v.bounds.get().size;
                v.zoom_at(1.2, point(f32::from(c.width) / 2., f32::from(c.height) / 2.));
                cx.notify();
            })))
            .child(ctl_btn("erd-zout", IconName::Minus).on_click(cx.listener(|v, _, _, cx| {
                let c = v.bounds.get().size;
                v.zoom_at(1. / 1.2, point(f32::from(c.width) / 2., f32::from(c.height) / 2.));
                cx.notify();
            })))
            .child(ctl_btn("erd-fit", IconName::Maximize).on_click(cx.listener(|v, _, _, cx| {
                v.fit(None, 0.2);
                cx.notify();
            })));
        let legend_item = |icon: IconName, text: &'static str, filled: bool| {
            div()
                .flex()
                .items_center()
                .gap_1()
                .tw_text_xs()
                .font_family(MONO)
                .text_color(t.muted_foreground)
                .child(if filled {
                    div().relative().size(px(15.)).flex().items_center().justify_center().child(Icon::new(icon).size(px(15.))).child(div().absolute().size(px(7.)).bg(t.muted_foreground).rounded(px(1.))).into_any_element()
                } else {
                    Icon::new(icon).size(px(15.)).into_any_element()
                })
                .child(text)
        };
        let legend = div()
            .absolute()
            .bottom_0()
            .left_0()
            .w_full()
            .border_t_1()
            .border_color(t.border)
            .flex()
            .justify_center()
            .px_1()
            .py_2()
            .bg(t.card)
            .shadow(rexa_ui::popup::shadow_md())
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .justify_center()
                    .gap_4()
                    .child(legend_item(IconName::Key, "Primary key", false))
                    .child(legend_item(IconName::Hash, "Identity", false))
                    .child(legend_item(IconName::FingerprintPattern, "Unique", false))
                    .child(legend_item(IconName::Diamond, "Nullable", false))
                    .child(legend_item(IconName::Diamond, "Non-Nullable", true)),
            );
        let tool = |id: &'static str| Button::new(id).outline().size(ButtonSize::Sm);
        let schemas = self.schemas.clone();
        let cur = self.schema.clone();
        let this = cx.entity();
        let schema_menu = (!schemas.is_empty()).then(|| {
            DropdownMenu::new("erd-schema")
                .align(Align::End)
                .trigger(div().min_w(px(120.)).child(tool("erd-schema-t").child(div().flex().w_full().items_center().justify_between().gap_2().child(div().truncate().child(cur.clone())).child(Icon::new(IconName::EllipsisVertical).size_3().opacity(0.5)))))
                .menu(move |mut m, _, cx| {
                    let tk = cx.tokens().clone();
                    m = m.w(192.).max_h(320.);
                    for s in &schemas {
                        let (this, s2) = (this.clone(), s.clone());
                        let on = *s == cur;
                        m = m.item(MenuItem::new(s.clone()).leading(div().size(px(6.)).rounded(px(10.)).bg(if on { tk.primary } else { gpui::transparent_black() })).on_select(move |_, cx| {
                            let s = s2.clone();
                            this.update(cx, |v, cx| v.set_schema(s, cx));
                        }));
                    }
                    m
                })
        });
        let mode = self.mode;
        let svg = diagram_svg(&self.tables, &self.positions);
        let schema_for_export = self.schema.clone();
        let seg = |id: &'static str, label: &'static str, on: bool| {
            div().id(id).h_7().px_2().flex().items_center().tw_rounded_md().tw_text_xs().font_weight(FontWeight::MEDIUM).cursor_pointer().when(on, |d| d.bg(t.muted).shadow(rexa_ui::popup::shadow_sm())).when(!on, |d| d.hover(|s| s.bg(with_alpha(t.muted, 0.5)))).child(label)
        };
        let panel = div()
            .absolute()
            .top(px(15.))
            .right(px(15.))
            .flex()
            .items_center()
            .gap_2()
            .children(schema_menu)
            .child(tool("erd-copy").icon(if self.copied { IconName::Check } else { IconName::Copy }).label("Copy SQL").on_click(cx.listener(|v, _, _, cx| v.copy_sql(cx))))
            .child(
                DropdownMenu::new("erd-download")
                    .align(Align::End)
                    .trigger(tool("erd-dl").icon(IconName::Download).label("Download"))
                    .menu(move |m, _, _| {
                        let image = svg.clone();
                        let image_copy = image.clone();
                        let schema = schema_for_export.clone();
                        let png_image = svg.clone();
                        let png_schema = schema_for_export.clone();
                        m.w(220.).item(MenuItem::new("Copy SVG image").on_select(move |_, cx| {
                            cx.write_to_clipboard(ClipboardItem::new_string(image_copy.clone()));
                            Toast::success("Diagram SVG copied; paste it into a file or vector editor.").show(cx);
                        })).item(MenuItem::new("Save SVG to Downloads").on_select(move |_, cx| {
                            let dir = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_else(std::env::temp_dir);
                            let safe = schema.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect::<String>();
                            let mut path = dir.join(format!("{safe}-schema.svg"));
                            let mut n = 1;
                            while path.exists() { path = dir.join(format!("{safe}-schema ({n}).svg")); n += 1; }
                            match std::fs::write(&path, &image) {
                                Ok(()) => { Toast::success(format!("Saved {}", path.file_name().and_then(|f| f.to_str()).unwrap_or("schema.svg"))).show(cx); }
                                Err(e) => { Toast::error(format!("Could not save SVG: {e}")).show(cx); }
                            }
                        })).item(MenuItem::new("Save PNG to Downloads").on_select(move |_, cx| {
                            let dir = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_else(std::env::temp_dir);
                            let safe = png_schema.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect::<String>();
                            let mut path = dir.join(format!("{safe}-schema.png"));
                            let mut n = 1;
                            while path.exists() { path = dir.join(format!("{safe}-schema ({n}).png")); n += 1; }
                            match diagram_png(&png_image).and_then(|bytes| { std::fs::write(&path, bytes)?; Ok(()) }) {
                                Ok(()) => { Toast::success(format!("Saved {}", path.file_name().and_then(|f| f.to_str()).unwrap_or("schema.png"))).show(cx); }
                                Err(e) => { Toast::error(format!("Could not save PNG: {e:#}")).show(cx); }
                            }
                        }))
                    }),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .bg(t.background)
                    .border_1()
                    .border_color(t.border)
                    .tw_rounded_lg()
                    .p(px(2.))
                    .shadow(rexa_ui::popup::shadow_sm())
                    .child(seg("erd-auto", "Auto", mode == LayoutMode::Auto).on_click(cx.listener(|v, _, _, cx| {
                        v.mode = LayoutMode::Auto;
                        v.relayout(false);
                        cx.notify();
                    })))
                    .child(seg("erd-grid", "Grid", mode == LayoutMode::Grid).on_click(cx.listener(|v, _, _, cx| {
                        v.mode = LayoutMode::Grid;
                        v.relayout(false);
                        cx.notify();
                    }))),
            )
            .child(tool("erd-refresh").icon(IconName::RefreshCw).label("Refresh").on_click(cx.listener(|v, _, _, cx| v.load(cx))));

        div()
            .id("erd-root")
            .size_full()
            .relative()
            .overflow_hidden()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(common::width_tracker(self.bounds.clone()))
            .child(bg)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|v, e: &MouseDownEvent, _, _| {
                    v.drag = Some(Drag::Pan { start: e.position, pan0: v.pan });
                }),
            )
            .on_mouse_move(cx.listener(|v, e: &MouseMoveEvent, _, cx| {
                if e.pressed_button != Some(MouseButton::Left) {
                    v.drag = None;
                    return;
                }
                match &v.drag {
                    Some(Drag::Pan { start, pan0 }) => {
                        v.pan = point(pan0.x + f32::from(e.position.x - start.x), pan0.y + f32::from(e.position.y - start.y));
                        cx.notify();
                    }
                    Some(Drag::Node { id, start, pos0 }) => {
                        let p = (pos0.0 + f32::from(e.position.x - start.x) / v.zoom, pos0.1 + f32::from(e.position.y - start.y) / v.zoom);
                        v.positions.insert(id.clone(), p);
                        cx.notify();
                    }
                    None => {}
                }
            }))
            .on_mouse_up(MouseButton::Left, cx.listener(|v, _, _, _| {
                if matches!(v.drag, Some(Drag::Node { .. })) { v.save_positions(); }
                v.drag = None;
            }))
            .on_scroll(cx.listener(|v, e: &gpui::ScrollEvent, _, cx| {
                let d = e.delta.pixel_delta(px(16.));
                let at = v.local(e.position);
                let f = (1.0f32 + 0.002).powf(-f32::from(d.y));
                v.zoom_at(f, at);
                cx.notify();
            }))
            .on_pinch(cx.listener(|v, e: &gpui::PinchEvent, _, cx| {
                let at = v.local(e.position);
                v.zoom_at(1. + e.delta, at);
                cx.notify();
            }))
            .children(nodes)
            .child(controls)
            .child(legend)
            .child(panel)
            .into_any_element()
    }
}

pub fn build(spec: &TabSpec, schema: Option<String>, session: Arc<Session>, cx: &mut App) -> gpui::AnyView {
    use gpui::AppContext;
    let spec = spec.clone();
    let e: Entity<SchemaDiagram> = cx.new(|cx| SchemaDiagram::new(spec, session, schema, cx));
    e.into()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sql_orders_referenced_first() {
        let col = |n: &str, r: Option<&str>| DiagramColumn { name: n.into(), r#type: "integer".into(), is_primary: n == "id", is_nullable: false, references: r.map(|t| ("public".into(), t.into(), "id".into())) };
        let tables = vec![
            DiagramTable { schema: "public".into(), name: "orders".into(), columns: vec![col("id", None), col("user_id", Some("users"))] },
            DiagramTable { schema: "public".into(), name: "users".into(), columns: vec![col("id", None)] },
        ];
        let sql = build_schema_sql(&tables, "public", "postgres");
        assert!(sql.find("\"users\" (").unwrap() < sql.find("\"orders\" (").unwrap());
        assert!(sql.contains("REFERENCES \"public\".\"users\" (\"id\")"));
        assert!(sql.contains("PRIMARY KEY (\"id\")"));
    }
}
