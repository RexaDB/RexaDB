//! Port of components/app-shell/modern-ui-rail.tsx and
//! components/studio/navigation-rail-item.tsx: the 48px activity rail
//! (pt-10 pb-1.5 pl-2 pr-1, items h-9 w-9 rounded-lg, gap-1.5) with
//! Home / Workspace / Settings pinned at the bottom.

use crate::icons::{self, Ico};
use crate::studio::Studio;
use gpui::{div, prelude::*, px, AnyElement, Context, SharedString};
use rexa_ui::{tw, with_alpha, ActiveTokens};

pub struct RailItem {
    pub id: &'static str,
    pub label: String,
    pub icon: Ico,
}

/// shouldShowAuth / shouldShowStorage / shouldShowPayments / shouldShowEdgeFunctions:
/// Supabase projects (supabase-mgmt, db.<ref>.supabase.co) and Neon / auth-schema hosts.
pub fn is_supabase(connection_type: &str, connection_string: &str) -> bool {
    connection_type == "supabase-mgmt" || connection_type == "supabase" || connection_string.contains(".supabase.co") || connection_string.contains("supabase.com")
}

impl Studio {
    pub fn rail_items(&self) -> Vec<RailItem> {
        let (ctype, cs) = self.connection.as_ref().map(|c| (c.kind.as_str(), c.connection_string.as_str())).unwrap_or(("", ""));
        let supabase = is_supabase(ctype, cs);
        let show_auth = supabase || ctype == "neon" || self.schemas.iter().any(|s| s == "auth" || s == "neon_auth");
        let show_storage = supabase || self.schemas.iter().any(|s| s == "storage");
        let table_label = match self.db_type {
            "mongodb" => "Collection",
            "redis" => "Key",
            _ => "Table",
        };
        let editor = match self.db_type {
            "mongodb" => "Query Editor",
            "redis" => "Command Editor",
            _ => "SQL Editor",
        };
        let (tables_label, tables_icon) = if self.settings.database_explorer {
            ("Database Explorer".to_string(), icons::S_DATABASE)
        } else if self.settings.schema_explorer {
            ("Schema Explorer".to_string(), icons::S_LAYERS)
        } else {
            (format!("{table_label} Explorer"), icons::S_TABLE_EDITOR)
        };
        let mut items = vec![
            RailItem { id: "dashboard", label: "Dashboard".into(), icon: icons::S_WIDGET },
            RailItem { id: "notes", label: "Notes".into(), icon: icons::S_FILE },
            RailItem { id: "tables", label: tables_label, icon: tables_icon },
            RailItem { id: "sql", label: editor.into(), icon: icons::S_CODE_SQUARE },
            RailItem { id: "database", label: "Database".into(), icon: icons::S_DATABASE },
        ];
        if show_auth {
            items.push(RailItem { id: "auth", label: "Authentication".into(), icon: icons::S_AUTH });
        }
        items.push(RailItem { id: "workflows", label: "Workflows".into(), icon: icons::S_WORKFLOW });
        items.push(RailItem { id: "erd", label: "ERD Designer".into(), icon: icons::lucide("git-fork") });
        items.push(RailItem { id: "extensions", label: "Extensions".into(), icon: icons::lucide("puzzle") });
        if supabase {
            items.push(RailItem { id: "payments", label: "Payments".into(), icon: icons::S_WALLET });
        }
        if show_storage {
            items.push(RailItem { id: "storage", label: "Storage".into(), icon: icons::lucide("hard-drive") });
        }
        if supabase {
            items.push(RailItem { id: "edge-functions", label: "Edge Functions".into(), icon: icons::lucide("square-function") });
        }
        // modern-ui-rail-order: saved order first, new items at the end.
        if !self.rail_order.is_empty() {
            let mut sorted: Vec<RailItem> = Vec::new();
            for id in &self.rail_order {
                if let Some(pos) = items.iter().position(|i| i.id == id) {
                    sorted.push(items.remove(pos));
                }
            }
            sorted.extend(items);
            return sorted;
        }
        items
    }

    fn rail_button(&self, key: SharedString, label: String, icon: Ico, active: bool, cx: &mut Context<Self>) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens().clone();
        let neutral300 = tw("neutral-300");
        let tooltip_label: SharedString = label.into();
        div()
            .id(key)
            .relative()
            .h_9()
            .w_full()
            .flex_shrink_0()
            .cursor_pointer()
            .tooltip(move |window, cx| rexa_ui::overlay::tooltip::Tooltip::new(tooltip_label.clone()).build(window, cx))
            .child(
                div()
                    .absolute()
                    .left_0()
                    .top_0()
                    .size_9()
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded(px(10.))
                    .border_1()
                    .map(|d| {
                        if active {
                            d.border_color(with_alpha(tw("neutral-500"), 0.2)).bg(with_alpha(tw("neutral-500"), 0.1)).text_color(neutral300)
                        } else {
                            d.border_color(gpui::transparent_black())
                                .text_color(t.muted_foreground)
                                .hover(move |s| s.border_color(with_alpha(t.border, 0.7)).bg(with_alpha(t.muted, 0.2)).text_color(t.foreground))
                        }
                    })
                    .child(icon.el(20., t.muted_foreground).text_color(if active { neutral300 } else { t.muted_foreground })),
            )
    }

    pub fn render_rail(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let current = if self.sidebar_visible { self.sidebar_view.clone() } else { None };
        let mut top = div().id("rail-items").flex().flex_col().gap(px(6.)).min_h_0().flex_1().overflow_y_scroll();
        for item in self.rail_items() {
            let id = item.id;
            let active = current.as_deref() == Some(id);
            top = top.child(
                self.rail_button(SharedString::from(format!("rail-{id}")), item.label, item.icon, active, cx)
                    .on_click(cx.listener(move |this, _, _, cx| this.select_view(id, cx))),
            );
        }
        let settings_active = self.settings_section.is_some();
        let bottom = div()
            .mt_auto()
            .flex()
            .flex_shrink_0()
            .flex_col()
            .gap(px(6.))
            .pt_2()
            .child(self.rail_button("rail-home".into(), "Home".into(), icons::S_HOUSE, false, cx).on_click(cx.listener(|this, _, _, cx| this.go_home(cx))))
            .child(
                self.rail_button("rail-workspace".into(), "Workspace".into(), icons::S_USERS, false, cx)
                    .on_click(cx.listener(|this, _, _, cx| this.open_simple("connect-studio", cx))),
            )
            .child(
                self.rail_button("rail-settings".into(), "Settings".into(), icons::S_SETTINGS, settings_active, cx)
                    .on_click(cx.listener(|this, _, window, cx| {
                        if this.settings_section.is_some() {
                            this.close_settings(cx)
                        } else {
                            this.open_settings(None, window, cx)
                        }
                    })),
            );
        div()
            .flex()
            .flex_col()
            .h_full()
            .w_12()
            .flex_shrink_0()
            .overflow_hidden()
            .bg(t.sidebar)
            .child(div().flex().flex_col().flex_1().min_h_0().pt_10().pb(px(6.)).pl_2().pr_1().overflow_hidden().child(top).child(bottom))
            .into_any_element()
    }
}
