//! The Connections home screen — a port of the `connectionScreen === "list"`
//! branch of components/connections/connection-manager.tsx, embedded the way
//! connections-page.tsx does (36px drag bar, inset rounded panel).

use crate::providers;
use rexa_ui::theme::{with_alpha, ActiveTokens, Tokens, MONO};
use rexa_ui::{images, tracked_text};
use gpui::{
    div, img, prelude::*, px, svg, App, Context, FontWeight, Hsla, Image, MouseButton,
    ObjectFit, SharedString, Window,
};
use gpui_component::Icon;
use rexa_ui::IconName;
use rexa_store::{SavedConnection, Store, TagDef, WebStore};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq)]
enum SortBy {
    Name,
    Recent,
}

#[derive(Clone, Copy, PartialEq)]
enum ViewMode {
    Card,
    List,
}

pub struct ConnectionsScreen {
    connections: Vec<SavedConnection>,
    tags: HashMap<String, Hsla>,
    icons: HashMap<i64, Arc<Image>>,
    avatar: Option<Arc<Image>>,
    has_supabase_account: bool,
    has_spacetimedb_account: bool,
    has_neon_account: bool,
    sort_by: SortBy,
    view_mode: ViewMode,
    error: Option<SharedString>,
}

impl ConnectionsScreen {
    pub fn new(_: &mut Window, _: &mut Context<Self>) -> Self {
        let mut this = Self {
            connections: Vec::new(),
            tags: HashMap::new(),
            icons: HashMap::new(),
            avatar: None,
            has_supabase_account: false,
            has_spacetimedb_account: false,
            has_neon_account: false,
            sort_by: SortBy::Name,
            view_mode: ViewMode::Card,
            error: None,
        };
        this.reload();
        this
    }

    pub fn reload(&mut self) {
        match Store::open().and_then(|s| Ok((s.connections()?, s.tag_library()?))) {
            Ok((connections, tags)) => {
                self.icons = connections
                    .iter()
                    .filter_map(|c| {
                        let url = c.icon.as_deref()?.strip_prefix("image:")?;
                        Some((c.id, images::from_data_url(url)?))
                    })
                    .collect();
                self.connections = connections;
                self.tags = tags
                    .into_iter()
                    .filter_map(|TagDef { name, color }| Some((name, rexa_ui::parse_color(&color)?)))
                    .collect();
            }
            Err(err) => self.error = Some(format!("{err:#}").into()),
        }
        if let Some(web) = WebStore::open() {
            self.avatar = web
                .get("rexa-db-user-avatar")
                .ok()
                .flatten()
                .and_then(|v| images::from_data_url(v.trim_matches('"')));
            let non_empty = |key: &str| web.get_json(key).and_then(|v| v.as_array().map(|a| !a.is_empty())).unwrap_or(false);
            self.has_supabase_account = non_empty("rexadb-supabase-mgmt-accounts");
            self.has_spacetimedb_account = non_empty("rexadb-spacetimedb-mgmt-accounts");
            self.has_neon_account = non_empty("rexadb-neon-cli-profiles");
        }
    }

    fn visible(&self) -> Vec<&SavedConnection> {
        let mut list: Vec<&SavedConnection> = self.connections.iter().collect();
        match self.sort_by {
            SortBy::Name => list.sort_by_key(|c| c.name.to_lowercase()),
            SortBy::Recent => list.sort_by_key(|c| std::cmp::Reverse(c.last_active.unwrap_or(0))),
        }
        list
    }

    fn render_header_button(id: &'static str, t: &Tokens, child: impl IntoElement) -> impl IntoElement {
        // h-7 w-7 rounded-full border border-studio-border bg-background/15 hover:bg-background/25
        div()
            .id(id)
            .flex()
            .items_center()
            .justify_center()
            .size(px(28.))
            .rounded_full()
            .border_1()
            .border_color(t.studio_border)
            .bg(with_alpha(t.background, 0.15))
            .hover(|s| s.bg(with_alpha(t.background, 0.25)))
            .child(child)
    }

