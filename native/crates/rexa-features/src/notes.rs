//! Native Markdown notes. This first port covers note creation, editing and
//! autosave; rich widgets and preview rendering remain follow-up work.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, Entity, Subscription, Task, Window};
use gpui_component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{Registry, Session, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

fn open_db() -> rusqlite::Result<Connection> {
    let db = Connection::open_with_flags(rexa_store::Store::database_path(), OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS note_state (connection_id INTEGER PRIMARY KEY, notes_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL DEFAULT 0);")?;
    Ok(db)
}

fn timestamp() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

fn load_note(connection_id: i64, note_id: &str) -> Option<Value> {
    let db = open_db().ok()?;
    let raw: String = db.query_row("SELECT notes_json FROM note_state WHERE connection_id = ?1", [connection_id], |r| r.get(0)).optional().ok().flatten()?;
    serde_json::from_str::<Vec<Value>>(&raw).ok()?.into_iter().find(|n| n.get("id").and_then(Value::as_str) == Some(note_id))
}

fn save_note(connection_id: i64, note_id: &str, name: &str, content: &str) -> rusqlite::Result<()> {
    let db = open_db()?;
    let tx = db.unchecked_transaction()?;
    let raw: Option<String> = tx.query_row("SELECT notes_json FROM note_state WHERE connection_id = ?1", [connection_id], |r| r.get(0)).ok();
    let mut notes: Vec<Value> = raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let now = timestamp();
    if let Some(note) = notes.iter_mut().find(|n| n.get("id").and_then(Value::as_str) == Some(note_id)) {
        if let Some(object) = note.as_object_mut() {
            if !name.trim().is_empty() { object.insert("name".into(), Value::String(name.trim().to_string())); }
            object.insert("content".into(), Value::String(content.to_string()));
            object.insert("updatedAt".into(), Value::from(now));
        }
    } else {
        // Autosave and Drop may run after the sidebar deleted this note. Never
        // turn an update into an implicit resurrection.
        return tx.commit();
    }
    tx.execute(
        "INSERT INTO note_state(connection_id, notes_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(connection_id) DO UPDATE SET notes_json = excluded.notes_json, updated_at = excluded.updated_at",
        (connection_id, serde_json::to_string(&notes).unwrap_or_else(|_| "[]".into()), now),
    )?;
    tx.commit()
}

fn create_note(connection_id:i64,note_id:&str,name:&str,content:&str)->rusqlite::Result<()> {
    let db=open_db()?;let tx=db.unchecked_transaction()?;
    let raw:Option<String>=tx.query_row("SELECT notes_json FROM note_state WHERE connection_id=?1",[connection_id],|r|r.get(0)).optional()?;
    let mut notes:Vec<Value>=raw.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_default();
    let now=timestamp();
    if !notes.iter().any(|n|n.get("id").and_then(Value::as_str)==Some(note_id)){
        notes.push(json!({"id":note_id,"name":if name.trim().is_empty(){"Untitled note"}else{name.trim()},"content":content,"folderId":null,"createdAt":now,"updatedAt":now,"widgets":[]}));
    }
    tx.execute("INSERT INTO note_state(connection_id,notes_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(connection_id) DO UPDATE SET notes_json=excluded.notes_json,updated_at=excluded.updated_at",(connection_id,serde_json::to_string(&notes).unwrap_or_else(|_|"[]".into()),now))?;tx.commit()
}

pub struct NoteEditor {
    connection_id: i64,
    note_id: String,
    note_name: String,
    title: Entity<InputState>,
    text: Entity<TextareaState>,
    draft: String,
    save_error: Option<String>,
    saving: bool,
    preview: bool,
    save_task: Option<Task<()>>,
    _subs: Vec<Subscription>,
}

impl NoteEditor {
    fn new(params: &Value, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let tab_id = params.get("baseId").and_then(Value::as_str).or_else(|| params.get("id").and_then(Value::as_str)).unwrap_or("note");
        let tab_id = tab_id.split("::pane::").next().unwrap_or(tab_id);
        let note_id = tab_id.strip_prefix("note-").or_else(|| tab_id.strip_prefix("note_")).unwrap_or(tab_id).to_string();
        let fallback_name = params.get("name").and_then(Value::as_str).unwrap_or("Untitled note").to_string();
        let connection_id = session.connection.id;
        let existing = load_note(connection_id, &note_id);
        let note_name = existing.as_ref().and_then(|n| n.get("name")).and_then(Value::as_str).filter(|n| !n.trim().is_empty()).unwrap_or(&fallback_name).to_string();
        let draft = existing.as_ref().and_then(|n| n.get("content")).and_then(Value::as_str).unwrap_or_default().to_string();
        if existing.is_none() {
            if let Err(error) = create_note(connection_id, &note_id, &note_name, &draft) {
                eprintln!("Could not create note: {error}");
            } else {
                rexa_core::emit_studio(rexa_core::StudioEvent::NotesChanged { connection_id }, cx);
            }
        }
        let title = cx.new(|cx| InputState::new(window, cx).default_value(note_name.clone()).placeholder("Note title"));
        let text = cx.new(|cx| TextareaState::new(window, cx).auto_grow(10, 40).default_value(draft.clone()));
        let sub_text = cx.subscribe(&text, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                this.draft = this.text.read(cx).value().to_string();
                this.schedule_save(cx);
            }
        });
        let sub_title = cx.subscribe(&title, |this, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                let value = this.title.read(cx).value().to_string();
                if !value.trim().is_empty() { this.note_name = value.trim().to_string(); }
                this.schedule_save(cx);
            }
        });
        Self { connection_id, note_id, note_name, title, text, draft, save_error: None, saving: false, preview: false, save_task: None, _subs: vec![sub_text, sub_title] }
    }

    fn schedule_save(&mut self, cx: &mut Context<Self>) {
        self.save_task = None;
        self.save_error = None;
        self.saving = true;
        self.save_task = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(400)).await;
            this.update(cx, |this, cx| {
                match save_note(this.connection_id, &this.note_id, &this.note_name, &this.draft) {
                    Ok(()) => {
                        this.save_error = None;
                        rexa_core::emit_studio(rexa_core::StudioEvent::RenameTab {
                            tab: TabSpec::View { view: "note".into(), params: json!({ "id": format!("note-{}", this.note_id) }) },
                            title: this.note_name.clone(),
                        }, cx);
                        rexa_core::emit_studio(rexa_core::StudioEvent::NotesChanged { connection_id: this.connection_id }, cx);
                    }
                    Err(error) => this.save_error = Some(format!("Could not save note: {error}")),
                }
                this.saving = false;
                cx.notify();
            }).ok();
        }));
        cx.notify();
    }

    fn save_now(&mut self, cx: &mut Context<Self>) {
        self.save_task = None;
        self.draft = self.text.read(cx).value().to_string();
        let title = self.title.read(cx).value().to_string();
        if !title.trim().is_empty() { self.note_name = title.trim().to_string(); }
        self.saving = false;
        match save_note(self.connection_id, &self.note_id, &self.note_name, &self.draft) {
            Ok(()) => {
                self.save_error = None;
                rexa_core::emit_studio(rexa_core::StudioEvent::RenameTab {
                    tab: TabSpec::View { view: "note".into(), params: json!({ "id": format!("note-{}", self.note_id) }) },
                    title: self.note_name.clone(),
                }, cx);
                rexa_core::emit_studio(rexa_core::StudioEvent::NotesChanged { connection_id: self.connection_id }, cx);
            }
            Err(error) => self.save_error = Some(format!("Could not save note: {error}")),
        }
        cx.notify();
    }

    fn toggle_task(&mut self, marker: std::ops::Range<usize>, checked: bool, window: &mut Window, cx: &mut Context<Self>) {
        if marker.end > self.draft.len() || marker.start >= marker.end { return; }
        let next = if checked { "[x]" } else { "[ ]" };
        self.draft.replace_range(marker, next);
        let value = self.draft.clone();
        self.text.update(cx, |state, cx| state.set_value(value, window, cx));
        self.schedule_save(cx);
    }
}

