//! Port of hooks/use-ai-assistant.ts (+ the shared chat state studio-interface.tsx
//! threads between `AiChatSheet` and `AiThreadsSidebar`): one [`AiHub`] per
//! connection holds the thread list, the active thread, its messages, the live
//! trace and the pending approval. The chat panel and the threads panel both
//! observe it.

use crate::agent::{self, AgentEvent, ApprovalQuestion, ChatRequest};
use crate::chat_store::{self, now_ms, random_id, StoredChat, StoredMessage};
use crate::db_tools::{self, CatalogTable, DbCtx};
use crate::settings;
use futures::StreamExt;
use gpui::{App, AppContext, Context, Entity, Global, Task};
use rexa_core::Session;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub struct AiHub {
    pub connection_id: i64,
    pub session: Arc<Session>,
    pub settings: Value,
    pub chats: Vec<StoredChat>,
    pub active_chat_id: Option<String>,
    pub messages: Vec<StoredMessage>,
    pub steps: Vec<String>,
    pub is_sending: bool,
    pub is_loading: bool,
    pub threads_loading: bool,
    pub sending_since: Option<Instant>,
    pub last_elapsed: Option<std::time::Duration>,
    pub pending_approval: Option<(String, Vec<ApprovalQuestion>)>,
    pub catalog: Vec<CatalogTable>,
    pub current_provider: String,
    pub current_model: String,
    cancel: Option<Arc<AtomicBool>>,
    _task: Option<Task<()>>,
    _catalog_task: Option<Task<()>>,
}

#[derive(Default)]
struct Hubs(HashMap<i64, Entity<AiHub>>);
impl Global for Hubs {}

/// The hub for a connection (created on first use).
pub fn hub_for(session: Arc<Session>, cx: &mut App) -> Entity<AiHub> {
    let id = session.connection.id;
    if let Some(h) = cx.default_global::<Hubs>().0.get(&id) {
        return h.clone();
    }
    let hub = cx.new(|cx| AiHub::new(session, cx));
    cx.default_global::<Hubs>().0.insert(id, hub.clone());
    hub
}

pub fn db_type_of(session: &Session) -> String {
    session.driver.kind().as_str().to_string()
}

/// `messageTextForHistory`: artifacts are summarised by the original; we
/// keep the plain text.
fn history_text(m: &StoredMessage) -> String {
    m.content.clone()
}

impl AiHub {
    fn new(session: Arc<Session>, cx: &mut Context<Self>) -> Self {
        let connection_id = session.connection.id;
        let settings = settings::load();
        let chats = chat_store::list_chats(connection_id);
        let active = chats.first().map(|c| c.id.clone());
        let messages = active.as_deref().and_then(|id| chat_store::load_chat(connection_id, id)).map(|(_, m)| m).unwrap_or_default();
        let mut hub = AiHub {
            connection_id,
            session,
            settings,
            chats,
            active_chat_id: active,
            messages,
            steps: Vec::new(),
            is_sending: false,
            is_loading: false,
            threads_loading: false,
            sending_since: None,
            last_elapsed: None,
            pending_approval: None,
            catalog: Vec::new(),
            current_provider: String::new(),
            current_model: String::new(),
            cancel: None,
            _task: None,
            _catalog_task: None,
        };
        hub.auto_select_model();
        hub.load_catalog(cx);
        hub
    }

    /// `useAiMentionCatalog`.
    pub fn load_catalog(&mut self, cx: &mut Context<Self>) {
        let driver = self.session.driver.clone();
        let db_type = db_type_of(&self.session);
        let task = rexa_core::runtime::spawn(async move { Ok(db_tools::load_catalog(driver, &db_type).await) });
        self._catalog_task = Some(cx.spawn(async move |this, cx| {
            if let Ok(catalog) = task.await {
                this.update(cx, |this, cx| {
                    this.catalog = catalog;
                    cx.notify();
                })
                .ok();
            }
        }));
    }

    pub fn models(&self) -> Vec<settings::ModelOption> {
        settings::configured_models(&self.settings)
    }

    /// Auto-select the first actual model once settings load.
    fn auto_select_model(&mut self) {
        let models = self.models();
        if !self.current_provider.is_empty() && models.iter().any(|m| m.provider == self.current_provider && m.model == self.current_model) {
            return;
        }
        if let Some(first) = models.first() {
            self.current_provider = first.provider.clone();
            self.current_model = first.model.clone();
        }
    }

    pub fn reload_settings(&mut self, cx: &mut Context<Self>) {
        self.settings = settings::load();
        self.auto_select_model();
        cx.notify();
    }

    pub fn select_model(&mut self, provider: &str, model: &str, cx: &mut Context<Self>) {
        self.current_provider = provider.to_string();
        self.current_model = model.to_string();
        cx.notify();
    }

    pub fn selected_model_key(&self) -> Option<String> {
        (!self.current_provider.is_empty()).then(|| format!("{}:{}", self.current_provider, self.current_model))
    }

