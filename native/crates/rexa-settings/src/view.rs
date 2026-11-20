//! Port of components/studio/settings-view.tsx (+ settings/settings-sidebar.tsx,
//! zoom-setting.tsx, custom-font-setting.tsx, sql-editor-engine-setting.tsx,
//! credential-storage-setting.tsx, icon-theme-setting.tsx,
//! components/app-settings-view.tsx): the settings page with its sidebar,
//! search, and every section. Hosted by the studio's settings modal
//! (`TabSpec::Settings`) and the connections home's settings dialog.

use crate::model::{builtin_app_themes, NamedTheme, SettingsModel, SettingsChanged, DEFAULT_ICON_THEME_ID, EDITOR_BUILTIN_THEMES};
use crate::rows::{self, model_select, model_toggle, section_title, setting_row, sub_heading, title_block};
use crate::search;
use gpui::{
    div, linear_color_stop, linear_gradient, prelude::*, px, AnyElement, App, Context, Entity, FontWeight,
    ScrollHandle, SharedString, Subscription, Window,
};
use gpui_component::input::{InputEvent, InputState};
use gpui_component::Icon;
use rexa_ui::{
    parse_color, tw, white, with_alpha, ActiveTokens, Align, Button, ButtonSize, DropdownMenu, IconName, MenuItem,
    Select, SelectEntry, SelectOption, Switch, TextInput, Tw,
};
use serde_json::Value;

pub const SECTIONS: &[(&str, &str, IconName)] = &[
    ("general", "General", IconName::Settings2),
    ("editor", "Editor", IconName::CodeXml),
    ("themes", "Themes", IconName::Palette),
    ("ai", "AI", IconName::Bot),
    ("mcp", "MCP Server", IconName::Server),
    ("security", "Security", IconName::Shield),
    ("keybindings", "Keybindings", IconName::Keyboard),
    ("advanced", "Advanced", IconName::SlidersHorizontal),
    ("workspace", "Workspace", IconName::Users),
];

const SEARCH_SECTION_ORDER: &[&str] =
    &["general", "editor", "themes", "ai", "mcp", "security", "keybindings", "advanced", "workspace"];

const MIN_ZOOM: i64 = 50;
const MAX_ZOOM: i64 = 200;
const ZOOM_STEP: i64 = 10;

/// Which side panel is open next to the settings (connection-manager.tsx's
/// ThemeCreatorPanel / IconThemeCreatorPanel at `w-[340px] border-l`).
#[derive(Clone, Copy, PartialEq)]
pub enum SidePanel {
    None,
    ThemeCreator,
    IconThemeCreator,
}

pub struct SettingsView {
    pub(crate) model: Entity<SettingsModel>,
    pub(crate) section: &'static str,
    search: Entity<InputState>,
    query: String,
    /// Deep-linked setting id from a search result (ring for 2.2s).
    highlight: Option<&'static str>,
    app_font: Entity<InputState>,
    editor_font: Entity<InputState>,
    zoom: Entity<InputState>,
    pub(crate) content_scroll: ScrollHandle,
    pub(crate) ai: Option<Entity<crate::ai::AiSection>>,
    pub(crate) mcp: Option<Entity<crate::mcp::McpSection>>,
    pub(crate) keybindings: Option<Entity<crate::keybindings::KeybindingsPanel>>,
    pub(crate) workspace: Option<Entity<crate::workspace::WorkspaceSection>>,
    pub(crate) themes: Option<Entity<crate::themes::ThemesSection>>,
    pub(crate) side_panel: SidePanel,
    pub(crate) theme_creator: Option<Entity<crate::theme_creator::ThemeCreatorPanel>>,
    pub(crate) icon_creator: Option<Entity<crate::theme_creator::IconThemeCreatorPanel>>,
    pub(crate) credential_mode: rexa_store::CredentialStorageMode,
    pub(crate) command_drag: Option<usize>,
    _subs: Vec<Subscription>,
}

