//! Port of components/studio/snippet-browser.tsx, snippet-common.tsx
//! (`CreateSnippetDialog`, `useSnippetActions`), lib/studio/snippet-actions-utils.ts,
//! rename-dialog.tsx and sidebar-common.tsx's `CreateFolderDialog`, over the
//! `snippets` / `folders` tables (use-studio.ts `addSnippet`, `updateSnippet`,
//! `deleteSnippet`, `addFolder`, `updateFolder`, `deleteFolder`).

use crate::store::{now_millis, uid, Folder, Snippet, SqlStore};
use gpui::{div, prelude::*, px, App, Context, Entity, EventEmitter, SharedString, Subscription, WeakEntity, Window};
use gpui_component::Icon;
use rexa_core::TabSpec;
use rexa_ui::widgets::InputState;
use rexa_ui::{
    confirm, tw, with_alpha, ActiveTokens, Align, Button, ButtonSize, ConfirmOptions, Dialog, DropdownMenu, IconName, MenuItem,
    Select, SelectOption, TextInput, Tooltip, Tw,
};
use std::collections::HashSet;
use std::rc::Rc;

pub enum SnippetBrowserEvent {
    /// `onSelectSnippet(snippet)`
    Select(Snippet),
}

pub struct SnippetBrowser {
    connection_id: i64,
    pub snippets: Vec<Snippet>,
    pub folders: Vec<Folder>,
    search: Entity<InputState>,
    expanded: HashSet<String>,
    /// `currentQuery` for "Save Current Query".
    pub current_query: String,
    _subs: Vec<Subscription>,
}

impl EventEmitter<SnippetBrowserEvent> for SnippetBrowser {}

impl SnippetBrowser {
    pub fn new(connection_id: i64, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Find snippets..."));
        let subs = vec![cx.observe(&search, |_, _, cx| cx.notify())];
        let mut this =
            SnippetBrowser { connection_id, snippets: Vec::new(), folders: Vec::new(), search, expanded: HashSet::new(), current_query: String::new(), _subs: subs };
        this.reload();
        this
    }

    pub fn reload(&mut self) {
        if let Ok(s) = SqlStore::open() {
            self.snippets = s.snippets(self.connection_id).unwrap_or_default();
            self.folders = s.folders(self.connection_id).unwrap_or_default();
        }
    }

    fn save_snippets(&mut self) {
        if let Ok(mut s) = SqlStore::open() {
            s.save_snippets(self.connection_id, &self.snippets).ok();
        }
    }

    fn save_folders(&mut self) {
        if let Ok(mut s) = SqlStore::open() {
            s.save_folders(self.connection_id, &self.folders).ok();
        }
    }

    /// `addSnippet`: persist and open in a new SQL tab.
    pub fn add_snippet(&mut self, name: String, query: String, folder_id: Option<String>, cx: &mut Context<Self>) {
        self.reload();
        let s = Snippet { id: uid(), name: name.clone(), query: query.clone(), folder_id: folder_id.clone(), created_at: now_millis(), is_shared: false, shared_entry_id: None };
        self.snippets.push(s.clone());
        self.save_snippets();
        if let Some(f) = folder_id {
            self.expanded.insert(f);
        }
        rexa_core::open_tab(TabSpec::Query { id: format!("sql-{}", s.id), title: name, sql: query }, cx);
        cx.notify();
    }

    fn rename(&mut self, folder: bool, id: &str, name: String, cx: &mut Context<Self>) {
        self.reload();
        if folder {
            if let Some(f) = self.folders.iter_mut().find(|f| f.id == id) {
                f.name = name;
            }
            self.save_folders();
        } else {
            if let Some(s) = self.snippets.iter_mut().find(|s| s.id == id) {
                s.name = name.clone();
            }
            self.save_snippets();
            rexa_core::emit_studio(
                rexa_core::StudioEvent::RenameTab { tab: TabSpec::Query { id: format!("sql-{id}"), title: name.clone(), sql: String::new() }, title: name },
                cx,
            );
        }
        cx.notify();
    }

    fn delete_snippet(&mut self, id: &str, cx: &mut Context<Self>) {
        self.reload();
        self.snippets.retain(|s| s.id != id);
        self.save_snippets();
        rexa_core::emit_studio(rexa_core::StudioEvent::CloseTab(TabSpec::Query { id: format!("sql-{id}"), title: String::new(), sql: String::new() }), cx);
        cx.notify();
    }

