//! Port of the `connectionScreen === "new-select"` branch of
//! components/connections/connection-manager.tsx (paste-a-URI input, account
//! cards, the provider grid) and components/studio/jdbc-picker-screen.tsx.

use crate::accounts::AccountKind;
use crate::fields;
use crate::home::{ConnectionsScreen, Screen};
use crate::providers::PROVIDER_CARDS;
use crate::widgets::{self, provider_logo};
use gpui::{div, img, prelude::*, px, svg, AnyElement, Context, FontWeight, ObjectFit, SharedString, Window};
use rexa_ui::theme::{with_alpha, Tokens};
use rexa_ui::{Button, ButtonSize, Tw};

impl ConnectionsScreen {
    fn account_card(
        &self,
        id: &'static str,
        title: &'static str,
        subtitle: String,
        logo: AnyElement,
        kind: AccountKind,
        t: &Tokens,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        // w-full min-w-0 flex items-center gap-3 rounded-lg border border-studio-border/60
        // bg-studio-bg/60 p-3 hover:border-studio-border hover:bg-studio-row-hover/80
        div()
            .id(id)
            .w_full()
            .min_w_0()
            .flex()
            .items_center()
            .gap_3()
            .tw_rounded_lg()
            .border_1()
            .border_color(with_alpha(t.studio_border, 0.6))
            .bg(with_alpha(t.studio_bg, 0.6))
            .p_3()
            .cursor_pointer()
            .hover(|s| s.border_color(t.studio_border).bg(with_alpha(t.studio_row_hover, 0.8)))
            .on_click(cx.listener(move |this, _, window, cx| this.open_accounts(kind, window, cx)))
            .child(
                div()
                    .flex_shrink_0()
                    .size_10()
                    .tw_rounded_lg()
                    .bg(with_alpha(t.muted, 0.6))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(logo),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).overflow_hidden().text_ellipsis().whitespace_nowrap().child(title))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).line_clamp(2).child(subtitle)),
            )
    }

    pub(crate) fn render_new_select(&mut self, t: &Tokens, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let a = self.accounts.clone();
        let n_label = |n: usize, none: &str, one: String| match n {
            0 => none.to_string(),
            1 => one,
            n => format!("{n} accounts linked"),
        };
        let mut accounts = div()
            .grid()
            .grid_cols(2)
            .gap_3()
            .child(self.account_card(
                "acct-supabase",
                "Supabase Account",
                n_label(a.supabase.len(), "Log in to browse and connect your projects", format!("Logged in as {}", a.supabase.first().cloned().unwrap_or_default())),
                img("brand/supabase.svg").size(px(28. * 0.78)).into_any_element(),
                AccountKind::Supabase,
                t,
                cx,
            ))
            .child(self.account_card(
                "acct-spacetimedb",
                "SpacetimeDB Account",
                n_label(a.spacetimedb.len(), "Log in to browse and connect your databases", format!("Logged in as {}", a.spacetimedb.first().cloned().unwrap_or_default())),
                svg().path("brand/spacetimedb.svg").size(px(26.)).text_color(with_alpha(t.foreground, 0.8)).into_any_element(),
                AccountKind::SpacetimeDb,
                t,
                cx,
            ))
            .child(self.account_card(
                "acct-neon",
                "Neon Account",
                n_label(a.neon.len(), "Sign in to browse and connect your projects", format!("Signed in as {}", a.neon.first().cloned().unwrap_or_default())),
                img("brand/neon.svg").size(px(28. * 0.72)).into_any_element(),
                AccountKind::Neon,
                t,
                cx,
            ));
        if crate::accounts::PLANETSCALE_LOGIN_ENABLED {
            accounts = accounts.child(self.account_card(
                "acct-planetscale",
                "PlanetScale Account",
                n_label(a.planetscale.len(), "Log in to browse and connect your databases", format!("Logged in as {}", a.planetscale.first().cloned().unwrap_or_default())),
                img("providers/planetscale.png").size_7().into_any_element(),
                AccountKind::Planetscale,
                t,
                cx,
            ));
        }

        let mut grid = div().grid().grid_cols(4).gap_3();
        for (i, card) in PROVIDER_CARDS.iter().enumerate() {
            let focused = i == self.provider_focus;
            let id = card.id;
            // group flex flex-col items-center justify-center rounded-lg border border-studio-border/60
            // bg-studio-bg/60 p-3.5 hover:border-studio-border hover:bg-studio-row-hover/80
            grid = grid.child(
                div()
                    .id(SharedString::from(format!("provider-{id}")))
                    .group(SharedString::from(format!("pc-{id}")))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.studio_border, 0.6))
                    .bg(with_alpha(t.studio_bg, 0.6))
                    .p(px(14.))
                    .cursor_pointer()
                    .hover(|s| s.border_color(t.studio_border).bg(with_alpha(t.studio_row_hover, 0.8)))
                    .when(focused && false, |d| d)
                    .on_click(cx.listener(move |this, _, window, cx| this.select_provider(id, window, cx)))
                    .child(
                        div()
                            .mb_2()
                            .opacity(0.8)
                            .group_hover(SharedString::from(format!("pc-{id}")), |s| s.opacity(1.))
                            .child(provider_logo(id, 26., cx)),
                    )
                    .child(
                        div()
                            .tw_text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.muted_foreground)
                            .group_hover(SharedString::from(format!("pc-{id}")), |s| s.text_color(t.foreground))
                            .child(card.label),
                    ),
            );
        }

        let divider = div()
            .relative()
            .flex()
            .items_center()
            .justify_center()
            .child(div().absolute().left_0().right_0().top(px(8.)).h(px(1.)).bg(with_alpha(t.studio_border, 0.6)))
            .child(div().relative().bg(t.studio_bg).px_2().tw_text_xs().text_color(t.muted_foreground).child("or connect via account"));

        div()
            .id("new-select-scroll")
            .size_full()
            .overflow_y_scroll()
            .child(
                div().flex().min_h_full().w_full().flex_col().items_center().px_6().py_6().child(
                    div()
                        .w_full()
                        .max_w(px(672.))
                        .flex()
                        .flex_col()
                        .gap_6()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .items_center()
                                .child(div().tw_text_sm().font_weight(FontWeight::BOLD).child("Add Connection"))
                                .child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child("Select a provider or paste connection string")),
                        )
                        .child(widgets::FieldInput::new(&self.select_input).h(44.).mono())
                        .child(divider)
                        .child(accounts)
                        .child(grid)
                        .child(
                            div().flex().justify_center().child(
                                Button::new("select-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(cx.listener(|this, _, window, cx| {
                                    widgets::set_value(&this.select_input, "", window, cx);
                                    this.go_list(cx);
                                    window.focus(&this.focus, cx);
                                })),
                            ),
                        ),
                ),
            )
            .into_any_element()
    }

    /// components/studio/jdbc-picker-screen.tsx (+ jdbc-shared.tsx `useJdbcFilter`, `JdbcLogo`).
    pub(crate) fn render_jdbc_picker(&mut self, t: &Tokens, _window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let q = widgets::value(&self.jdbc_search, cx).to_lowercase();
        let q = q.trim().to_string();
        let mut body = div().flex().flex_col().gap_6();
        let mut any = false;
        for (cat, title) in JDBC_CATEGORIES {
            let items: Vec<_> = fields::jdbc_templates()
                .iter()
                .filter(|tpl| tpl.category == *cat)
                .filter(|tpl| {
                    q.is_empty()
                        || tpl.name.to_lowercase().contains(&q)
                        || tpl.driver_class.to_lowercase().contains(&q)
                        || tpl.category.to_lowercase().contains(&q)
                })
                .collect();
            if items.is_empty() {
                continue;
            }
            any = true;
            let mut grid = div().grid().grid_cols(4).gap_3();
            for (i, tpl) in items.into_iter().enumerate() {
                let name = tpl.name.clone();
                let gid = SharedString::from(format!("jdbc-{cat}-{i}"));
                grid = grid.child(
                    div()
                        .id(gid.clone())
                        .group(gid.clone())
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(with_alpha(t.studio_border, 0.6))
                        .bg(with_alpha(t.studio_bg, 0.6))
                        .p(px(14.))
                        .cursor_pointer()
                        .hover(|s| s.border_color(t.studio_border).bg(with_alpha(t.studio_row_hover, 0.8)))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if let Some(tpl) = fields::jdbc_templates().iter().find(|t| t.name == name) {
                                this.open_jdbc_form(tpl, window, cx);
                            }
                        }))
                        .child(div().mb_2().child(jdbc_logo(&tpl.name, 26.)))
                        .child(
                            div()
                                .tw_text_xs()
                                .line_height(px(15.))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(t.muted_foreground)
                                .group_hover(gid, |s| s.text_color(t.foreground))
                                .text_center()
                                .child(tpl.name.clone()),
                        ),
                );
            }
            body = body.child(
                div()
                    .child(
                        div()
                            .mb_2()
                            .tw_text_xs()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.muted_foreground)
                            .child(rexa_ui::tracked_text::tracked(title.to_uppercase(), 0.05)),
                    )
                    .child(grid),
            );
        }
        if !any {
            body = body.child(
                div().py_8().text_center().tw_text_sm().text_color(t.muted_foreground).child(format!("No databases match \u{201c}{q}\u{201d}")),
            );
        }
        div()
            .id("jdbc-picker-scroll")
            .size_full()
            .overflow_y_scroll()
            .child(
                div().flex().min_h_full().w_full().flex_col().items_center().px_6().py_6().child(
                    div()
                        .w_full()
                        .max_w(px(672.))
                        .flex()
                        .flex_col()
                        .gap_6()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .child(
                                    Button::new("jdbc-back").ghost().size(ButtonSize::Icon).icon(rexa_ui::IconName::ArrowLeft).on_click(cx.listener(
                                        |this, _, window, cx| {
                                            this.screen = Screen::NewSelect;
                                            window.focus(&this.focus, cx);
                                            cx.notify();
                                        },
                                    )),
                                )
                                .child(
                                    div()
                                        .flex_1()
                                        .mr_8()
                                        .flex()
                                        .flex_col()
                                        .items_center()
                                        .child(div().tw_text_sm().font_weight(FontWeight::BOLD).child("Choose a Database"))
                                        .child(div().mt_1().tw_text_sm().text_color(t.muted_foreground).child("Select a JDBC-accessible database engine")),
                                ),
                        )
                        .child(
                            div()
                                .relative()
                                .child(widgets::FieldInput::new(&self.jdbc_search).h(44.).mono().pl(36.))
                                .child(
                                    div()
                                        .absolute()
                                        .left_3()
                                        .top_3()
                                        .child(gpui_component::Icon::new(rexa_ui::IconName::Search).size_4().text_color(t.muted_foreground)),
                                ),
                        )
                        .child(body),
                ),
            )
            .into_any_element()
    }
}