    fn render_title_row(&self, t: &Tokens) -> impl IntoElement {
        let mut right = div().flex().items_center().gap_2();
        if self.has_supabase_account {
            right = right.child(Self::render_header_button(
                "supabase-accounts",
                t,
                // SupabaseLogo h-4 w-4: a 16px box with the mark at 78%.
                img("brand/supabase.svg").size(px(16. * 0.78)),
            ));
        }
        if self.has_spacetimedb_account {
            right = right.child(Self::render_header_button(
                "spacetimedb-accounts",
                t,
                svg().path("brand/spacetimedb.svg").size_4().text_color(with_alpha(t.foreground, 0.8)),
            ));
        }
        if self.has_neon_account {
            right = right.child(Self::render_header_button(
                "neon-accounts",
                t,
                img("brand/neon.svg").size(px(16. * 0.72)),
            ));
        }
        right = right.child(Self::render_header_button(
            "settings",
            t,
            Icon::new(IconName::Settings).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.6)),
        ));
        // NavUser: size-7 avatar.
        right = right.child(match &self.avatar {
            Some(image) => img(image.clone())
                .size(px(28.))
                .rounded_full()
                .object_fit(ObjectFit::Cover)
                .into_any_element(),
            None => div().size(px(28.)).rounded_full().bg(t.muted).into_any_element(),
        });

        div()
            .flex()
            .items_center()
            .justify_between()
            .mb_6()
            .child(
                // text-[28px] font-semibold tracking-tight
                div()
                    .text_size(px(28.))
                    .line_height(px(42.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .text_color(t.foreground)
                    .child(tracked_text::tight("Connections")),
            )
            .child(right)
    }

    fn toolbar_button(id: &'static str, t: &Tokens, dashed: bool) -> gpui::Stateful<gpui::Div> {
        // h-9 px-3 rounded-lg border border-border bg-background text-sm flex items-center gap-2
        let el = div()
            .id(id)
            .flex()
            .items_center()
            .gap_2()
            .h_9()
            .px_3()
            .rounded(px(t.radius))
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .text_size(px(14.))
            .line_height(px(20.));
        if dashed { el.border_dashed() } else { el }
    }

    fn render_toolbar(&self, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let search = Self::toolbar_button("search", t, false)
            .flex_1()
            .max_w(px(384.))
            .justify_between()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .text_color(t.muted_foreground)
                    .child(Icon::new(IconName::Search).size_4().text_color(with_alpha(t.muted_foreground, 0.6)))
                    .child("Search connections..."),
            )
            .child(
                // Kbd: h-5 min-w-5 rounded-lg px-1.5 bg-muted text-muted-foreground text-xs font-medium
                div()
                    .ml_2()
                    .flex()
                    .items_center()
                    .justify_center()
                    .h_5()
                    .min_w_5()
                    .px(px(6.))
                    .rounded(px(t.radius))
                    .bg(t.muted)
                    .text_color(t.muted_foreground)
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .child(if cfg!(target_os = "macos") { "⌘K" } else { "Ctrl K" }),
            );

        let providers = Self::toolbar_button("providers", t, true)
            .child(div().text_color(t.foreground).child("Providers"))
            .child(Icon::new(IconName::ChevronDown).size_4().text_color(with_alpha(t.muted_foreground, 0.6)));

        let sort_label = match self.sort_by {
            SortBy::Name => "Sorted by name",
            SortBy::Recent => "Sorted by recent",
        };
        let sort = Self::toolbar_button("sort", t, false)
            .child(Icon::new(IconName::SlidersHorizontal).size_4().text_color(with_alpha(t.muted_foreground, 0.7)))
            .child(sort_label)
            .on_click(cx.listener(|this, _, _, cx| {
                this.sort_by = if this.sort_by == SortBy::Name { SortBy::Recent } else { SortBy::Name };
                cx.notify();
            }));

        let toggle_button = |id: &'static str, icon: IconName, mode: ViewMode, active: bool, cx: &mut Context<Self>| {
            // Button size icon-sm (size-7) rounded-md; active = secondary (+ rexa-raised), else ghost.
            let el = div()
                .id(id)
                .flex()
                .items_center()
                .justify_center()
                .size_7()
                .rounded(px(t.radius - 2.))
                .border_1()
                .child(Icon::new(icon).size_4());
            let el = if active {
                el.border_color(gpui::hsla(0., 0., 1., 0.2))
                    .bg(gpui::hsla(0., 0., 1., 0.07))
                    .text_color(gpui::rgb(0xf5f5f5))
            } else {
                el.border_color(gpui::transparent_black())
                    .text_color(t.muted_foreground)
                    .hover(|s| s.bg(gpui::hsla(0., 0., 1., 0.06)).text_color(t.foreground))
            };
            el.on_click(cx.listener(move |this, _, _, cx| {
                this.view_mode = mode;
                cx.notify();
            }))
        };

        let view_toggle = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(2.))
            .h_9()
            .p(px(2.))
            .rounded(px(t.radius))
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .child(toggle_button("view-card", IconName::LayoutGrid, ViewMode::Card, self.view_mode == ViewMode::Card, cx))
            .child(toggle_button("view-list", IconName::List, ViewMode::List, self.view_mode == ViewMode::List, cx));

        let new_connection = Self::toolbar_button("new-connection", t, false)
            .child(Icon::new(IconName::Plus).size_4().text_color(with_alpha(t.muted_foreground, 0.7)))
            .child("New Connection");

        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .mb_6()
            .child(search)
            .child(providers)
            .child(sort)
            .child(div().ml_auto().flex().items_center().gap_2().child(view_toggle).child(new_connection))
    }

    fn render_logo(&self, conn: &SavedConnection, provider: &str, size: f32, t: &Tokens) -> gpui::AnyElement {
        if let Some(image) = self.icons.get(&conn.id) {
            return img(image.clone()).size(px(size)).rounded(px(t.radius - 2.)).object_fit(ObjectFit::Cover).into_any_element();
        }
        if let Some(emoji) = conn.icon.as_deref().and_then(|i| i.strip_prefix("emoji:")) {
            return div()
                .size(px(size))
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(size * 0.85))
                .child(emoji.to_string())
                .into_any_element();
        }
        if provider == "spacetimedb" {
            return svg().path("brand/spacetimedb.svg").size(px(size)).text_color(t.foreground).into_any_element();
        }
        let logo = providers::card(provider).map_or_else(|| providers::logo_for(provider), |c| c.logo);
        img(logo).size(px(size)).rounded(px(t.radius)).object_fit(ObjectFit::Contain).into_any_element()
    }

    fn render_tag(&self, name: &str) -> impl IntoElement {
        // ConnectionTagBadge: h-4.5 rounded-full px-2 text-[10px] font-medium,
        // color tone, bg tone/0x1a, inset 1px ring tone/0x33.
        let tone = self.tags.get(name).copied().unwrap_or_else(|| rexa_ui::parse_color("#71717a").unwrap());
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .h(px(18.))
            .max_w(px(120.))
            .px_2()
            .rounded_full()
            .text_size(px(10.))
            .line_height(px(10.))
            .font_weight(FontWeight::MEDIUM)
            .text_color(tone)
            .bg(with_alpha(tone, 0x1a as f32 / 255.))
            .border_1()
            .border_color(with_alpha(tone, 0x33 as f32 / 255.))
            .child(div().overflow_hidden().text_ellipsis().whitespace_nowrap().child(name.to_string()))
    }

    fn render_card(&self, conn: &SavedConnection, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let provider = providers::provider_of(conn);
        let label = providers::card(&provider).map(|c| c.label);
        let open = conn.id;

        let mut name_row = div().flex().items_center().gap_2().child(
            // h3 text-sm font-medium truncate max-w-[120px]
            div()
                .max_w(px(120.))
                .overflow_hidden()
                .text_ellipsis()
                .whitespace_nowrap()
                .text_size(px(14.))
                .line_height(px(20.))
                .font_weight(FontWeight::MEDIUM)
                .text_color(t.foreground)
                .child(conn.name.clone()),
        );
        for tag in conn.tags.iter().take(2) {
            name_row = name_row.child(self.render_tag(tag));
        }
        if conn.tags.len() > 2 {
            name_row = name_row.child(
                div().text_size(px(10.)).text_color(t.muted_foreground).child(format!("+{}", conn.tags.len() - 2)),
            );
        }

        let mut text = div().child(name_row);
        if let Some(label) = label {
            text = text.child(
                // p.text-xs.text-muted-foreground.tracking-tight
                div().text_size(px(12.)).line_height(px(16.)).text_color(t.muted_foreground).child(tracked_text::tight(label)),
            );
        }

        let star = conn.is_favorite.then(|| {
            div()
                .absolute()
                .top(px(-8.))
                .right(px(-8.))
                .p(px(2.))
                .rounded(px(t.radius))
                .bg(t.studio_bg)
                .border_1()
                .border_color(with_alpha(t.border, 0.4))
                .child(Icon::new(IconName::Star).size(px(10.)).text_color(gpui::rgb(0xf59e0b)))
        });

        let more = div()
            .id(SharedString::from(format!("more-{}", conn.id)))
            .flex()
            .items_center()
            .justify_center()
            .size_8()
            .rounded(px(t.radius))
            .text_color(t.muted_foreground)
            .hover(|s| s.text_color(t.foreground).bg(with_alpha(t.muted, 0.6)))
            .child(Icon::new(IconName::EllipsisVertical).size_4())
            .on_click(|_, _, cx| cx.stop_propagation());

        // group relative rounded-lg border border-studio-border/60 bg-card p-4
        // hover:bg-studio-row-hover hover:border-studio-border
        div()
            .id(SharedString::from(format!("conn-{}", conn.id)))
            .relative()
            .rounded(px(t.radius))
            .border_1()
            .border_color(with_alpha(t.studio_border, 0.6))
            .bg(t.card)
            .hover(|s| s.bg(t.studio_row_hover).border_color(t.studio_border))
            .p_4()
            .cursor_pointer()
            .on_click(cx.listener(move |_, _, _, cx| rexa_core::navigate(rexa_core::Route::Studio(open), cx)))
            .child(
                div()
                    .flex()
                    .items_start()
                    .justify_between()
                    .mb_3()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(div().relative().child(self.render_logo(conn, &provider, 27., t)).children(star))
                            .child(text),
                    )
                    .child(more),
            )
            .child(
                // The target sits in an inline-block <button> inside the card's
                // 16px/24px line box, so the row is 24px tall with the 12px/16px
                // text baseline-aligned ~5.4px down.
                div()
                    .h(px(24.))
                    .pt(px(5.4))
                    .flex()
                    .items_start()
                    .gap_2()
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .text_color(t.muted_foreground)
                    .child(
                        div()
                            .font_family(MONO)
                            .overflow_hidden()
                            .text_ellipsis()
                            .whitespace_nowrap()
                            .child(providers::target(conn)),
                    ),
            )
    }

    fn render_list_row(&self, conn: &SavedConnection, t: &Tokens, cx: &mut Context<Self>) -> impl IntoElement {
        let provider = providers::provider_of(conn);
        let open = conn.id;
        div()
            .id(SharedString::from(format!("row-{}", conn.id)))
            .flex()
            .items_center()
            .gap_3()
            .px_4()
            .py_3()
            .border_b_1()
            .border_color(t.border)
            .hover(|s| s.bg(t.studio_row_hover))
            .cursor_pointer()
            .on_click(cx.listener(move |_, _, _, cx| rexa_core::navigate(rexa_core::Route::Studio(open), cx)))
            .child(self.render_logo(conn, &provider, 20., t))
            .child(
                div().flex_1().min_w_0().flex().items_center().gap_2()
                    .child(div().text_size(px(14.)).font_weight(FontWeight::MEDIUM).child(conn.name.clone()))
                    .children(conn.tags.iter().take(2).map(|tag| self.render_tag(tag))),
            )
            .child(
                div().text_size(px(12.)).font_family(MONO).text_color(t.muted_foreground)
                    .overflow_hidden().text_ellipsis().whitespace_nowrap().child(providers::target(conn)),
            )
    }
}