    /// `deleteFolder`: children and snippets move to the parent.
    fn delete_folder(&mut self, id: &str, cx: &mut Context<Self>) {
        self.reload();
        let parent = self.folders.iter().find(|f| f.id == id).and_then(|f| f.parent_id.clone());
        self.folders.retain(|f| f.id != id);
        for f in self.folders.iter_mut().filter(|f| f.parent_id.as_deref() == Some(id)) {
            f.parent_id = parent.clone();
        }
        for s in self.snippets.iter_mut().filter(|s| s.folder_id.as_deref() == Some(id)) {
            s.folder_id = parent.clone();
        }
        self.save_folders();
        self.save_snippets();
        cx.notify();
    }

    fn add_folder(&mut self, name: String, cx: &mut Context<Self>) {
        self.reload();
        self.folders.push(Folder { id: uid(), name, parent_id: None, created_at: now_millis() });
        self.save_folders();
        cx.notify();
    }

    fn open_name_dialog(&self, kind: NameDialogKind, cx: &mut Context<Self>) {
        let weak = cx.entity().downgrade();
        let folders = self.folders.clone();
        rexa_ui::open_dialog(cx, {
            let content: Rc<std::cell::RefCell<Option<Entity<NameDialog>>>> = Rc::default();
            move |window, cx| {
                let c = content
                    .borrow_mut()
                    .get_or_insert_with(|| cx.new(|cx| NameDialog::new(kind.clone(), weak.clone(), folders.clone(), window, cx)))
                    .clone();
                let title = c.read(cx).kind.title();
                Dialog::new().title(title).child(c)
            }
        });
    }

    fn confirm_delete(&self, folder: bool, id: String, cx: &mut Context<Self>) {
        let (title, description) = if folder {
            let f = self.folders.iter().find(|f| f.id == id);
            let count = self.snippets.iter().filter(|s| s.folder_id.as_deref() == Some(id.as_str())).count();
            (
                "Delete folder".to_string(),
                match f {
                    Some(f) => format!(
                        "Delete \"{}\"{}? The snippets themselves will be kept.",
                        f.name,
                        if count > 0 { format!(" and remove its {count} snippet{} from the folder", if count == 1 { "" } else { "s" }) } else { String::new() }
                    ),
                    None => "Delete this folder? Its snippets will be kept.".into(),
                },
            )
        } else {
            let name = self.snippets.iter().find(|s| s.id == id).map(|s| s.name.clone()).unwrap_or_default();
            ("Delete snippet".to_string(), format!("Delete \"{name}\"? This cannot be undone."))
        };
        let fut = confirm(ConfirmOptions::destructive(title).description(description).confirm_text("Delete"), cx);
        cx.spawn(async move |this, cx| {
            if fut.await {
                this.update(cx, |this, cx| if folder { this.delete_folder(&id, cx) } else { this.delete_snippet(&id, cx) }).ok();
            }
        })
        .detach();
    }

    fn row(&self, id: SharedString, cx: &App) -> gpui::Stateful<gpui::Div> {
        let t = cx.tokens();
        div()
            .id(id.clone())
            .group(id)
            .flex()
            .items_center()
            .gap_2()
            .px_2()
            .py_1()
            .tw_text_xs()
            .tw_rounded_lg()
            .cursor_pointer()
            .hover(|s| s.bg(with_alpha(t.accent, 0.5)))
    }

    fn row_menu(&self, folder: bool, id: String, name: String, cx: &mut Context<Self>) -> impl IntoElement {
        let weak = cx.entity().downgrade();
        let t = cx.tokens().clone();
        DropdownMenu::new(SharedString::from(format!("snip-menu-{}-{id}", folder as u8)))
            .align(Align::End)
            .trigger(div().p(px(2.)).rounded(px(4.)).hover(|s| s.bg(t.accent)).child(Icon::new(IconName::EllipsisVertical).size(px(12.))))
            .menu(move |m, _, _| {
                let (w1, w2, i1, i2, n1) = (weak.clone(), weak.clone(), id.clone(), id.clone(), name.clone());
                m.w(if folder { 112. } else { 144. })
                    .item(MenuItem::new("Rename").text_xs().on_select(move |_, cx| {
                        let kind = NameDialogKind::Rename { folder, id: i1.clone(), name: n1.clone() };
                        w1.update(cx, |this, cx| this.open_name_dialog(kind, cx)).ok();
                    }))
                    .item(MenuItem::new("Delete").text_xs().destructive().on_select(move |_, cx| {
                        w2.update(cx, |this, cx| this.confirm_delete(folder, i2.clone(), cx)).ok();
                    }))
            })
    }