impl Drop for NoteEditor {
    fn drop(&mut self) {
        // Flush the last edit synchronously before GPUI releases the tab view.
        let _ = save_note(self.connection_id, &self.note_id, &self.note_name, &self.draft);
    }
}

impl Render for NoteEditor {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let note_editor = cx.entity().downgrade();
        div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground)
            .child(div().flex().items_center().justify_between().px_5().py_3().border_b_1().border_color(t.border)
                .child(div().flex().flex_col().gap_1().w(px(320.))
                    .child(Input::new(&self.title).appearance(false))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Markdown source · changes autosave")))
                .child(div().flex().items_center().gap_3()
                    .child(div().tw_text_xs().text_color(if self.save_error.is_some() { t.destructive } else { t.muted_foreground }).child(if self.saving { "Saving…" } else if self.save_error.is_some() { "Save failed" } else { "Saved" }))
                    .child(Button::new("note-save-now").outline().size(ButtonSize::Sm).icon(IconName::Check).label("Save").on_click(cx.listener(|this, _, _, cx| this.save_now(cx))))
                    .child(Button::new("note-preview-toggle").outline().size(ButtonSize::Sm).icon(if self.preview { IconName::Pencil } else { IconName::Eye }).label(if self.preview { "Edit" } else { "Preview" }).on_click(cx.listener(|this, _, _, cx| { this.preview = !this.preview; cx.notify(); }))))
            )
            .when_some(self.save_error.clone(), |el, error| el.child(div().px_5().pt_2().tw_text_xs().text_color(t.destructive).child(error)))
            .when(!self.preview, |el| el.child(div().flex_1().min_h_0().p_5().child(Textarea::new(&self.text).appearance(false).h_full())))
            .when(self.preview, |el| el.child(div().flex_1().min_h_0().overflow_y_scrollbar().p_6().child(
                gpui_component::text::TextView::markdown("note-markdown-preview", self.draft.clone()).selectable(true).on_task_toggle(move |event, window, cx| {
                    let marker = event.marker_range();
                    let checked = event.checked();
                    note_editor.update(cx, |this, cx| this.toggle_task(marker, checked, window, cx)).ok();
                })
            )))
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-features-notes", |spec, session, window, cx| {
        let TabSpec::View { view, params } = spec else { return None };
        if view != "note" { return None; }
        let params = params.clone();
        Some(Into::<AnyView>::into(cx.new(|cx| NoteEditor::new(&params, session, window, cx))))
    });
}