impl SettingsView {
    /// `section` is a settings section id ("general", "ai", …); unknown ids fall back to General.
    pub fn new(section: &str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let model = SettingsModel::global(cx);
        let (app_font, editor_font, zoom) = {
            let m = model.read(cx);
            (m.app_font.clone(), m.str("editorFontFamily"), m.num("appZoom") as i64)
        };
        let placeholder = r#""IBM Plex Sans", "Segoe UI", sans-serif"#;
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search settings"));
        let app_font = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).default_value(app_font));
        let editor_font = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).default_value(editor_font));
        let zoom = cx.new(|cx| InputState::new(window, cx).default_value(zoom.to_string()));
        let mut subs = vec![cx.observe(&model, |_, _, cx| cx.notify())];
        subs.push(cx.subscribe_in(&model, window, |this, model, ev: &SettingsChanged, window, cx| {
            // Keep the zoom field in sync (ZoomSetting's `useEffect([value])`).
            if ev.key == "appZoom" || ev.key == "*" {
                let z = model.read(cx).num("appZoom") as i64;
                this.zoom.update(cx, |s, cx| s.set_value(z.to_string(), window, cx));
            }
            if let Some(err) = model.read(cx).last_error.clone() {
                rexa_ui::toast::error(format!("Failed to save settings: {err}"), cx);
            }
        }));
        subs.push(cx.subscribe(&search, |this, s, ev: &InputEvent, cx| {
            if matches!(ev, InputEvent::Change) {
                this.query = s.read(cx).value().to_string();
                cx.notify();
            }
        }));
        subs.push(cx.subscribe(&app_font, |this, s, ev: &InputEvent, cx| {
            if matches!(ev, InputEvent::Change) {
                let v = s.read(cx).value().to_string();
                this.model.update(cx, |m, cx| m.set_app_font(&v, cx));
            }
        }));
        subs.push(cx.subscribe(&editor_font, |this, s, ev: &InputEvent, cx| {
            if matches!(ev, InputEvent::Change) {
                let v = s.read(cx).value().to_string();
                this.model.update(cx, |m, cx| m.set("editorFontFamily", v, cx));
            }
        }));
        subs.push(cx.subscribe_in(&zoom, window, |this, s, ev: &InputEvent, window, cx| {
            if matches!(ev, InputEvent::PressEnter { .. } | InputEvent::Blur) {
                let raw = s.read(cx).value().to_string();
                let current = this.model.read(cx).num("appZoom") as i64;
                match raw.trim().parse::<f64>() {
                    Ok(v) => this.set_zoom(v.round() as i64, cx),
                    Err(_) => s.update(cx, |s, cx| s.set_value(current.to_string(), window, cx)),
                }
            }
        }));
        let section = SECTIONS.iter().map(|(id, _, _)| *id).find(|id| *id == section).unwrap_or("general");
        Self {
            model,
            section,
            search,
            query: String::new(),
            highlight: None,
            app_font,
            editor_font,
            zoom,
            content_scroll: ScrollHandle::new(),
            ai: None,
            mcp: None,
            keybindings: None,
            workspace: None,
            themes: None,
            side_panel: SidePanel::None,
            theme_creator: None,
            icon_creator: None,
            credential_mode: rexa_store::Store::open()
                .map(|s| rexa_store::CredentialStorageMode::current(&s))
                .unwrap_or(rexa_store::CredentialStorageMode::Keychain),
            command_drag: None,
            _subs: subs,
        }
    }

    pub fn set_section(&mut self, section: &'static str, cx: &mut Context<Self>) {
        self.section = section;
        self.content_scroll.set_offset(gpui::point(px(0.), px(0.)));
        cx.notify();
    }

    fn set_zoom(&mut self, v: i64, cx: &mut Context<Self>) {
        let v = v.clamp(MIN_ZOOM, MAX_ZOOM);
        self.model.update(cx, |m, cx| m.set("appZoom", v, cx));
    }

    fn clear_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.search.update(cx, |s, cx| s.set_value("", window, cx));
        self.query.clear();
        cx.notify();
    }

    /// handleSearchNavigate: open the section, clear the search, ring the row for 2.2s.
    fn navigate_to(&mut self, entry: &'static search::Entry, window: &mut Window, cx: &mut Context<Self>) {
        self.set_section(entry.section, cx);
        if entry.section == "workspace" {
            let page_add = entry.id != "workspace-saved";
            let ws = self.workspace_section(window, cx);
            ws.update(cx, |w, cx| w.set_add_page(page_add, cx));
        }
        self.clear_search(window, cx);
        self.highlight = Some(entry.id);
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(std::time::Duration::from_millis(2200)).await;
            this.update(cx, |this, cx| {
                this.highlight = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub(crate) fn hl(&self, id: &str) -> bool {
        self.highlight == Some(id)
    }

    // ---- sidebar ------------------------------------------------------------------------

    fn render_sidebar(&mut self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let q = self.query.trim().to_lowercase();
        let matching: Vec<&str> = search::filter(&q).iter().map(|e| e.section).collect();
        let visible = SECTIONS.iter().filter(|(id, label, _)| q.is_empty() || label.to_lowercase().contains(&q) || matching.contains(id));
        let search = div().px_2().pt_3().child(
            TextInput::new(&self.search)
                .h(28.)
                .prefix(Icon::new(IconName::Search).size(px(14.)).text_color(t.muted_foreground))
                .when(!self.query.is_empty(), |i| {
                    i.suffix(
                        div()
                            .id("settings-search-clear")
                            .rounded(px(4.))
                            .p(px(2.))
                            .text_color(t.muted_foreground)
                            .hover(|s| s.text_color(t.foreground))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, w, cx| this.clear_search(w, cx)))
                            .child(Icon::new(IconName::X).size(px(14.))),
                    )
                }),
        );
        let mut nav = div().flex().flex_col().gap_1().px_2().py_4();
        for (id, label, icon) in visible {
            let active = self.section == *id;
            let id: &'static str = id;
            nav = nav.child(
                div()
                    .id(SharedString::from(format!("settings-nav-{id}")))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .tw_rounded_md()
                    .px(px(10.))
                    .py(px(6.))
                    .tw_text_13()
                    .cursor_pointer()
                    .when(active, |d| d.bg(t.muted).text_color(t.foreground).font_weight(FontWeight::MEDIUM))
                    .when(!active, |d| {
                        d.text_color(t.muted_foreground).hover(|s| s.bg(with_alpha(t.muted, 0.5)).text_color(t.foreground))
                    })
                    .on_click(cx.listener(move |this, _, _, cx| this.set_section(id, cx)))
                    .child(Icon::new(*icon).size_4().flex_shrink_0())
                    .child(*label),
            );
        }
        div()
            .flex()
            .flex_col()
            .h_full()
            .min_h_0()
            .w(px(208.))
            .flex_shrink_0()
            .border_r_1()
            .border_color(t.border)
            .child(search)
            .child(nav)
    }

    // ---- search results -----------------------------------------------------------------

    fn render_search_results(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let results = search::filter(&self.query);
        let q = self.query.trim().to_string();
        if results.is_empty() {
            return div()
                .flex()
                .flex_col()
                .items_center()
                .gap_2()
                .py_16()
                .child(Icon::new(IconName::SearchX).size_8().text_color(with_alpha(t.muted_foreground, 0.5)))
                .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(format!("No settings match \u{201c}{q}\u{201d}")))
                .child(
                    div()
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .child("Try a different keyword, or browse sections in the sidebar."),
                )
                .child(
                    div().mt_2().child(
                        Button::new("settings-search-clear-empty")
                            .outline()
                            .size(ButtonSize::Sm)
                            .label("Clear search")
                            .on_click(cx.listener(|this, _, w, cx| this.clear_search(w, cx))),
                    ),
                )
                .into_any_element();
        }
        let n = results.len();
        let mut col = div().flex().flex_col().gap_6().child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .tw_text_sm()
                        .child(Icon::new(IconName::Search).size(px(14.)).text_color(t.muted_foreground))
                        .child(div().font_weight(FontWeight::SEMIBOLD).child(format!("{n} {}", if n == 1 { "result" } else { "results" })))
                        .child(div().text_color(t.muted_foreground).child(format!("for \u{201c}{q}\u{201d}"))),
                )
                .child(
                    Button::new("settings-search-clear-top")
                        .ghost()
                        .size(ButtonSize::Sm)
                        .label("Clear")
                        .on_click(cx.listener(|this, _, w, cx| this.clear_search(w, cx))),
                ),
        );
        for section in SEARCH_SECTION_ORDER {
            let entries: Vec<_> = results.iter().copied().filter(|e| e.section == *section).collect();
            if entries.is_empty() {
                continue;
            }
            let mut list = div().overflow_hidden().tw_rounded_lg().border_1().border_color(t.border);
            let last = entries.len() - 1;
            for (i, entry) in entries.into_iter().enumerate() {
                list = list.child(
                    div()
                        .id(SharedString::from(format!("search-hit-{}", entry.id)))
                        .group("search-hit")
                        .flex()
                        .w_full()
                        .items_center()
                        .justify_between()
                        .gap_3()
                        .when(i != last, |d| d.border_b_1().border_color(t.border))
                        .bg(t.card)
                        .px(px(14.))
                        .py(px(10.))
                        .cursor_pointer()
                        .hover(|s| s.bg(with_alpha(t.muted, 0.5)))
                        .on_click(cx.listener(move |this, _, w, cx| this.navigate_to(entry, w, cx)))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .min_w_0()
                                .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(entry.title))
                                .child(
                                    div()
                                        .tw_text_xs()
                                        .text_color(t.muted_foreground)
                                        .overflow_hidden()
                                        .text_ellipsis()
                                        .whitespace_nowrap()
                                        .child(entry.description),
                                ),
                        )
                        .child(
                            div()
                                .invisible()
                                .group_hover("search-hit", |s| s.visible())
                                .child(Icon::new(IconName::ArrowRight).size(px(14.)).text_color(t.muted_foreground)),
                        ),
                );
            }
            col = col.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(sub_heading(search::section_label(section), cx))
                    .child(list),
            );
        }
        col.into_any_element()
    }

    // ---- general --------------------------------------------------------------------------

    fn render_appearance(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let current = self.model.read(cx).app_theme_id.clone();
        let dark_preview = parse_color("#0F0F0F").unwrap_or(t.background);
        let cards = [("light", "light", "Light"), ("dark", "rexadb-dark", "Dark"), ("system", "system", "System")];
        let mut grid = div().flex().gap_3().max_w(px(512.));
        for (id, theme_id, label) in cards {
            let selected = current == theme_id;
            let preview = match id {
                "light" => div().flex_1().bg(gpui::white()),
                "dark" => div().flex_1().bg(dark_preview),
                // bg-gradient-to-br from-white to-[#0F0F0F]
                _ => div().flex_1().bg(linear_gradient(135., linear_color_stop(gpui::white(), 0.), linear_color_stop(dark_preview, 1.))),
            };
            let m = self.model.clone();
            grid = grid.child(
                div()
                    .id(SharedString::from(format!("appearance-{id}")))
                    .group("appearance-card")
                    .flex_1()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap(px(6.))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| m.update(cx, |m, cx| m.set_app_theme(theme_id, cx)))
                    .child(
                        div()
                            .relative()
                            .w_full()
                            .h(px(101.))
                            .tw_rounded_lg()
                            .border_2()
                            .overflow_hidden()
                            .flex()
                            .flex_col()
                            .when(selected, |d| d.border_color(tw("blue-500")).shadow_sm())
                            .when(!selected, |d| {
                                d.border_color(t.border).group_hover("appearance-card", |s| s.border_color(with_alpha(t.muted_foreground, 0.2)))
                            })
                            .child(preview)
                            .child(
                                div()
                                    .h_4()
                                    .bg(with_alpha(t.muted, 0.3))
                                    .border_t_1()
                                    .border_color(t.border)
                                    .flex()
                                    .items_center()
                                    .px(px(6.))
                                    .gap_1()
                                    .children(["red-500", "amber-500", "green-500"].map(|c| {
                                        div().size(px(6.)).tw_rounded_lg().bg(with_alpha(tw(c), 0.5))
                                    })),
                            )
                            .when(selected, |d| {
                                d.child(
                                    div()
                                        .absolute()
                                        .top_2()
                                        .right_2()
                                        .size_4()
                                        .bg(tw("blue-500"))
                                        .tw_rounded_lg()
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .child(Icon::new(IconName::Check).size(px(10.)).text_color(white(1.))),
                                )
                            }),
                    )
                    .child(
                        div()
                            .tw_text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(if selected { t.foreground } else { t.muted_foreground })
                            .child(label),
                    ),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap_3()
            .when(self.hl("appearance"), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
            .child(title_block("Appearance", "Select how Rexa DB looks on your device.", None, cx))
            .child(grid)
    }

    /// ThemeSelectSection: theme select (w-48) over an "Add Theme" menu.
    fn theme_select(
        &self,
        id: &'static str,
        value: String,
        builtins: Vec<(String, String)>,
        customs: Vec<NamedTheme>,
        custom_icon: IconName,
        on_change: impl Fn(SharedString, &mut Window, &mut App) + 'static,
        on_custom: impl Fn(&mut Window, &mut App) + 'static,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let mut entries: Vec<SelectEntry> = builtins.into_iter().map(|(v, l)| SelectOption::new(v, l).into()).collect();
        if !customs.is_empty() {
            entries.push(SelectEntry::Label("Custom".into()));
        }
        entries.extend(customs.into_iter().map(|t| SelectOption::new(t.id, t.name).into()));
        let this = cx.entity();
        let on_custom = std::rc::Rc::new(on_custom);
        div()
            .flex()
            .flex_col()
            .items_end()
            .gap(px(6.))
            .child(Select::new(SharedString::from(format!("{id}-select"))).w(px(192.)).entries(entries).value(Some(value)).on_change(on_change))
            .child(
                DropdownMenu::new(SharedString::from(format!("{id}-add")))
                    .align(Align::End)
                    .trigger(Button::new(SharedString::from(format!("{id}-add-btn"))).outline().size(ButtonSize::Xs).label("Add Theme"))
                    .menu(move |m, _, _| {
                        let this = this.clone();
                        let on_custom = on_custom.clone();
                        m.w(192.)
                            .item(MenuItem::new("Browse Themes").icon(IconName::Globe).text_xs().on_select(move |_, cx| {
                                this.update(cx, |v, cx| v.set_section("themes", cx))
                            }))
                            .item(MenuItem::new("Custom Theme").icon(custom_icon).text_xs().on_select(move |w, cx| on_custom(w, cx)))
                    }),
            )
    }

    fn render_general(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let model = self.model.clone();
        let (app_theme, customs, noise_on, tui_on, sleek, icon_theme, icon_customs) = {
            let m = model.read(cx);
            (
                m.app_theme_id.clone(),
                m.custom_app_themes.clone(),
                m.bool("noiseBgEnabled"),
                m.bool("tuiMode"),
                m.bool("sleekLayout"),
                m.str("iconThemeId"),
                m.value("customIconThemes").as_array().cloned().unwrap_or_default(),
            )
        };
        let this = cx.entity();
        let m1 = model.clone();
        let app_theme_row = div()
            .flex()
            .items_start()
            .justify_between()
            .gap_3()
            .border_t_1()
            .border_color(t.border)
            .py_3()
            .when(self.hl("app-theme"), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
            .child(title_block("App Theme", "Choose a built-in theme or add a custom palette for the whole app.", Some(448.), cx))
            .child(self.theme_select(
                "app-theme",
                app_theme,
                builtin_app_themes(),
                customs.clone(),
                IconName::Upload,
                move |v, _, cx| m1.update(cx, |m, cx| m.set_app_theme(&v, cx)),
                move |_, cx| this.update(cx, |v, cx| v.open_side_panel(SidePanel::ThemeCreator, cx)),
                cx,
            ));

        let custom_list = (!customs.is_empty()).then(|| {
            let mut list = div().flex().flex_col().gap(px(6.));
            for theme in customs {
                let m = model.clone();
                let id = theme.id.clone();
                list = list.child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(with_alpha(t.border, 0.6))
                        .bg(with_alpha(t.var_or("--secondary", t.muted), 0.2))
                        .px(px(10.))
                        .py(px(6.))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(theme.name.clone()))
                                .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} \u{2022} {}", theme.id, theme.base))),
                        )
                        .child(remove_button(SharedString::from(format!("rm-app-theme-{id}")), move |_, cx| {
                            m.update(cx, |m, cx| m.remove_custom_app_theme(&id, cx))
                        })),
                );
            }
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .pb_1()
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Custom app themes"))
                .child(list)
        });

        let zoom = model.read(cx).num("appZoom") as i64;
        let zoom_ctl = div()
            .flex()
            .items_center()
            .gap_1()
            .child(
                Button::new("zoom-minus")
                    .outline()
                    .size(ButtonSize::IconSm)
                    .icon(IconName::Minus)
                    .disabled(zoom <= MIN_ZOOM)
                    .on_click(cx.listener(move |this, _, _, cx| this.set_zoom(zoom - ZOOM_STEP, cx))),
            )
            .child(div().w_16().child(TextInput::new(&self.zoom).h(28.)))
            .child(
                Button::new("zoom-plus")
                    .outline()
                    .size(ButtonSize::IconSm)
                    .icon(IconName::Plus)
                    .disabled(zoom >= MAX_ZOOM)
                    .on_click(cx.listener(move |this, _, _, cx| this.set_zoom(zoom + ZOOM_STEP, cx))),
            );

        let row = |id: &'static str, title: &'static str, desc: &'static str, ctl: AnyElement, cx: &App| {
            setting_row(title, desc, ctl, self.hl(id), cx)
        };
        let toggle = |id: &'static str, key: &'static str, title: &'static str, desc: &'static str, cx: &App| {
            setting_row(title, desc, model_toggle(&model, key, cx), self.hl(id), cx)
        };
        let select = |id: &'static str, key: &'static str, title: &'static str, desc: &'static str, opts: &[(&str, &str)], disabled: bool, cx: &App| {
            setting_row(title, desc, model_select(&model, key, opts, 128., disabled, false, cx), self.hl(id), cx)
        };

        let m_sleek = model.clone();
        let active_sleek = sleek;
        let sleek_ctl = div()
            .flex()
            .flex_col()
            .items_end()
            .gap_1()
            .when(sleek != active_sleek, |d| {
                d.child(div().tw_text_xs().text_color(tw("amber-500")).font_weight(FontWeight::MEDIUM).child("Applying layout changes..."))
            })
            .child(rows::toggle_button("toggle-sleekLayout", sleek, cx, move |v, _, cx| {
                m_sleek.update(cx, |m, cx| m.set("sleekLayout", v, cx))
            }));

        let noise_m = model.clone();
        let noise_block = noise_on.then(|| {
            let (size, opacity, color) = {
                let m = model.read(cx);
                (m.num("noiseBgSize"), m.num("noiseBgOpacity"), m.str("noiseBgColor"))
            };
            div()
                .flex()
                .flex_col()
                .gap_3()
                .border_t_1()
                .border_color(t.border)
                .pt_3()
                .child(row("noise-size", "Noise Size", "Scale of the noise pattern (smaller = finer grain).", range_slider("noise-size", size, 1., 100., noise_m.clone(), "noiseBgSize", cx).into_any_element(), cx))
                .child(select(
                    "noise-blend",
                    "noiseBgBlendMode",
                    "Blend Mode",
                    "How the noise blends with the background.",
                    &[("overlay", "Overlay"), ("soft-light", "Soft Light"), ("multiply", "Multiply"), ("screen", "Screen")],
                    false,
                    cx,
                ))
                .child(row("noise-color", "Color", "Tint color for the noise texture.", color_swatch_picker("noise-color", &color, noise_m.clone(), "noiseBgColor", cx).into_any_element(), cx))
                .child(row("noise-opacity", "Opacity", "Strength of the noise effect.", range_slider("noise-opacity", opacity, 0., 100., noise_m.clone(), "noiseBgOpacity", cx).into_any_element(), cx))
        });

        div()
            .flex()
            .flex_col()
            .gap_5()
            .child(section_title("General"))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(self.render_appearance(cx))
                    .child(app_theme_row)
                    .children(custom_list)
                    .child(self.font_row("app-font", &self.app_font.clone(), None, None, cx))
                    .child(self.render_icon_theme(icon_theme, icon_customs, cx))
                    .child(crate::app_icon::render_app_icon_setting(self.hl("app-icon"), cx))
                    .child(row("zoom", "Zoom Level", "Increase or decrease the overall zoom of the application.", zoom_ctl.into_any_element(), cx))
                    .child(toggle(
                        "infinite-table-scrolling",
                        "infiniteTableScrolling",
                        "Infinite scrolling",
                        "Load more table rows as you scroll. Tables without a primary key use pagination. Turn off to use page-by-page navigation for all tables.",
                        cx,
                    ))
                    .child(select(
                        "row-spacing",
                        "rowSpacing",
                        "Row Spacing",
                        "Adjust the vertical spacing between rows in data tables.",
                        &[("compact", "Compact"), ("standard", "Standard"), ("relaxed", "Relaxed")],
                        false,
                        cx,
                    ))
                    .child(toggle("tui-mode", "tuiMode", "Terminal UI (Experimental)", "Switch the app to a blocky terminal-style UI with mono typography.", cx))
                    .child(select(
                        "tui-theme",
                        "tuiTheme",
                        "Terminal Theme",
                        "Choose light, dark, or follow system while in terminal UI.",
                        &[("auto", "System"), ("light", "Light"), ("dark", "Dark")],
                        !tui_on,
                        cx,
                    ))
                    .child(row("sleek-layout", "Sleek Layout", "Add padding and rounded corners to main interface panels.", sleek_ctl.into_any_element(), cx))
                    .child(select(
                        "button-style",
                        "buttonStyle",
                        "Button Style",
                        "How buttons and dropdowns look in dark mode.",
                        &[("raised", "Raised"), ("glass", "Glass"), ("off", "Flat")],
                        false,
                        cx,
                    ))
                    .child(toggle(
                        "translucent-bg",
                        "noiseBgTranslucent",
                        "Translucent Background",
                        "Make the outer chrome translucent with a blur effect, showing the desktop behind the window.",
                        cx,
                    ))
                    .child(toggle("bg-noise", "noiseBgEnabled", "Background Noise", "Add a subtle grain texture to the sidebar and outer surface.", cx))
                    .children(noise_block)
                    .child(toggle(
                        "alternating-rows",
                        "alternatingRowColors",
                        "Alternating Row Colors",
                        "Apply alternating background colors to rows in data tables for easier reading.",
                        cx,
                    ))
                    .child(toggle(
                        "pending-banner",
                        "showPendingChangesBanner",
                        "Show Pending Changes Banner",
                        "Display a banner above the data grid when there are unsaved changes.",
                        cx,
                    ))
                    .child(toggle(
                        "restore-state",
                        "restoreAppState",
                        "Restore App State",
                        "When enabled, reopens tabs and restores your previous session when you return to a connection.",
                        cx,
                    ))
                    .child(toggle(
                        "open-new-window",
                        "openConnectionsInNewWindow",
                        "Open Connections in New Window",
                        "When enabled, each connection opens in its own window instead of replacing the current one.",
                        cx,
                    ))
                    .child(toggle(
                        "autosave-queries",
                        "autoSaveQueries",
                        "Auto-Save Executed Queries",
                        "Automatically save every executed query as a snippet with a query number and timestamp.",
                        cx,
                    ))
                    .child({
                        // searchSettings.localIndexEnabled lives in `rexa-db-search-settings` (localStorage).
                        let enabled = crate::persist::local_get("rexa-db-search-settings")
                            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                            .and_then(|v| v.get("localIndexEnabled").and_then(|b| b.as_bool()))
                            .unwrap_or(false);
                        setting_row(
                            "Local Search Index",
                            "Cache universal search results in a local SQLite database for instant repeat searches. Indexed data is stored separately from your connection database.",
                            rows::toggle_button("toggle-local-index", enabled, cx, |v, _, cx| {
                                let mut cur = crate::persist::local_get("rexa-db-search-settings")
                                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                                    .filter(|v| v.is_object())
                                    .unwrap_or_else(|| serde_json::json!({}));
                                cur["localIndexEnabled"] = Value::Bool(v);
                                crate::persist::local_set("rexa-db-search-settings", &cur.to_string()).ok();
                                cx.refresh_windows();
                            }),
                            self.hl("local-search-index"),
                            cx,
                        )
                    }),
            )
            .into_any_element()
    }

    /// CustomFontSetting.
    fn font_row(
        &self,
        id: &'static str,
        state: &Entity<InputState>,
        title: Option<&'static str>,
        description: Option<&'static str>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let t = cx.tokens().clone();
        let empty = state.read(cx).value().trim().is_empty();
        let s = state.clone();
        div()
            .flex()
            .items_start()
            .justify_between()
            .gap_3()
            .border_t_1()
            .border_color(t.border)
            .py_3()
            .when(self.hl(id), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
            .child(title_block(
                title.unwrap_or("Custom Font Family"),
                description.unwrap_or(r#"Use any installed font or font stack. Example: "IBM Plex Sans", "Segoe UI", sans-serif"#),
                Some(448.),
                cx,
            ))
            .child(
                div()
                    .flex()
                    .w_full()
                    .max_w(px(384.))
                    .items_center()
                    .gap_2()
                    .child(div().flex_1().child(TextInput::new(state)))
                    .child(
                        Button::new(SharedString::from(format!("{id}-clear")))
                            .outline()
                            .label("Clear")
                            .disabled(empty)
                            .on_click(move |_, w, cx| s.update(cx, |s, cx| s.set_value("", w, cx))),
                    ),
            )
    }

    /// IconThemeSetting.
    fn render_icon_theme(&self, current: String, customs: Vec<Value>, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let model = self.model.clone();
        let m_default = model.clone();
        let m_import = model.clone();
        let mut list = div().flex().flex_col().gap(px(6.));
        for theme in &customs {
            let id = theme.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let name = theme.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let overrides = theme.get("icons").and_then(|v| v.as_object()).map_or(0, |o| o.len());
            let active = current == id;
            let (m_use, m_rm, id_use, id_rm) = (model.clone(), model.clone(), id.clone(), id.clone());
            list = list.child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.6))
                    .bg(with_alpha(t.var_or("--secondary", t.muted), 0.2))
                    .px(px(10.))
                    .py_2()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(name))
                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{id} \u{2022} {overrides} overrides"))),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .child(
                                Button::new(SharedString::from(format!("icon-use-{id}")))
                                    .when(!active, |b| b.outline())
                                    .size(ButtonSize::Xs)
                                    .label(if active { "Active" } else { "Use" })
                                    .on_click(move |_, _, cx| m_use.update(cx, |m, cx| m.set("iconThemeId", id_use.clone(), cx))),
                            )
                            .child(remove_button(SharedString::from(format!("icon-rm-{id}")), move |_, cx| {
                                m_rm.update(cx, |m, cx| {
                                    let mut list = m.value("customIconThemes").as_array().cloned().unwrap_or_default();
                                    list.retain(|t| t.get("id").and_then(|v| v.as_str()) != Some(id_rm.as_str()));
                                    m.set("customIconThemes", Value::Array(list), cx);
                                    if m.str("iconThemeId") == id_rm {
                                        m.set("iconThemeId", DEFAULT_ICON_THEME_ID, cx);
                                    }
                                })
                            })),
                    ),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap_3()
            .border_t_1()
            .border_color(t.border)
            .py_3()
            .when(self.hl("icon-theme"), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
            .child(
                div()
                    .flex()
                    .items_start()
                    .justify_between()
                    .gap_3()
                    .child(title_block(
                        "Icon Theme",
                        "Import a JSON manifest that maps Lucide export names like LayoutDashboard or RefreshCw to SVG files.",
                        Some(448.),
                        cx,
                    ))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                Button::new("icon-theme-default")
                                    .when(current != DEFAULT_ICON_THEME_ID, |b| b.outline())
                                    .label("Lucide Default")
                                    .on_click(move |_, _, cx| m_default.update(cx, |m, cx| m.set("iconThemeId", DEFAULT_ICON_THEME_ID, cx))),
                            )
                            .child(Button::new("icon-theme-import").outline().label("Import Theme").on_click(move |_, _, cx| {
                                import_icon_theme(m_import.clone(), cx)
                            })),
                    ),
            )
            .when(!customs.is_empty(), |d| d.child(list))
    }

    // ---- editor -----------------------------------------------------------------------------

    fn render_editor(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let model = self.model.clone();
        let case_opts: &[(&str, &str)] = &[("preserve", "Preserve"), ("upper", "Upper"), ("lower", "Lower")];
        let select = |id: &'static str, key: &'static str, title: &'static str, desc: &'static str, opts: &[(&str, &str)], w: f32, numeric: bool, cx: &App| {
            setting_row(title, desc, model_select(&model, key, opts, w, false, numeric, cx), self.hl(id), cx)
        };
        let switch = |id: &'static str, key: &'static str, title: &'static str, desc: &'static str, cx: &App| {
            setting_row(title, desc, rows::model_switch(&model, key)(cx), self.hl(id), cx)
        };
        let (editor_theme, customs) = {
            let m = model.read(cx);
            (m.editor_theme_id.clone(), m.custom_editor_themes.clone())
        };
        let m1 = model.clone();
        let this = cx.entity();
        let theme_row = div()
            .flex()
            .items_start()
            .justify_between()
            .gap_3()
            .border_t_1()
            .border_color(t.border)
            .py_3()
            .when(self.hl("editor-theme"), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
            .child(title_block("Editor Theme", "Choose a built-in theme or add a custom VS Code theme JSON for editors.", Some(448.), cx))
            .child(self.theme_select(
                "editor-theme",
                editor_theme,
                EDITOR_BUILTIN_THEMES.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
                customs,
                IconName::Code,
                move |v, _, cx| m1.update(cx, |m, cx| m.set_editor_theme(&v, cx)),
                move |_, cx| crate::themes::open_editor_theme_dialog(this.read(cx).model.clone(), cx),
                cx,
            ));
        let tab_widths: Vec<(String, String)> =
            [1, 2, 3, 4, 6, 8].iter().map(|n| (n.to_string(), format!("{n} {}", if *n == 1 { "space" } else { "spaces" }))).collect();
        let widths: Vec<(String, String)> = [10, 20, 30, 40, 50, 60, 80, 100, 120].iter().map(|n| (n.to_string(), n.to_string())).collect();
        let lines: Vec<(String, String)> = (0..=5).map(|n| (n.to_string(), n.to_string())).collect();
        let as_ref = |v: &Vec<(String, String)>| v.iter().map(|(a, b)| (a.clone(), b.clone())).collect::<Vec<_>>();
        fn opts(v: &[(String, String)]) -> Vec<(&str, &str)> { v.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect() }
        let _ = as_ref;
        div()
            .flex()
            .flex_col()
            .gap_5()
            .child(section_title("Editor"))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(select(
                        "editor-font-size",
                        "editorFontSize",
                        "Editor Font Size",
                        "Adjust the font size for query editors.",
                        &[("12px", "12px"), ("13px", "13px"), ("14px", "14px"), ("16px", "16px")],
                        128.,
                        false,
                        cx,
                    ))
                    .child(self.font_row(
                        "editor-font-family",
                        &self.editor_font.clone(),
                        Some("Editor Font Family"),
                        Some("Use a specific font for the SQL editor. If empty, it will follow the app font."),
                        cx,
                    ))
                    .child(switch("vim-mode", "vimMode", "Vim Mode", "Enable Vim keybindings for the SQL editor.", cx))
                    .child(switch("result-tabs", "resultTabsEnabled", "Result Tabs", "Show query results in individual tabs for multi-statement queries.", cx))
                    .child(theme_row),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(div().pt_4().child(sub_heading("SQL Formatting", cx)))
                    .child(select("sql-keyword-case", "sqlFormatKeywordCase", "Keyword Case", "Casing for SQL keywords (SELECT, FROM, WHERE...).", case_opts, 128., false, cx))
                    .child(select("sql-datatype-case", "sqlFormatDataTypeCase", "Data Type Case", "Casing for data types (INT, VARCHAR...).", case_opts, 128., false, cx))
                    .child(select("sql-function-case", "sqlFormatFunctionCase", "Function Case", "Casing for function names (COUNT, SUM...).", case_opts, 128., false, cx))
                    .child(select("sql-identifier-case", "sqlFormatIdentifierCase", "Identifier Case", "Casing for identifiers (experimental).", case_opts, 128., false, cx))
                    .child(select("sql-tab-width", "sqlFormatTabWidth", "Tab Width", "Number of spaces per indentation level.", &opts(&tab_widths), 96., true, cx))
                    .child(switch("sql-use-tabs", "sqlFormatUseTabs", "Use Tabs", "Use tab characters instead of spaces for indentation.", cx))
                    .child(select(
                        "sql-logical-newline",
                        "sqlFormatLogicalOperatorNewline",
                        "Logical Operator Newline",
                        "Place AND/OR before or after the newline.",
                        &[("before", "Before"), ("after", "After")],
                        112.,
                        false,
                        cx,
                    ))
                    .child(select("sql-expression-width", "sqlFormatExpressionWidth", "Expression Width", "Max chars in parentheses before wrapping.", &opts(&widths), 112., true, cx))
                    .child(select("sql-lines-between", "sqlFormatLinesBetweenQueries", "Lines Between Queries", "Number of blank lines between separate queries.", &opts(&lines), 96., true, cx))
                    .child(switch("sql-dense-operators", "sqlFormatDenseOperators", "Dense Operators", "Remove spaces around operators (e.g. a=b instead of a = b).", cx))
                    .child(switch("sql-newline-semicolon", "sqlFormatNewlineBeforeSemicolon", "Newline Before Semicolon", "Place semicolons on their own line.", cx)),
            )
            .into_any_element()
    }

    // ---- security ----------------------------------------------------------------------------

    fn render_security(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let model = self.model.clone();
        div()
            .flex()
            .flex_col()
            .gap_5()
            .child(section_title("Security"))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(crate::security::render_credential_storage(self, cx))
                    .child(setting_row(
                        "Execution Mode",
                        "When set to \"Review\", queries are sent to a review panel instead of executing directly.",
                        model_select(&model, "executionMode", &[("direct", "Direct"), ("review", "Review")], 128., false, false, cx),
                        self.hl("execution-mode"),
                        cx,
                    )),
            )
            .into_any_element()
    }

    // ---- side panels -------------------------------------------------------------------------

    pub fn open_side_panel(&mut self, panel: SidePanel, cx: &mut Context<Self>) {
        self.side_panel = panel;
        cx.notify();
    }

    fn render_side_panel(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let t = cx.tokens().clone();
        let body: AnyElement = match self.side_panel {
            SidePanel::None => return None,
            SidePanel::ThemeCreator => {
                let this = cx.entity().downgrade();
                let model = self.model.clone();
                self.theme_creator
                    .get_or_insert_with(|| {
                        cx.new(|cx| crate::theme_creator::ThemeCreatorPanel::new(model, this, window, cx))
                    })
                    .clone()
                    .into_any_element()
            }
            SidePanel::IconThemeCreator => {
                let this = cx.entity().downgrade();
                let model = self.model.clone();
                self.icon_creator
                    .get_or_insert_with(|| cx.new(|cx| crate::theme_creator::IconThemeCreatorPanel::new(model, this, window, cx)))
                    .clone()
                    .into_any_element()
            }
        };
        Some(div().w(px(340.)).flex_shrink_0().overflow_hidden().border_l_1().border_color(t.studio_border).child(body).into_any_element())
    }

    pub(crate) fn close_side_panel(&mut self, cx: &mut Context<Self>) {
        self.side_panel = SidePanel::None;
        self.theme_creator = None;
        self.icon_creator = None;
        cx.notify();
    }

    // ---- lazily created section views ---------------------------------------------------------

    pub(crate) fn workspace_section(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Entity<crate::workspace::WorkspaceSection> {
        self.workspace.get_or_insert_with(|| cx.new(|cx| crate::workspace::WorkspaceSection::new(window, cx))).clone()
    }

    fn section_body(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        match self.section {
            "general" => self.render_general(cx),
            "editor" => self.render_editor(cx),
            "security" => self.render_security(cx),
            "advanced" => crate::advanced::render_advanced(self, window, cx),
            "themes" => {
                let this = cx.entity().downgrade();
                let model = self.model.clone();
                div()
                    .when(self.hl("themes-browse"), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(cx.tokens().primary, 0.5)))
                    .child(self.themes.get_or_insert_with(|| cx.new(|cx| crate::themes::ThemesSection::new(model, this, window, cx))).clone())
                    .into_any_element()
            }
            "ai" => {
                let model = self.model.clone();
                self.ai.get_or_insert_with(|| cx.new(|cx| crate::ai::AiSection::new(model, window, cx))).clone().into_any_element()
            }
            "mcp" => self.mcp.get_or_insert_with(|| cx.new(|cx| crate::mcp::McpSection::new(window, cx))).clone().into_any_element(),
            "keybindings" => self
                .keybindings
                .get_or_insert_with(|| cx.new(|cx| crate::keybindings::KeybindingsPanel::new(window, cx)))
                .clone()
                .into_any_element(),
            "workspace" => self.workspace_section(window, cx).into_any_element(),
            _ => div().into_any_element(),
        }
    }
}

