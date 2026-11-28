//! Port of components/studio/database/{db-list-layout,db-list-header,schema-dropdown,
//! empty-state-presentational,database-table}.tsx: the shared chrome of every
//! database object list (header, toolbar, schema filter, search, create button,
//! empty state, skeleton, table cross-link), plus small async helpers.

use gpui::{div, prelude::*, px, AnyElement, App, ElementId, Entity, FontWeight, Hsla, SharedString, Window};
use rexa_core::{runtime, Session};
use rexa_drivers::Kind;
use rexa_ui::widgets::{Icon, InputState};
use rexa_ui::{skeleton, tight, tw, white, with_alpha, ActiveTokens, Button, ButtonSize, Combobox, IconName, SelectOption, Tw};
use std::sync::Arc;

/// `DbListPage`: flex-1 flex-col bg-studio-bg overflow-hidden.
pub fn page(cx: &App) -> gpui::Div {
    let t = cx.tokens();
    div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground).overflow_hidden()
}

/// `DbListHeader` (layout variant): p-8 pb-4, text-sm semibold title + muted description.
pub fn list_header(title: impl Into<SharedString>, description: impl Into<SharedString>, cx: &App) -> gpui::Div {
    let t = cx.tokens();
    div()
        .flex_shrink_0()
        .p_8()
        .pb_4()
        .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).text_color(t.foreground).child(tight(title.into())))
        .child(div().tw_text_sm().text_color(t.muted_foreground).mt_1().child(description.into()))
}

/// `DbListToolbar` (lg: row, items-center, justify-between).
pub fn toolbar() -> gpui::Div {
    div().flex_shrink_0().px_8().pb_4().flex().flex_row().flex_wrap().items_center().justify_between().gap_2()
}

/// `DbToolbarFilters`.
pub fn filters() -> gpui::Div {
    div().flex().flex_row().flex_wrap().items_center().gap_2()
}

/// `SchemaDropdown` (`showAllOption=false` in the lists): outline sm button
/// "schema <name>" + chevrons, popover with "Find schema..." search.
/// `pg_*` schemas are hidden like the original.
pub fn schema_dropdown(
    id: impl Into<ElementId>,
    schemas: &[String],
    selected: &str,
    show_all: bool,
    on_change: impl Fn(String, &mut Window, &mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens();
    let label = if selected == "all" { "All schemas".to_string() } else { selected.to_string() };
    let mut options: Vec<SelectOption> = Vec::new();
    if show_all {
        options.push(SelectOption::new("all", "All schemas"));
    }
    options.extend(schemas.iter().filter(|s| !s.starts_with("pg_")).map(|s| SelectOption::simple(s.clone())));
    let trigger = div()
        .flex()
        .items_center()
        .gap_1()
        .h_8()
        .pl_3()
        .pr_1()
        .tw_rounded_lg()
        .border_1()
        .border_color(t.border)
        .bg(if t.dark { with_alpha(t.input, 0.3) } else { t.background })
        .shadow(rexa_ui::popup::shadow_xs())
        .tw_text_sm()
        .font_weight(FontWeight::MEDIUM)
        .cursor_pointer()
        .hover(|s| s.bg(t.muted))
        .child(div().flex().gap_1().child(div().text_color(t.muted_foreground).child("schema")).child(div().text_color(t.foreground).child(label)))
        .child(Icon::new(IconName::ChevronsUpDown).size(px(14.)).text_color(t.muted_foreground));
    // Wrapped so the trigger sizes to its content (the Combobox trigger is w-full).
    div().flex_none().child(Combobox::searchable(id)
        .options(options)
        .value(Some(SharedString::from(selected.to_string())))
        .search_placeholder("Find schema...")
        .empty_text("No schemas found")
        .trigger(trigger)
        .on_change(move |v, w, cx| on_change(v.to_string(), w, cx)))
        .into_any_element()
}

/// `DbSearchInput`: w-52 h-7 text-xs, search icon on the left (or right).
pub fn search_input(state: &Entity<InputState>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .w(px(208.))
        .tw_text_xs()
        .child(
            rexa_ui::TextInput::new(state)
                .h(28.)
                .prefix(Icon::new(IconName::Search).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4))),
        )
        .into_any_element()
}

/// `DbCreateButton`: outline sm button with a plus icon.
pub fn create_button(id: impl Into<ElementId>, label: impl Into<SharedString>, on_click: impl Fn(&mut Window, &mut App) + 'static) -> AnyElement {
    div()
        .flex()
        .items_center()
        .gap_2()
        .child(Button::new(id).outline().size(ButtonSize::Sm).icon(IconName::Plus).label(label).on_click(move |_, w, cx| on_click(w, cx)))
        .into_any_element()
}