    pub fn load_chats(&mut self, cx: &mut Context<Self>) {
        self.chats = chat_store::list_chats(self.connection_id);
        if self.active_chat_id.is_none() {
            self.active_chat_id = self.chats.first().map(|c| c.id.clone());
            self.load_messages();
        }
        cx.notify();
    }

    fn load_messages(&mut self) {
        self.messages = self.active_chat_id.as_deref().and_then(|id| chat_store::load_chat(self.connection_id, id)).map(|(_, m)| m).unwrap_or_default();
    }

    pub fn active_title(&self) -> String {
        self.chats.iter().find(|c| Some(&c.id) == self.active_chat_id.as_ref()).map(|c| c.title.clone()).unwrap_or_else(|| "New Chat".into())
    }

    pub fn select_chat(&mut self, chat_id: &str, cx: &mut Context<Self>) {
        if self.is_sending {
            self.stop(cx);
        }
        self.active_chat_id = Some(chat_id.to_string());
        self.load_messages();
        self.steps.clear();
        cx.notify();
    }

    pub fn start_new_chat(&mut self, cx: &mut Context<Self>) {
        if self.is_sending {
            self.stop(cx);
        }
        self.active_chat_id = Some(random_id());
        self.messages.clear();
        self.steps.clear();
        cx.notify();
    }

    pub fn remove_chat(&mut self, chat_id: &str, cx: &mut Context<Self>) -> std::io::Result<()> {
        chat_store::delete_chat(self.connection_id, chat_id)?;
        self.chats.retain(|c| c.id != chat_id);
        if self.active_chat_id.as_deref() == Some(chat_id) {
            self.active_chat_id = Some(self.chats.first().map(|c| c.id.clone()).unwrap_or_else(random_id));
            self.load_messages();
            self.steps.clear();
        }
        cx.notify();
        Ok(())
    }

    fn persist(&self, chat_id: &str, messages: &[StoredMessage]) {
        let title = messages.iter().find(|m| m.role == "user").map(|m| m.content.chars().take(80).collect::<String>()).unwrap_or_else(|| "Chat".into());
        if let Err(e) = chat_store::save_chat(self.connection_id, chat_id, &title, messages) {
            eprintln!("[ai-chat] could not save chat: {e}");
        }
    }

    pub fn elapsed_label(&self) -> String {
        let d = self.sending_since.map(|s| s.elapsed()).or(self.last_elapsed).unwrap_or_default();
        format!("{:.1}s", d.as_secs_f32())
    }

    /// `sendMessage(prompt, provider, model)`.
    pub fn send_message(&mut self, prompt: String, cx: &mut Context<Self>) -> anyhow::Result<()> {
        let trimmed = prompt.trim().to_string();
        if trimmed.is_empty() || self.is_sending {
            return Ok(());
        }
        let provider = if self.current_provider.is_empty() {
            self.settings["providers"].as_object().and_then(|p| p.keys().next().cloned()).unwrap_or_else(|| "openai".into())
        } else {
            self.current_provider.clone()
        };
        let cfg = settings::provider_config(&self.settings, &provider, &self.current_model)?;
        let chat_id = self.active_chat_id.clone().unwrap_or_else(random_id);
        let history: Vec<(String, String)> =
            self.messages.iter().filter(|m| m.role == "user" || m.role == "assistant").filter(|m| !m.content.is_empty()).map(|m| (m.role.clone(), history_text(m))).collect();
        let user = StoredMessage { id: random_id(), chat_id: chat_id.clone(), role: "user".into(), content: trimmed.clone(), timestamp: now_ms(), meta_json: None };
        let assistant_id = random_id();
        self.active_chat_id = Some(chat_id.clone());
        self.messages.push(user);
        self.messages.push(StoredMessage { id: assistant_id.clone(), chat_id: chat_id.clone(), role: "assistant".into(), content: String::new(), timestamp: now_ms(), meta_json: None });
        self.steps.clear();
        self.is_sending = true;
        self.sending_since = Some(Instant::now());
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancel = Some(cancel.clone());

        let session = self.session.clone();
        let db = DbCtx {
            driver: session.driver.clone(),
            db_type: db_type_of(&session),
            connection_name: Some(session.connection.name.clone()),
            default_namespace: Some(session.driver.kind().default_schema(&session.connection.connection_string)).filter(|s| !s.is_empty()),
            allow_read: true,
            allow_write: false,
        };
        let req = ChatRequest {
            provider: cfg,
            permission_mode: settings::permission_mode(&self.settings).to_string(),
            db,
            exa_api_key: settings::exa_api_key(&self.settings),
            schema_context: self.catalog.clone(),
            history,
            prompt: trimmed,
        };
        let (tx, mut rx) = futures::channel::mpsc::unbounded::<AgentEvent>();
        let run = rexa_core::runtime::spawn(agent::run_chat(req, tx, cancel.clone()));
        self._task = Some(cx.spawn(async move |this, cx| {
            while let Some(ev) = rx.next().await {
                let alive = this
                    .update(cx, |this, cx| {
                        if this.active_chat_id.as_deref() != Some(chat_id.as_str()) {
                            return;
                        }
                        match ev {
                            AgentEvent::Delta(t) => {
                                if let Some(m) = this.messages.iter_mut().find(|m| m.id == assistant_id) {
                                    m.content.push_str(&t);
                                }
                            }
                            AgentEvent::Step(s) => this.steps.push(s),
                            AgentEvent::Approval { id, questions } => this.pending_approval = Some((id, questions)),
                            AgentEvent::ToolStart { .. } | AgentEvent::ToolEnd { .. } => {}
                        }
                        cx.notify();
                    })
                    .is_ok();
                if !alive {
                    return;
                }
            }
            let result = run.await;
            this.update(cx, |this, cx| {
                this.is_sending = false;
                this.last_elapsed = this.sending_since.take().map(|s| s.elapsed());
                this.cancel = None;
                let stopped = cancel.load(Ordering::Relaxed);
                if let Some(m) = this.messages.iter_mut().find(|m| m.id == assistant_id) {
                    match &result {
                        Ok(text) if !stopped && !text.is_empty() => m.content = text.clone(),
                        Ok(_) if stopped && m.content.is_empty() => m.content = "Stopped.".into(),
                        Ok(_) => {}
                        Err(e) if !stopped => m.content = format!("{e:#}"),
                        Err(_) => {
                            if m.content.is_empty() {
                                m.content = "Stopped.".into();
                            }
                        }
                    }
                }
                if this.active_chat_id.as_deref() == Some(chat_id.as_str()) {
                    let msgs = this.messages.clone();
                    this.persist(&chat_id, &msgs);
                }
                this.pending_approval = None;
                this.chats = chat_store::list_chats(this.connection_id);
                cx.notify();
            })
            .ok();
        }));
        cx.notify();
        Ok(())
    }