    fn render_snippet(&self, s: &Snippet, depth: usize, cx: &mut Context<Self>) -> impl IntoElement {
        let group: SharedString = format!("snip-{}", s.id).into();
        let snippet = s.clone();
        self.row(group.clone(), cx)
            .when(depth > 0, |d| d.ml_3())
            .on_click(cx.listener(move |_, _, _, cx| cx.emit(SnippetBrowserEvent::Select(snippet.clone()))))
            .child(Icon::new(IconName::FileCode).size(px(14.)).text_color(tw("blue-500")))
            .child(div().flex_1().min_w_0().overflow_hidden().whitespace_nowrap().text_ellipsis().child(s.name.clone()))
            .when(s.is_shared, |d| d.child(Icon::new(IconName::Cloud).size(px(12.)).text_color(with_alpha(tw("sky-400"), 0.8))))
            .child(div().invisible().group_hover(group, |st| st.visible()).child(self.row_menu(false, s.id.clone(), s.name.clone(), cx)))
    }
}

impl Render for SnippetBrowser {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let search = self.search.read(cx).value().to_lowercase();
        let filtered: Vec<Snippet> = self.snippets.iter().filter(|s| s.name.to_lowercase().contains(&search)).cloned().collect();
        let mut list = div().id("snippet-list").flex_1().overflow_y_scroll().px(px(6.)).py_2().flex().flex_col().gap(px(2.));
        for f in self.folders.clone() {
            let expanded = self.expanded.contains(&f.id);
            let group: SharedString = format!("folder-{}", f.id).into();
            let (fid, fid2) = (f.id.clone(), f.id.clone());
            list = list.child(
                self.row(group.clone(), cx)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if !this.expanded.remove(&fid) {
                            this.expanded.insert(fid.clone());
                        }
                        cx.notify();
                    }))
                    .child(Icon::new(if expanded { IconName::FolderOpen } else { IconName::Folder }).size(px(14.)).text_color(tw("yellow-500")))
                    .child(div().flex_1().min_w_0().overflow_hidden().whitespace_nowrap().text_ellipsis().child(f.name.clone()))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .invisible()
                            .group_hover(group, |s| s.visible())
                            .child(
                                div()
                                    .id(SharedString::from(format!("folder-add-{}", f.id)))
                                    .p(px(2.))
                                    .rounded(px(4.))
                                    .hover(|s| s.bg(t.accent))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        cx.stop_propagation();
                                        this.open_name_dialog(NameDialogKind::CreateSnippet { folder: Some(fid2.clone()) }, cx);
                                    }))
                                    .child(Icon::new(IconName::Plus).size(px(12.))),
                            )
                            .child(self.row_menu(true, f.id.clone(), f.name.clone(), cx)),
                    ),
            );
            if expanded {
                let children: Vec<Snippet> = filtered.iter().filter(|s| s.folder_id.as_deref() == Some(f.id.as_str())).cloned().collect();
                list = list.child(div().mt(px(2.)).flex().flex_col().gap(px(2.)).children(children.iter().map(|s| self.render_snippet(s, 1, cx))));
            }
        }
        let root: Vec<Snippet> = filtered.iter().filter(|s| s.folder_id.is_none()).cloned().collect();
        list = list.children(root.iter().map(|s| self.render_snippet(s, 0, cx)));
        if filtered.is_empty() {
            list = list.child(
                div()
                    .mt_12()
                    .px_4()
                    .flex()
                    .flex_col()
                    .items_center()
                    .child(div().mb_2().opacity(0.1).child(Icon::new(IconName::FileCode).size(px(32.))))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(if search.is_empty() {
                        "No snippets yet. Save your queries for later use."
                    } else {
                        "No snippets match your search."
                    })),
            );
        }
        let icon_button = |id: &'static str, icon: IconName| {
            div()
                .id(id)
                .p_1()
                .tw_rounded_lg()
                .text_color(t.muted_foreground)
                .hover(|s| s.bg(with_alpha(t.var("--secondary").unwrap_or(t.muted), 0.2)).text_color(t.foreground))
                .cursor_pointer()
                .child(Icon::new(icon).size(px(14.)))
        };
        div()
            .flex()
            .size_full()
            .flex_col()
            .overflow_hidden()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(with_alpha(t.border, 0.5))
                    .child(div().flex_1().child(TextInput::new(&self.search).h(28.).prefix(Icon::new(IconName::Search).size(px(12.)).text_color(with_alpha(t.muted_foreground, 0.4)))))
                    .child(Tooltip::new("New Folder").child(
                        icon_button("new-folder", IconName::FolderPlus).on_click(cx.listener(|this, _, _, cx| this.open_name_dialog(NameDialogKind::CreateFolder, cx))),
                    ))
                    .child(Tooltip::new("New Snippet").child(
                        icon_button("new-snippet", IconName::Plus)
                            .on_click(cx.listener(|this, _, _, cx| this.open_name_dialog(NameDialogKind::CreateSnippet { folder: None }, cx))),
                    )),
            )
            .child(list)
            .child(
                div().p_2().border_t_1().border_color(with_alpha(t.border, 0.5)).child(
                    Button::new("save-current").secondary().size(ButtonSize::Sm).w_full().icon(IconName::Save).label("Save Current Query").on_click(cx.listener(
                        |this, _, _, cx| {
                            if !this.current_query.trim().is_empty() {
                                let q = this.current_query.clone();
                                this.add_snippet("New Snippet".into(), q, None, cx);
                            }
                        },
                    )),
                ),
            )
    }
}