/// `EmptyStatePresentational`: dashed border box, icon, title, description, children.
pub fn empty_state(icon: IconName, title: impl Into<SharedString>, description: Option<SharedString>, action: Option<AnyElement>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .w_full()
        .flex()
        .flex_col()
        .items_center()
        .gap_y_3()
        .px_4()
        .py_10()
        .tw_rounded_lg()
        .border_1()
        .border_dashed()
        .border_color(t.border)
        .bg(t.var_or("--background-surface-100", t.background))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_y_3()
                .items_center()
                .child(Icon::new(icon).size(px(24.)).text_color(t.muted_foreground))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .text_center()
                        .child(div().tw_text_base().child(title.into()))
                        .children(description.map(|d| div().tw_text_sm().text_color(t.muted_foreground).max_w(px(640.)).child(d))),
                ),
        )
        .children(action)
        .into_any_element()
}

/// `DbListEmptyState`: empty state with an outline "Create …" button.
pub fn list_empty_state(
    id: impl Into<ElementId>,
    icon: IconName,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    action_label: impl Into<SharedString>,
    on_action: impl Fn(&mut Window, &mut App) + 'static,
    cx: &App,
) -> AnyElement {
    let btn = Button::new(id).outline().size(ButtonSize::Sm).icon(IconName::Plus).label(action_label).on_click(move |_, w, cx| on_action(w, cx));
    div()
        .flex_1()
        .flex()
        .flex_col()
        .justify_start()
        .child(empty_state(icon, title, Some(description.into()), Some(btn.into_any_element()), cx))
        .into_any_element()
}

/// "No results found / Your search for “x” did not return any results".
pub fn no_results(search: &str, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .py_8()
        .flex()
        .flex_col()
        .items_center()
        .text_center()
        .child(div().tw_text_sm().text_color(t.foreground).child("No results found"))
        .child(div().tw_text_sm().text_color(t.muted_foreground).child(format!("Your search for \u{201c}{search}\u{201d} did not return any results")))
        .into_any_element()
}

/// The list skeleton shown while the first fetch runs (header, toolbar, 5 rows).
pub fn list_skeleton(id: &str, cols: &[f32], cx: &App) -> AnyElement {
    let t = cx.tokens();
    let sk = |n: String, w: f32, h: f32| skeleton(ElementId::Name(n.into()), move |d| d.h(px(h)).w(px(w)), cx);
    let row = |i: usize| {
        let mut r = div().flex().items_center().gap_4().px_4().py_4().border_b_1().border_color(t.border);
        for (c, w) in cols.iter().enumerate() {
            r = r.child(div().flex_1().child(sk(format!("{id}-r{i}-{c}"), *w, 16.)));
        }
        r.child(div().w(px(80.)).flex().justify_end().child(skeleton(ElementId::Name(format!("{id}-r{i}-a").into()), |d| d.size(px(28.)).tw_rounded_md(), cx)))
    };
    let mut table = div().tw_rounded_lg().border_1().border_color(t.border).overflow_hidden().flex_1().flex().flex_col();
    let mut head = div().flex().gap_4().px_4().py_3().border_b_1().border_color(t.border);
    for c in 0..cols.len() {
        head = head.child(div().flex_1().child(sk(format!("{id}-h{c}"), 48., 16.)));
    }
    table = table.child(head.child(div().w(px(80.))));
    for i in 0..5 {
        table = table.child(row(i));
    }
    page(cx)
        .child(div().p_8().pb_4().child(div().mb_2().child(sk(format!("{id}-t"), 160., 16.))).child(sk(format!("{id}-d"), 240., 12.)))
        .child(
            div()
                .px_8()
                .pb_4()
                .flex()
                .items_center()
                .gap_2()
                .child(skeleton(ElementId::Name(format!("{id}-s1").into()), |d| d.h_8().w(px(128.)).tw_rounded_md(), cx))
                .child(skeleton(ElementId::Name(format!("{id}-s2").into()), |d| d.h_8().w(px(208.)).tw_rounded_md(), cx))
                .child(div().flex_1())
                .child(skeleton(ElementId::Name(format!("{id}-s3").into()), |d| d.h_8().w(px(112.)).tw_rounded_md(), cx)),
        )
        .child(div().px_8().flex_1().overflow_hidden().flex().flex_col().child(table))
        .into_any_element()
}