    /// `stopGeneration`.
    pub fn stop(&mut self, cx: &mut Context<Self>) {
        if let Some(c) = &self.cancel {
            c.store(true, Ordering::Relaxed);
        }
        if let Some((id, _)) = self.pending_approval.take() {
            agent::resolve_pending_approval(&id, json!([]));
        }
        self.is_sending = false;
        self.last_elapsed = self.sending_since.take().map(|s| s.elapsed());
        cx.notify();
    }

    /// `handleApprovalSubmit`: resolve the tool, or send the answers as a message.
    pub fn submit_approval(&mut self, answers: Vec<Value>, cx: &mut Context<Self>) -> anyhow::Result<()> {
        let answered: Vec<Value> = answers
            .into_iter()
            .filter(|a| a["selected"].as_array().is_some_and(|s| !s.is_empty()) || a["custom"].as_str().is_some_and(|c| !c.trim().is_empty()))
            .collect();
        if let Some((id, _)) = self.pending_approval.take() {
            agent::resolve_pending_approval(&id, Value::Array(answered));
            cx.notify();
            return Ok(());
        }
        if answered.is_empty() {
            return Ok(());
        }
        let formatted = answered
            .iter()
            .map(|a| {
                let mut parts: Vec<String> = a["selected"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
                if let Some(c) = a["custom"].as_str().map(str::trim).filter(|c| !c.is_empty()) {
                    parts.push(c.to_string());
                }
                format!("Q: {}\nA: {}", a["question"].as_str().unwrap_or(""), parts.join(", "))
            })
            .collect::<Vec<_>>()
            .join("\n\n");
        self.send_message(format!("Approval answers:\n{formatted}"), cx)
    }

    /// `handlePromptBarSend`: typed text answers a pending tool approval.
    pub fn send_from_prompt_bar(&mut self, text: String, cx: &mut Context<Self>) -> anyhow::Result<()> {
        let trimmed = text.trim().to_string();
        if trimmed.is_empty() {
            return Ok(());
        }
        if let Some((id, questions)) = self.pending_approval.take() {
            if let Some(first) = questions.first() {
                let lower = trimmed.to_lowercase();
                let matched = first.options.iter().find(|o| lower.contains(&o.to_lowercase()));
                let answers = match matched {
                    Some(o) => json!([{"question": first.q, "type": first.kind, "selected": [o]}]),
                    None => json!([{"question": first.q, "type": first.kind, "selected": [], "custom": trimmed}]),
                };
                agent::resolve_pending_approval(&id, answers);
                cx.notify();
                return Ok(());
            }
        }
        self.send_message(trimmed, cx)
    }

    /// `handleConfirmPermissions`.
    pub fn set_permission_mode(&mut self, mode: &str, cx: &mut Context<Self>) {
        if let Err(e) = settings::save_permission_mode(mode) {
            rexa_ui::toast::error(format!("{e:#}"), cx);
        }
        self.reload_settings(cx);
    }
}