#[derive(Clone)]
enum NameDialogKind {
    CreateFolder,
    CreateSnippet { folder: Option<String> },
    Rename { folder: bool, id: String, name: String },
}

impl NameDialogKind {
    fn title(&self) -> &'static str {
        match self {
            NameDialogKind::CreateFolder => "Create Folder",
            NameDialogKind::CreateSnippet { .. } => "Create Snippet",
            NameDialogKind::Rename { folder: true, .. } => "Rename Folder",
            NameDialogKind::Rename { .. } => "Rename Snippet",
        }
    }
}

/// `CreateFolderDialog` / `CreateSnippetDialog` / `RenameDialog` bodies.
struct NameDialog {
    kind: NameDialogKind,
    browser: WeakEntity<SnippetBrowser>,
    folders: Vec<Folder>,
    folder: Option<String>,
    input: Entity<InputState>,
}

impl NameDialog {
    fn new(kind: NameDialogKind, browser: WeakEntity<SnippetBrowser>, folders: Vec<Folder>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (placeholder, value, folder) = match &kind {
            NameDialogKind::CreateFolder => ("Folder name", String::new(), None),
            NameDialogKind::CreateSnippet { folder } => ("Snippet name", String::new(), folder.clone()),
            NameDialogKind::Rename { name, .. } => ("Name", name.clone(), None),
        };
        let input = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder).default_value(value));
        input.update(cx, |s, cx| s.focus(window, cx));
        NameDialog { kind, browser, folders, folder, input }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let name = self.input.read(cx).value().trim().to_string();
        if name.is_empty() {
            return;
        }
        let kind = self.kind.clone();
        let folder = self.folder.clone();
        self.browser
            .update(cx, |b, cx| match kind {
                NameDialogKind::CreateFolder => b.add_folder(name, cx),
                // `handleAddSnippetAction`: the new snippet starts as a comment with its name.
                NameDialogKind::CreateSnippet { .. } => b.add_snippet(name.clone(), format!("-- {name}\n"), folder, cx),
                NameDialogKind::Rename { folder, id, .. } => b.rename(folder, &id, name, cx),
            })
            .ok();
        rexa_ui::close_top(cx);
    }
}

impl Render for NameDialog {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let confirm_label = match self.kind {
            NameDialogKind::Rename { .. } => "Save",
            _ => "Create",
        };
        let show_folder = matches!(self.kind, NameDialogKind::CreateSnippet { .. });
        let mut options = vec![SelectOption::new("__root__", "Root (no folder)")];
        options.extend(self.folders.iter().map(|f| SelectOption::new(f.id.clone(), f.name.clone())));
        let weak = cx.entity().downgrade();
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .py_2()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(
                        div()
                            .on_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, _, cx| {
                                if ev.keystroke.key == "enter" {
                                    this.submit(cx);
                                }
                            }))
                            .child(TextInput::new(&self.input)),
                    )
                    .when(show_folder, |d| {
                        d.child(
                            Select::new("snippet-folder-select")
                                .w_full()
                                .options(options)
                                .value(Some(self.folder.clone().unwrap_or_else(|| "__root__".into())))
                                .on_change(move |v, _, cx| {
                                    weak.update(cx, |this, cx| {
                                        this.folder = (v != "__root__").then(|| v.to_string());
                                        cx.notify();
                                    })
                                    .ok();
                                }),
                        )
                    }),
            )
            .child(
                div()
                    .flex()
                    .justify_end()
                    .gap_2()
                    .child(Button::new("name-cancel").secondary().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                    .child(Button::new("name-ok").label(confirm_label).on_click(cx.listener(|this, _, _, cx| this.submit(cx)))),
            )
    }
}