impl Render for SettingsView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let searching = !self.query.trim().is_empty();
        let body = if searching { self.render_search_results(cx) } else { self.section_body(window, cx) };
        let side = self.render_side_panel(window, cx);
        div()
            .size_full()
            .flex()
            .min_h_0()
            .bg(t.background)
            .text_color(t.foreground)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .flex()
                    .min_h_0()
                    .child(self.render_sidebar(cx))
                    .child(
                        div()
                            .id("settings-content")
                            .min_w_0()
                            .flex_1()
                            .h_full()
                            .overflow_y_scroll()
                            .track_scroll(&self.content_scroll)
                            .px_8()
                            .py_6()
                            .child(body),
                    ),
            )
            .children(side)
    }
}

/// `Button variant="ghost" className="h-7 px-2 text-xs text-red-500 hover:text-red-600"` "Remove".
pub(crate) fn remove_button(id: SharedString, f: impl Fn(&mut Window, &mut App) + 'static) -> impl IntoElement {
    div()
        .id(id)
        .h_7()
        .px_2()
        .flex()
        .items_center()
        .tw_rounded_md()
        .tw_text_xs()
        .text_color(tw("red-500"))
        .hover(|s| s.text_color(tw("red-600")))
        .cursor_pointer()
        .on_click(move |_, w, cx| f(w, cx))
        .child("Remove")
}

