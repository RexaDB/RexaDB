//! `screen:ui-gallery` — every rexa-ui primitive in its states, for visual
//! checking (`tools/run-native.sh out.png screen:ui-gallery`).
//! `REXA_GALLERY=<section>` shows one section only; `REXA_GALLERY_OPEN=
//! dialog|alert|confirm|sheet|toasts` opens that overlay at startup.

use crate::menu::{self, Menu, MenuItem, MenuStyle};
use crate::{
    ActiveTokens, AlertDialog, Button, ButtonSize, ConfirmOptions, Dialog, DropdownMenu, IconName,
    avatar_group, skeleton, square_check, Alert, Avatar, AvatarSize, Card, Checkbox, Combobox, FallbackAvatar,
    tabs_content, Accordion, Collapsible, MultiSelect, Progress, ScrollArea, Select, Tabs, SelectOption, Spinner, Table, InputGroup, Label, PasswordInput, Popover, Sheet, Side, Switch, TextArea, Toast,
    Tooltip, Tw,
};
use gpui::{div, prelude::*, px, AnyElement, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use gpui_component::input::{InputState, TextareaState};

pub struct Gallery {
    only: Option<String>,
    switch_on: bool,
    check_on: bool,
    input: Entity<InputState>,
    password: Entity<InputState>,
    search: Entity<InputState>,
    textarea: Entity<TextareaState>,
    sel1: Option<SharedString>,
    sel2: Option<SharedString>,
    combo: Option<SharedString>,
    multi: Vec<SharedString>,
    tab: usize,
    date: Option<crate::Date>,
    sidebar_collapsed: bool,
}

type Section = fn(&mut Gallery, &mut Window, &mut Context<Gallery>) -> AnyElement;

impl Gallery {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        if let Ok(what) = std::env::var("REXA_GALLERY_OPEN") {
            cx.defer(move |cx| open_demo(&what, cx));
        }
        Self {
            only: std::env::var("REXA_GALLERY").ok(),
            switch_on: true,
            check_on: true,
            input: cx.new(|cx| InputState::new(window, cx).placeholder("postgres://localhost:5432/db")),
            password: cx.new(|cx| InputState::new(window, cx).masked(true).default_value("hunter2")),
            search: cx.new(|cx| InputState::new(window, cx).placeholder("Search tables…")),
            textarea: cx.new(|cx| TextareaState::new(window, cx).placeholder("Notes…")),
            sel1: Some("postgresql".into()),
            sel2: Some("sqlite".into()),
            combo: None,
            multi: vec!["users".into()],
            tab: 0,
            date: Some(crate::Date::new(2026, 11, 13)),
            sidebar_collapsed: false,
        }
    }

    fn sections() -> Vec<(&'static str, Section)> {
        vec![("menus", menus), ("overlays", overlays), ("popovers", popovers), ("controls", controls), ("selects", selects), ("display", display), ("layout", layout), ("pickers", pickers), ("sidebar", sidebar)]
    }
}