/// `DbTableLink`: primary text; on hover a tinted pill with a sliding arrow.
pub fn table_link(id: impl Into<ElementId>, table: &str, on_open: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> AnyElement {
    let t = cx.tokens();
    let primary = t.primary;
    let gid: SharedString = format!("dblink-{table}").into();
    div()
        .id(id)
        .group(gid.clone())
        .flex()
        .max_w_full()
        .items_center()
        .gap_1()
        .rounded_full()
        .border_1()
        .border_color(gpui::transparent_black())
        .py(px(2.))
        .pl(px(10.))
        .pr_2()
        .text_color(primary)
        .cursor_pointer()
        .hover(move |s| s.border_color(with_alpha(primary, 0.25)).bg(with_alpha(primary, 0.1)))
        .on_click(move |_, w, cx| on_open(w, cx))
        .child(div().truncate().child(SharedString::from(table.to_string())))
        .child(
            div()
                .flex_shrink_0()
                .opacity(0.)
                .group_hover(gid, |s| s.opacity(1.))
                .child(Icon::new(IconName::ArrowRight).size(px(14.))),
        )
        .into_any_element()
}

/// Muted monospace-free secondary text (`text-muted-foreground`).
pub fn muted(text: impl Into<SharedString>, cx: &App) -> gpui::Div {
    div().text_color(cx.tokens().muted_foreground).child(text.into())
}

/// `color-mix(in oklab, a pct%, b)` approximated in sRGB.
pub fn mix(a: Hsla, b: Hsla, amount_a: f32) -> Hsla {
    let (a, b): (gpui::Rgba, gpui::Rgba) = (a.into(), b.into());
    let m = |x: f32, y: f32| x * amount_a + y * (1. - amount_a);
    gpui::Rgba { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: m(a.a, b.a) }.into()
}

/// Theme-adaptive tinted color (`text-emerald-600 dark:text-emerald-400`).
pub fn tone(cx: &App, light: &str, dark: &str) -> Hsla {
    if cx.tokens().dark {
        tw(dark)
    } else {
        tw(light)
    }
}

#[allow(unused)]
fn _unused() -> Hsla {
    white(0.)
}

// ---- async helpers ---------------------------------------------------------------------------

pub fn kind(session: &Session) -> Kind {
    session.driver.kind()
}

/// The connection's default schema (`public`, `dbo`, `main`, the MySQL database …).
pub fn default_schema(session: &Session) -> String {
    let k = kind(session);
    k.default_schema(&session.connection.connection_string)
}

/// `fetchSchemas` (off the UI thread).
pub fn load_schemas(session: &Arc<Session>) -> impl std::future::Future<Output = anyhow::Result<Vec<String>>> {
    let d = session.driver.clone();
    runtime::spawn(async move { d.schemas().await })
}

/// Whether the engine has a Postgres-style catalog (enums, RLS, extensions…).
pub fn is_postgres(session: &Session) -> bool {
    session.driver.capabilities().postgres_catalog
}

/// The old app's `dbType` string for this session.
pub fn db_type(session: &Session) -> &'static str {
    match session.connection.kind.as_str() {
        "supabase-mgmt" => "supabase-mgmt",
        _ => kind(session).as_str(),
    }
}

/// `handleTableClick(table, schema)`.
pub fn open_table(schema: &str, table: &str, cx: &mut App) {
    rexa_core::open_tab(rexa_core::TabSpec::Table { schema: schema.into(), table: table.into() }, cx);
}

/// Open a SQL tab with a fixed id/title (the "View definition" actions).
pub fn open_sql(id: impl Into<String>, title: impl Into<String>, sql: impl Into<String>, cx: &mut App) {
    rexa_core::open_tab(rexa_core::TabSpec::Query { id: id.into(), title: title.into(), sql: sql.into() }, cx);
}

/// Like `rexa_ui::popup::bounds_tracker`, but refreshes the window when the
/// parent's size changes (for layouts computed from the measured width).
pub fn width_tracker(cell: std::rc::Rc<std::cell::Cell<gpui::Bounds<gpui::Pixels>>>) -> impl IntoElement {
    gpui::canvas(
        move |bounds, window, _| {
            if cell.get().size != bounds.size {
                window.refresh();
            }
            cell.set(bounds);
        },
        |_, _, _, _| {},
    )
    .absolute()
    .inset_0()
}

/// `uid()`: a short random base-36 id.
pub fn short_id() -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64);
    let mut x = n.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (n >> 29);
    (0..7)
        .map(|_| {
            let c = (x % 36) as u32;
            x /= 36;
            std::char::from_digit(c, 36).unwrap_or('0')
        })
        .collect()
}