const JDBC_CATEGORIES: &[(&str, &str)] = &[
    ("relational", "Relational"),
    ("nosql", "NoSQL / Document"),
    ("analytics", "Analytics / Big Data"),
    ("cloud", "Cloud / SaaS"),
    ("timeseries", "Time Series / IoT"),
    ("embedded", "Embedded"),
    ("legacy", "Legacy"),
];

/// `JdbcLogo`: `/providers/jdbc/<Name_With_Underscores>.svg`, else coloured initials.
pub fn jdbc_logo(name: &str, size: f32) -> AnyElement {
    let safe: String = name.split_whitespace().collect::<Vec<_>>().join("_").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    let path = format!("providers/jdbc/{safe}.svg");
    use gpui::AssetSource;
    if rexa_ui::assets::Assets.load(&path).ok().flatten().is_some() {
        return img(path).size(px(size)).tw_rounded_lg().object_fit(ObjectFit::Contain).into_any_element();
    }
    let mut hash: i32 = 0;
    for c in name.encode_utf16() {
        hash = (c as i32).wrapping_add(hash.wrapping_shl(5).wrapping_sub(hash));
    }
    let clean = name.replace("(JDBC)", "").replace("(JDBCC)", "");
    let clean = clean.trim();
    let parts: Vec<&str> = clean.split_whitespace().collect();
    let initials = if parts.len() >= 2 {
        format!("{}{}", parts[0].chars().next().unwrap_or(' '), parts[1].chars().next().unwrap_or(' ')).to_uppercase()
    } else {
        clean.chars().take(2).collect::<String>().to_uppercase()
    };
    div()
        .size(px(size))
        .flex_shrink_0()
        .flex()
        .items_center()
        .justify_center()
        .tw_rounded_md()
        .text_color(gpui::white())
        .font_weight(FontWeight::BOLD)
        .tw_text_xs()
        .bg(gpui::hsla((hash.unsigned_abs() % 360) as f32 / 360., 0.55, 0.45, 1.))
        .child(initials)
        .into_any_element()
}