impl Render for ConnectionsScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let visible: Vec<SavedConnection> = self.visible().into_iter().cloned().collect();

        let list = match self.view_mode {
            ViewMode::Card => div()
                .grid()
                .grid_cols(3)
                .gap_4()
                .children(visible.iter().map(|c| self.render_card(c, &t, cx).into_any_element()))
                .into_any_element(),
            ViewMode::List => div()
                .overflow_hidden()
                .rounded(px(t.radius))
                .border_1()
                .border_color(t.border)
                .bg(t.card)
                .children(visible.iter().map(|c| self.render_list_row(c, &t, cx).into_any_element()))
                .into_any_element(),
        };

        let page = div()
            .flex()
            .flex_col()
            .h_full()
            .flex_1()
            .max_w(px(1024.))
            .mx_auto()
            .px_6()
            .py_8()
            .child(self.render_title_row(&t))
            .child(self.render_toolbar(&t, cx))
            .children(self.error.clone().map(|e| div().mb_4().text_size(px(12.)).text_color(t.destructive).child(e)))
            .child(
                div()
                    .id("connections-scroll")
                    .flex_1()
                    .overflow_y_scroll()
                    .mx(px(-24.))
                    .px_6()
                    .pb(px(80.))
                    .child(list),
            );

        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                // connections-page.tsx: app-drag-region h-9
                div()
                    .id("drag-region")
                    .h_9()
                    .flex_shrink_0()
                    .on_mouse_down(MouseButton::Left, |e, window, _| {
                        if e.click_count == 2 {
                            window.titlebar_double_click();
                        } else {
                            window.start_window_move();
                        }
                    }),
            )
            .child(
                // px-2 pb-2 › rounded-lg bg-[var(--shell-content-bg)]
                div().flex_1().min_h_0().px_2().pb_2().child(
                    div()
                        .size_full()
                        .flex()
                        .overflow_hidden()
                        .rounded(px(t.radius))
                        .bg(t.var("--shell-content-bg").unwrap_or(t.studio_bg))
                        .child(page),
                ),
            )
    }
}

#[allow(dead_code)]
fn _assert_app(_: &App) {}