/// `<input type="range" className="h-2 w-28">` bound to a numeric studio key.
fn range_slider(
    id: &'static str,
    value: f64,
    min: f64,
    max: f64,
    model: Entity<SettingsModel>,
    key: &'static str,
    cx: &App,
) -> impl IntoElement {
    crate::tint::range_slider(id, value, min, max, 112., cx, move |v, _, cx| {
        if (model.read(cx).num(key) - v).abs() > f64::EPSILON {
            model.update(cx, |m, cx| m.set(key, v as i64, cx));
        }
    })
}

/// `<input type="color">`: a swatch cycling through a small palette is not the
/// native picker, so this opens the tint color picker popover instead.
fn color_swatch_picker(id: &'static str, value: &str, model: Entity<SettingsModel>, key: &'static str, cx: &App) -> impl IntoElement {
    crate::tint::color_input(id, value, cx, move |v, _, cx| model.update(cx, |m, cx| m.set(key, v, cx)))
}

/// IconThemeSetting.handleImportTheme: pick a .json manifest and add it.
fn import_icon_theme(model: Entity<SettingsModel>, cx: &mut App) {
    let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
    cx.spawn(async move |cx| {
        let Ok(Ok(Some(paths))) = paths.await else { return };
        let Some(path) = paths.first() else { return };
        let result = std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<Value>(&s).map_err(|e| e.to_string()));
        cx.update(|cx| match result {
            Ok(theme) if theme.get("id").and_then(|v| v.as_str()).is_some() => {
                let id = theme["id"].as_str().unwrap_or_default().to_string();
                let name = theme.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
                model.update(cx, |m, cx| {
                    let mut list = m.value("customIconThemes").as_array().cloned().unwrap_or_default();
                    list.retain(|t| t.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
                    list.push(theme);
                    m.set("customIconThemes", Value::Array(list), cx);
                    m.set("iconThemeId", id.clone(), cx);
                });
                rexa_ui::toast::success(format!("Imported {name}."), cx);
            }
            Ok(_) => {
                rexa_ui::toast::error("Failed to import icon theme.", cx);
            }
            Err(e) => {
                rexa_ui::toast::error(e, cx);
            }
        });
    })
    .detach();
}

/// AppSettingsView / the connections-home settings dialog wrapper.
pub fn build(section: &str, window: &mut Window, cx: &mut App) -> Entity<SettingsView> {
    let section = section.to_string();
    cx.new(|cx| SettingsView::new(&section, window, cx))
}

#[allow(unused)]
fn _unused(_: Switch) {}