fn db_options() -> Vec<SelectOption> {
    ["PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "ClickHouse", "DuckDB", "Microsoft SQL Server"]
        .into_iter()
        .map(|n| SelectOption::new(n.to_lowercase(), n))
        .collect()
}

fn selects(g: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let this = cx.entity();
    let set = move |field: fn(&mut Gallery) -> &mut Option<SharedString>| {
        let this = this.clone();
        move |v: SharedString, _: &mut Window, cx: &mut App| {
            this.update(cx, |g, cx| {
                *field(g) = Some(v);
                cx.notify();
            })
        }
    };
    let open = std::env::var("REXA_GALLERY_OPEN").ok();
    let multi_this = cx.entity();
    row()
        .h(px(420.))
        .child(
            Select::new("sel1")
                .w(px(180.))
                .placeholder("Select a database")
                .options(db_options())
                .value(g.sel1.clone())
                .on_change(set(|g| &mut g.sel1))
                .when(open.as_deref() == Some("select"), |s| s.open_on_mount()),
        )
        .child(
            Select::with_search("sel2")
                .w(px(180.))
                .small()
                .placeholder("Item-aligned")
                .options(db_options().into_iter().take(4))
                .value(g.sel2.clone())
                .on_change(set(|g| &mut g.sel2))
                .when(open.as_deref() == Some("select-aligned"), |s| s.open_on_mount()),
        )
        .child(
            div().w(px(220.)).child(
                Combobox::searchable("cb")
                    .placeholder("Select provider")
                    .options(db_options())
                    .value(g.combo.clone())
                    .on_change(set(|g| &mut g.combo))
                    .when(open.as_deref() == Some("combobox"), |s| s.open_on_mount()),
            ),
        )
        .child(
            div().w(px(240.)).child(
                MultiSelect::new("ms")
                    .options(["users", "orders", "products", "invoices"].map(SelectOption::simple))
                    .selected(g.multi.iter().cloned())
                    .on_change(move |next, _, cx| multi_this.update(cx, |g, cx| {
                        g.multi = next.into_iter().collect();
                        cx.notify();
                    })),
            ),
        )
        .into_any_element()
}

fn display(_: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let t = cx.tokens().clone();
    row()
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .w(px(240.))
                .child(skeleton("sk1", |d| d.h_4().w(px(200.)), cx))
                .child(skeleton("sk2", |d| d.h_4().w(px(150.)), cx))
                .child(Progress::new(62.))
                .child(div().flex().gap_2().items_center().child(Spinner::new(16.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Loading…")))
                .child(
                    div()
                        .flex()
                        .gap_3()
                        .items_center()
                        .child(Avatar::new().size(AvatarSize::Sm).fallback("JD"))
                        .child(Avatar::new().fallback("AB"))
                        .child(Avatar::new().size(AvatarSize::Lg).fallback_el(FallbackAvatar::new("flaxo", 40.)))
                        .child(FallbackAvatar::new("RexaDB", 32.))
                        .child(FallbackAvatar::new("postgres", 32.))
                        .child(avatar_group([Avatar::new().fallback("A"), Avatar::new().fallback("B")], Some("+3".into()), cx)),
                ),
        )
        .child(
            div().w(px(320.)).child(
                Card::new()
                    .title("Connection")
                    .description("Last used 2 hours ago")
                    .action(Button::new("card-act").ghost().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
                    .child(div().text_color(t.muted_foreground).child("postgres://localhost:5432/app"))
                    .footer(Button::new("card-open").size(ButtonSize::Sm).label("Open")),
            ),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .w(px(360.))
                .child(Alert::new().title("Heads up!").description("You can add components to your app using the CLI."))
                .child(Alert::new().destructive().title("Error").description("Your session has expired. Please log in again.")),
        )
        .child(
            div().w(px(360.)).child(
                Table::new("tbl")
                    .columns([Some(80.), None, Some(80.)])
                    .header(["Invoice", "Status", "Amount"].map(|s| s.into_any_element()))
                    .row(["INV001", "Paid", "$250.00"].map(|s| s.into_any_element()))
                    .selected_row(["INV002", "Pending", "$150.00"].map(|s| s.into_any_element()))
                    .row(["INV003", "Unpaid", "$350.00"].map(|s| s.into_any_element()))
                    .caption("A list of your recent invoices."),
            ),
        )
        .into_any_element()
}

fn layout(g: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let t = cx.tokens().clone();
    let this = cx.entity();
    let list = |n: usize| (0..n).map(|i| div().px_3().py_1().tw_text_sm().child(format!("public.table_{i:02}"))).collect::<Vec<_>>();
    row()
        .child(
            div()
                .w(px(320.))
                .child(Tabs::new("tabs").w_full().tab("Account").tab("Password").disabled_tab("Billing").selected(g.tab).on_change(
                    move |i, _, cx| this.update(cx, |g, cx| {
                        g.tab = i;
                        cx.notify();
                    }),
                ))
                .child(tabs_content(div().tw_text_sm().text_color(t.muted_foreground).child(format!("Tab {} content", g.tab)))),
        )
        .child(
            div().w(px(320.)).child(
                Accordion::new("acc")
                    .default_open([0])
                    .item("Is it accessible?", "Yes. It adheres to the WAI-ARIA design pattern.")
                    .item("Is it styled?", "Yes. It comes with default styles.")
                    .item("Is it animated?", "Yes. It's animated by default."),
            ),
        )
        .child(
            div().w(px(200.)).child(
                Collapsible::new("col")
                    .default_open(true)
                    .trigger(|open| {
                        div().flex().items_center().gap_2().tw_text_sm().child(
                            gpui_component::Icon::new(if open { IconName::ChevronDown } else { IconName::ChevronRight }).size_4(),
                        ).child("Tables")
                    })
                    .content(div().pl_6().flex().flex_col().children(list(3))),
            ),
        )
        .child(
            ScrollArea::radix("sa-radix").w(px(200.)).h(px(180.)).border_1().border_color(t.border).tw_rounded_lg().children(list(30)),
        )
        .child(
            ScrollArea::native("sa-native").w(px(200.)).h(px(180.)).border_1().border_color(t.border).tw_rounded_lg().children(list(30)),
        )
        .into_any_element()
}

fn pickers(g: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let t = cx.tokens().clone();
    let this = cx.entity();
    row()
        .child(
            div().border_1().border_color(t.border).tw_rounded_lg().child(
                crate::Calendar::new("cal")
                    .selected(g.date)
                    .default_month(crate::Date::new(2026, 11, 1))
                    .on_select(move |d, _, cx| this.update(cx, |g, cx| {
                        g.date = Some(d);
                        cx.notify();
                    })),
            ),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .w(px(520.))
                .child(crate::CommandSearchBar::new("csb").on_click(|_, cx| open_demo("command", cx)))
                .child(crate::CommandSearchBar::new("csb2").sleek(true))
                .child(
                    div().h(px(260.)).border_1().border_color(t.border).tw_rounded_lg().overflow_hidden().child(
                        crate::Command::new("inline-cmd")
                            .autofocus(false)
                            .placeholder("Search tables…")
                            .group(crate::CommandGroup::new("Tables").items(
                                ["users", "orders", "order_items", "products"].map(|n| crate::CommandItem::new(n).icon(IconName::Table)),
                            )),
                    ),
                ),
        )
        .into_any_element()
}

fn sidebar(g: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    use crate::sidebar::*;
    let collapsed = g.sidebar_collapsed;
    let this = cx.entity();
    let open = std::env::var("REXA_GALLERY_OPEN").ok();
    let tables = ["users", "orders", "products"];
    row()
        .child(
            div().h(px(420.)).flex().relative().child(
                crate::Sidebar::new()
                    .collapsed(collapsed)
                    .width(240.)
                    .child(sidebar_header().child(
                        SidebarMenuButton::new("sb-ws").size(SidebarButtonSize::Lg).collapsed(collapsed).icon(IconName::Database).label("rexadb_dev"),
                    ))
                    .child(
                        sidebar_content("sb-content")
                            .child(
                                sidebar_group()
                                    .child(sidebar_group_label("Tables", collapsed, cx))
                                    .child(sidebar_group_action("sb-add", IconName::Plus, cx))
                                    .child(sidebar_menu().children(tables.iter().enumerate().map(|(i, n)| {
                                        SidebarMenuButton::new(("sb-t", i))
                                            .collapsed(collapsed)
                                            .icon(IconName::Table)
                                            .label(*n)
                                            .active(i == 0)
                                            .badge(format!("{}", (i + 1) * 12))
                                    }))),
                            )
                            .child(sidebar_separator(cx))
                            .child(
                                sidebar_group().child(sidebar_group_label("Views", collapsed, cx)).child(
                                    sidebar_menu()
                                        .child(SidebarMenuButton::new("sb-v").collapsed(collapsed).icon(IconName::Eye).label("active_users"))
                                        .child(sidebar_menu_sub(cx).child(sidebar_menu_sub_button("sb-sub1", "by_region", true, false, cx)).child(sidebar_menu_sub_button("sb-sub2", "by_plan", false, false, cx)))
                                        .child(sidebar_menu_skeleton("sb-sk", true, 70., cx)),
                                ),
                            ),
                    )
                    .child(sidebar_footer().child(SidebarMenuButton::new("sb-set").size(SidebarButtonSize::Sm).collapsed(collapsed).icon(IconName::Settings).label("Settings"))),
            ),
        )
        .child(sidebar_trigger("sb-trigger", move |_, cx| this.update(cx, |g, cx| {
            g.sidebar_collapsed = !g.sidebar_collapsed;
            cx.notify();
        })))
        .child(
            div().w(px(420.)).flex().justify_end().child(
                crate::UserAvatarDropdown::new("uad", "flaxo")
                    .user(Some("flaxodotdev@gmail.com"))
                    .plan("pro")
                    .when(open.as_deref() == Some("user-menu"), |u| u.open_on_mount()),
            ),
        )
        .into_any_element()
}

fn controls(g: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let this = cx.entity();
    let (sw, ck) = (g.switch_on, g.check_on);
    let col = || div().flex().flex_col().gap_3().w(px(280.));
    row()
        .child(
            col()
                .child(Label::new("Auto-refresh").child({
                    let this = this.clone();
                    Switch::new("sw1").checked(sw).on_change(move |v, _, cx| this.update(cx, |g, cx| {
                        g.switch_on = v;
                        cx.notify();
                    }))
                }))
                .child(Label::new("Off").child(Switch::new("sw2")))
                .child(Label::new("Disabled").disabled(true).child(Switch::new("sw3").checked(true).disabled(true)))
                .child(Label::new("Remember me").child({
                    let this = this.clone();
                    Checkbox::new("cb1").checked(ck).on_change(move |v, _, cx| this.update(cx, |g, cx| {
                        g.check_on = v;
                        cx.notify();
                    }))
                }))
                .child(Label::new("Unchecked").child(Checkbox::new("cb2")))
                .child(div().flex().gap_2().child(square_check(true, cx)).child(square_check(false, cx))),
        )
        .child(
            col()
                .child(crate::TextInput::new(&g.input))
                .child(PasswordInput::new("pw", &g.password))
                .child(InputGroup::new(&g.search).start(gpui_component::Icon::new(IconName::Search).size_4()).end(crate::Kbd::new("⌘K")))
                .child(TextArea::new(&g.textarea)),
        )
        .into_any_element()
}

fn popovers(_: &mut Gallery, _: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let t = cx.tokens().clone();
    let icon_btn = |id: &'static str, icon: IconName| Button::new(id).ghost().size(ButtonSize::IconSm).icon(icon);
    row()
        .pt_10()
        .pb_10()
        .gap_16()
        .child(Tooltip::new("Refresh schema").force_open().child(icon_btn("tt1", IconName::RefreshCw)))
        .child(Tooltip::new("Run query").kbd("⌘↵").force_open().child(icon_btn("tt2", IconName::Play)))
        .child(Tooltip::studio("New SQL query").force_open().child(icon_btn("tt3", IconName::Plus)))
        .child(Tooltip::new("Hover me").child(Button::new("tt4").outline().size(ButtonSize::Sm).label("Live tooltip")))
        .child(
            Popover::new("pop-demo")
                .trigger(Button::new("pop-t").outline().size(ButtonSize::Sm).label("Open popover"))
                .content(move |_, _, _| {
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Dimensions"))
                        .child(div().tw_text_sm().text_color(t.muted_foreground).child("Set the dimensions for the layer."))
                }),
        )
        .into_any_element()
}

pub fn open_demo(what: &str, cx: &mut App) {
    match what {
        "dialog" => {
            crate::open_dialog(cx, |_, _| {
                Dialog::new()
                    .title("Rename connection")
                    .description("Give this connection a name you'll recognise.")
                    .child(div().h_8())
                    .footer(Button::new("d-cancel").outline().label("Cancel").on_click(|_, _, cx| crate::close_top(cx)))
                    .footer(Button::new("d-save").label("Save"))
            });
        }
        "alert" => {
            crate::open_alert_dialog(cx, |_, _| {
                AlertDialog::new()
                    .title("Discard changes?")
                    .description("You have unsaved edits in 3 rows.")
                    .footer(Button::new("a-cancel").outline().label("Cancel").on_click(|_, _, cx| crate::close_top(cx)))
                    .footer(Button::new("a-ok").destructive().label("Discard"))
            });
        }
        "confirm" => {
            let fut = crate::confirm(ConfirmOptions::destructive("Delete table \"users\"?").confirm_text("Delete"), cx);
            cx.spawn(async move |_| {
                let ok = fut.await;
                eprintln!("confirm -> {ok}");
            })
            .detach();
        }
        "sheet" => {
            crate::open_sheet(cx, Side::Right, |_, cx| {
                let t = cx.tokens().clone();
                Sheet::new()
                    .title("Edit row")
                    .description("public.users · id = 42")
                    .child(div().px_4().text_color(t.muted_foreground).child("Sheet body"))
                    .footer(Button::new("s-save").label("Save changes"))
            });
        }
        "command" => {
            crate::open_command_dialog(cx, "palette", |_, _| {
                vec![
                    crate::CommandGroup::new("Suggestions")
                        .item(crate::CommandItem::new("New SQL query").icon(IconName::Plus).shortcut("⌘N"))
                        .item(crate::CommandItem::new("Open table").icon(IconName::Table).shortcut("⌘O"))
                        .item(crate::CommandItem::new("Toggle sidebar").icon(IconName::PanelLeft).shortcut("⌘B")),
                    crate::CommandGroup::new("Settings")
                        .separator_before()
                        .item(crate::CommandItem::new("Profile").icon(IconName::User).shortcut("⌘P"))
                        .item(crate::CommandItem::new("Settings").icon(IconName::Settings).shortcut("⌘,")),
                ]
            });
        }
        "toasts" => {
            Toast::message("Copied to clipboard").show(cx);
            Toast::info("3 rows selected").show(cx);
            Toast::error("Query failed").description("relation \"userz\" does not exist").show(cx);
            Toast::success("Saved").action("Undo", |_, _| {}).show(cx);
        }
        _ => {}
    }
}

fn heading(text: &'static str, cx: &App) -> impl IntoElement {
    div()
        .tw_text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(cx.tokens().muted_foreground)
        .child(SharedString::from(text.to_uppercase()))
}

fn row() -> gpui::Div {
    div().flex().flex_wrap().items_start().gap_6()
}

fn sample_menu(m: Menu, _: &mut Window, _: &mut App) -> Menu {
    m.label("My Account")
        .item(MenuItem::new("Profile").icon(IconName::User).shortcut("⇧⌘P"))
        .item(MenuItem::new("Settings").icon(IconName::Settings).shortcut("⌘,"))
        .item(MenuItem::new("Disabled").icon(IconName::Lock).disabled(true))
        .separator()
        .item(MenuItem::checkbox("Show grid lines", true))
        .item(MenuItem::checkbox("Wrap text", false))
        .separator()
        .item(MenuItem::radio("Compact", true))
        .item(MenuItem::radio("Comfortable", false))
        .separator()
        .sub_item(MenuItem::new("Export").icon(IconName::Download), |m, _, _| {
            m.item(MenuItem::new("CSV")).item(MenuItem::new("JSON")).item(MenuItem::new("SQL inserts"))
        })
        .item(MenuItem::new("Log out").icon(IconName::LogOut).destructive().shortcut("⌘Q"))
}

fn context_menu(m: Menu, _: &mut Window, _: &mut App) -> Menu {
    m.item(MenuItem::new("Open").icon(IconName::ExternalLink))
        .item(MenuItem::new("Copy name").icon(IconName::Copy).shortcut("⌘C"))
        .sub("Generate SQL", |m, _, _| m.item(MenuItem::new("SELECT")).item(MenuItem::new("INSERT")))
        .separator()
        .label("View")
        .item(MenuItem::checkbox("Show columns", true))
        .item(MenuItem::radio("By name", true))
        .separator()
        .item(MenuItem::new("Drop table").icon(IconName::Trash).destructive())
}

fn menus(_: &mut Gallery, window: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    row()
        .child(menu::preview("pv-dropdown", MenuStyle::Dropdown, Some(1), sample_menu, window, cx))
        .child(menu::preview("pv-dropdown-destr", MenuStyle::Dropdown, Some(12), sample_menu, window, cx))
        .child(menu::preview("pv-context", MenuStyle::Context, Some(0), context_menu, window, cx))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    DropdownMenu::new("dd-live")
                        .trigger_with(|open| Button::new("dd-live-t").outline().label("Open menu").icon_end(IconName::ChevronDown).selected(open))
                        .menu(sample_menu),
                )
                .child(
                    crate::ContextMenu::new("ctx-live")
                        .menu(context_menu)
                        .child(
                            div()
                                .w(px(220.))
                                .h(px(90.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .border_1()
                                .border_dashed()
                                .border_color(cx.tokens().border)
                                .tw_rounded_lg()
                                .tw_text_sm()
                                .text_color(cx.tokens().muted_foreground)
                                .child("Right-click here"),
                        ),
                ),
        )
        .into_any_element()
}

fn overlays(_: &mut Gallery, _: &mut Window, _: &mut Context<Gallery>) -> AnyElement {
    let btn = |id: &'static str, label: &'static str, what: &'static str| {
        Button::new(id).outline().size(ButtonSize::Sm).label(label).on_click(move |_, _, cx| open_demo(what, cx))
    };
    row()
        .child(btn("g-dialog", "Dialog", "dialog"))
        .child(btn("g-alert", "Alert dialog", "alert"))
        .child(btn("g-confirm", "Confirm", "confirm"))
        .child(btn("g-sheet", "Sheet", "sheet"))
        .child(btn("g-toasts", "Toasts", "toasts"))
        .child(Button::new("g-loading").outline().size(ButtonSize::Sm).label("Loading toast").on_click(|_, _, cx| {
            let id = Toast::loading("Exporting 1,204 rows…").show(cx);
            cx.spawn(async move |cx| {
                cx.background_executor().timer(std::time::Duration::from_secs(2)).await;
                cx.update(|cx| Toast::success("Export complete").id(id).show(cx));
            })
            .detach();
        }))
        .into_any_element()
}

impl Render for Gallery {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let mut body = div().flex().flex_col().gap_8().p_8().pt(px(44.));
        for (name, f) in Self::sections() {
            if self.only.as_deref().is_some_and(|o| o != name) {
                continue;
            }
            let content = f(self, window, cx);
            body = body.child(div().flex().flex_col().gap_3().child(heading(name, cx)).child(content));
        }
        div()
            .id("ui-gallery")
            .size_full()
            .bg(t.background)
            .text_color(t.foreground)
            .overflow_y_scroll()
            .child(body)
    }
}
