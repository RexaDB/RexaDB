//! Port of lib/ai/pi-tools.ts (`createPiDbTools`), lib/ai/pi-agent.ts
//! (`createRexaDbPiSession` / `streamPiResponse`), lib/ai/pending-approvals.ts
//! and the `/api/agent/chat/stream` + `/api/agent/approval/submit` routes of
//! server/index.ts — the Studio chat agent loop, run on the I/O runtime and
//! reporting through [`AgentEvent`]s.

use crate::db_tools::{self, CatalogTable, DbCtx};
use crate::llm::{self, Msg, ProviderConfig, Stream, ToolSpec};
use crate::sql_guards::db_capabilities;
use anyhow::{anyhow, bail, Result};
use futures::channel::{mpsc, oneshot};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Stream events (`PiSseEvent` / `AgentStreamEvent`).
#[derive(Clone, Debug)]
pub enum AgentEvent {
    Delta(String),
    /// `emitStep` — a short label for the trace ("Listing tables").
    Step(String),
    ToolStart { id: String, name: String, input: Value },
    ToolEnd { id: String, output: String, is_error: bool },
    /// `ask_questions` / `ask_approval` waiting for the user.
    Approval { id: String, questions: Vec<ApprovalQuestion> },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ApprovalQuestion {
    pub q: String,
    /// "radio" | "check"
    pub kind: String,
    pub options: Vec<String>,
}

pub fn parse_questions(value: &Value) -> Vec<ApprovalQuestion> {
    let arr = value.as_array().cloned().or_else(|| value["questions"].as_array().cloned()).unwrap_or_default();
    arr.iter()
        .filter_map(|q| {
            let text = q["q"].as_str().or(q["question"].as_str()).or(q["title"].as_str())?.trim().to_string();
            let options: Vec<String> = q["options"].as_array()?.iter().map(|o| o.as_str().map(str::to_string).unwrap_or_else(|| o.to_string())).map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).take(6).collect();
            (!text.is_empty() && !options.is_empty()).then(|| ApprovalQuestion { q: text, kind: if q["type"] == "check" { "check".into() } else { "radio".into() }, options })
        })
        .take(5)
        .collect()
}

// ---- pending approvals -------------------------------------------------------------------

fn pending() -> &'static Mutex<Vec<(String, oneshot::Sender<Value>)>> {
    static P: OnceLock<Mutex<Vec<(String, oneshot::Sender<Value>)>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// `resolvePendingApproval`: exact id, else the most recent pending one.
pub fn resolve_pending_approval(id: &str, answers: Value) -> bool {
    let mut p = pending().lock().unwrap();
    let pos = p.iter().position(|(k, _)| k == id).or_else(|| p.len().checked_sub(1));
    match pos {
        Some(i) => {
            let (_, tx) = p.remove(i);
            tx.send(answers).is_ok()
        }
        None => false,
    }
}

async fn create_pending_approval(id: &str) -> Result<Value> {
    let (tx, rx) = oneshot::channel();
    pending().lock().unwrap().push((id.to_string(), tx));
    match tokio::time::timeout(Duration::from_secs(5 * 60), rx).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => bail!("Approval cancelled"),
        Err(_) => {
            pending().lock().unwrap().retain(|(k, _)| k != id);
            bail!("Approval timed out")
        }
    }
}

// ---- tools -------------------------------------------------------------------------------

fn obj(props: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": props, "required": required})
}

fn ns_prop() -> Value {
    json!({"type": "string", "description": "Database or schema name"})
}

fn details_schema() -> Value {
    json!({"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "meta": {"type": "string"}}, "required": ["label"]}})
}

fn status_schema() -> Value {
    json!({"type": "string", "enum": ["pending", "in_progress", "completed", "failed"]})
}

/// The Studio chat's tools (pi-tools.ts names, descriptions and parameters).
pub fn chat_tools() -> Vec<ToolSpec> {
    vec![
        ToolSpec { name: "describe_connection_capabilities", description: "Describe which read-only capabilities are available for the current backend.", input_schema: obj(json!({}), &[]) },
        ToolSpec { name: "list_namespaces", description: "List databases or schemas available on the current connection.", input_schema: obj(json!({}), &[]) },
        ToolSpec { name: "list_tables", description: "List tables or collections for a namespace.", input_schema: obj(json!({"namespace": ns_prop()}), &[]) },
        ToolSpec { name: "list_dashboards", description: "List dashboards available in the current studio session, including their reference tokens.", input_schema: obj(json!({}), &[]) },
        ToolSpec { name: "list_workflows", description: "List workflows available in the current studio session.", input_schema: obj(json!({}), &[]) },
        ToolSpec {
            name: "get_dashboard_definition",
            description: "Get the current widget layout and queries for a dashboard reference like dashboard.some-name-ab12cd.",
            input_schema: obj(json!({"ref": {"type": "string", "description": "Dashboard reference token"}}), &["ref"]),
        },
        ToolSpec {
            name: "get_table_schema",
            description: "Get columns and field details for a table or collection.",
            input_schema: obj(json!({"namespace": ns_prop(), "table": {"type": "string", "description": "Table or collection name"}}), &["table"]),
        },
        ToolSpec {
            name: "get_related_tables",
            description: "Get foreign-key style relationships for a table when the backend supports it.",
            input_schema: obj(json!({"namespace": ns_prop(), "table": {"type": "string", "description": "Table name"}}), &["table"]),
        },
        ToolSpec {
            name: "sample_rows",
            description: "Fetch a small read-only sample from a table or collection.",
            input_schema: obj(
                json!({"namespace": ns_prop(), "table": {"type": "string", "description": "Table or collection name"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Maximum number of rows (default 20)"}}),
                &["table"],
            ),
        },
        ToolSpec { name: "run_readonly_query", description: "Execute a read-only query against the current connection.", input_schema: obj(json!({"query": {"type": "string", "description": "The read-only query to execute"}}), &["query"]) },
        ToolSpec { name: "search_schema", description: "Fuzzy-search tables and columns by keyword.", input_schema: obj(json!({"query": {"type": "string", "description": "Search keyword"}}), &["query"]) },
        ToolSpec {
            name: "web_search",
            description: "Search the live web — works out of the box (free daily quota), richer results with an Exa API key. Use for current events, docs, versions, and anything beyond the database. Returns titles, URLs, and content snippets.",
            input_schema: obj(json!({"query": {"type": "string", "description": "Search query"}, "numResults": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Max results (default 5)"}}), &["query"]),
        },
        ToolSpec {
            name: "fetch_web_content",
            description: "Fetch full page text for up to 5 URLs — works out of the box. Use after web_search to read a promising result in full. Only fetch URLs returned by web_search.",
            input_schema: obj(json!({"urls": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 5, "description": "URLs to fetch (from web_search results)"}}), &["urls"]),
        },
        ToolSpec {
            name: "create_tasks",
            description: "Create a list of tasks to track multi-step work. Each task has a label, optional amount, status, and details. Tasks are shown with the TaskRows UI.",
            input_schema: obj(
                json!({
                    "tasks": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string", "description": "Task title, e.g. 'Verified vendor records'"}, "amount": {"type": "string", "description": "Amount, e.g. '12 suppliers'"}, "status": status_schema(), "details": details_schema()}, "required": ["label"]}},
                    "variant": {"type": "string", "enum": ["Capsules", "List"]}
                }),
                &["tasks"],
            ),
        },
        ToolSpec {
            name: "update_task",
            description: "Update a task's status or details.",
            input_schema: obj(json!({"taskId": {"type": "string", "description": "ID of the task to update"}, "status": status_schema(), "label": {"type": "string"}, "amount": {"type": "string"}, "details": details_schema()}), &["taskId"]),
        },
        ToolSpec {
            name: "ask_questions",
            description: "Ask the user one or more questions that require human input. The UI shows an approval card with radio/check options and a custom input. Use for clarifications, choices, or confirmations. This tool will wait for the user's answer and return it.",
            input_schema: obj(
                json!({"questions": {"type": "array", "minItems": 1, "maxItems": 5, "items": {"type": "object", "properties": {"q": {"type": "string", "description": "Question text"}, "type": {"type": "string", "enum": ["radio", "check"], "description": "radio for single-choice, check for multi-select"}, "options": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 6}}, "required": ["q", "type", "options"]}}}),
                &["questions"],
            ),
        },
        ToolSpec {
            name: "ask_approval",
            description: "Ask for approval on a single decision (shorthand for ask_questions with one radio question). This tool will wait for the user's answer.",
            input_schema: obj(json!({"question": {"type": "string", "description": "Question text"}, "options": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 6}, "type": {"type": "string", "enum": ["radio", "check"]}}), &["question", "options"]),
        },
        ToolSpec { name: "list_edge_functions", description: "List all Edge Functions for the current Supabase project connection.", input_schema: obj(json!({}), &[]) },
        ToolSpec { name: "list_edge_secrets", description: "List all Edge Function secrets for the project.", input_schema: obj(json!({}), &[]) },
    ]
}

/// `emitStep` labels of pi-tools.ts.
fn step_label(name: &str, args: &Value) -> Option<String> {
    let s = |k: &str| args[k].as_str().unwrap_or("").to_string();
    Some(match name {
        "list_namespaces" => "Inspecting namespaces".into(),
        "list_tables" => "Listing tables".into(),
        "list_dashboards" => "Listing dashboards".into(),
        "list_workflows" => "Listing workflows".into(),
        "get_dashboard_definition" => format!("Inspecting dashboard {}", s("ref")),
        "get_table_schema" => format!("Inspecting schema for {}", s("table")),
        "get_related_tables" => format!("Checking related tables for {}", s("table")),
        "sample_rows" => format!("Sampling rows from {}", s("table")),
        "run_readonly_query" => "Running a read-only query".into(),
        "search_schema" => format!("Searching schema for \"{}\"", s("query")),
        "web_search" => format!("Searching the web for \"{}\"", s("query")),
        "fetch_web_content" => format!("Fetching {} web page(s)", args["urls"].as_array().map_or(0, Vec::len)),
        "create_tasks" => format!("Creating {} tasks", args["tasks"].as_array().map_or(0, Vec::len)),
        "update_task" => format!("Updating task {} → {}", s("taskId"), args["status"].as_str().unwrap_or("details")),
        "ask_questions" => format!("Asking {} question(s) — waiting for user", args["questions"].as_array().map_or(0, Vec::len)),
        "ask_approval" => format!("Asking for approval: {} — waiting for user", s("question")),
        "list_edge_functions" => "Listing Edge Functions".into(),
        "list_edge_secrets" => "Listing Edge Function secrets".into(),
        _ => return None,
    })
}

pub struct ChatToolCtx {
    pub db: DbCtx,
    pub exa_api_key: Option<String>,
    pub events: mpsc::UnboundedSender<AgentEvent>,
}

async fn execute_chat_tool(ctx: &ChatToolCtx, id: &str, name: &str, args: &Value) -> Result<Value> {
    let db = &ctx.db;
    let schema_only_msg = "This chat is limited to schema-only access.";
    match name {
        "describe_connection_capabilities" => Ok(json!({"dbType": db.db_type, "capabilities": db_capabilities(&db.db_type)})),
        "list_namespaces" => db_tools::list_namespaces(db).await,
        "list_tables" => db_tools::list_tables(db, args).await,
        "list_dashboards" => Ok(json!({"dashboards": []})),
        "list_workflows" => Ok(json!({"workflows": []})),
        "get_dashboard_definition" => bail!("Dashboard reference \"{}\" was not found.", args["ref"].as_str().unwrap_or("")),
        "get_table_schema" => db_tools::get_table_schema(db, args).await,
        "get_related_tables" => db_tools::get_related_tables(db, args).await,
        "sample_rows" => db_tools::sample_rows(db, args, schema_only_msg).await,
        "run_readonly_query" => db_tools::run_readonly_query(db, args["query"].as_str().unwrap_or("")).await,
        "search_schema" => db_tools::search_schema(db, args["query"].as_str().unwrap_or("")).await,
        "web_search" => {
            let n = args["numResults"].as_u64().unwrap_or(5);
            let q = args["query"].as_str().unwrap_or("");
            match &ctx.exa_api_key {
                Some(key) => crate::web::search_exa(q, key, n).await,
                None => Ok(json!({"results": crate::web::search_web_free(q, n).await?, "free": true})),
            }
        }
        "fetch_web_content" => {
            let mut urls: Vec<String> = Vec::new();
            for u in args["urls"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::trim).filter(|u| !u.is_empty()) {
                if !urls.iter().any(|x| x == u) {
                    urls.push(u.to_string());
                }
            }
            urls.truncate(5);
            match &ctx.exa_api_key {
                Some(key) => Ok(json!({"pages": crate::web::fetch_exa_contents(&urls, key).await?})),
                None => Ok(json!({"pages": crate::web::fetch_web_free(&urls).await?, "free": true})),
            }
        }
        "create_tasks" => {
            let now = crate::chat_store::now_ms();
            let tasks: Vec<Value> = args["tasks"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .map(|(i, t)| json!({"id": format!("task-{now}-{i}"), "label": t["label"], "amount": t["amount"], "status": t["status"].as_str().unwrap_or("pending"), "details": t["details"], "createdAt": now}))
                .collect();
            let n = tasks.len();
            Ok(json!({"tasks": tasks, "variant": args["variant"].as_str().unwrap_or("Capsules"), "message": format!("Created {n} tasks")}))
        }
        "update_task" => Ok(json!({"taskId": args["taskId"], "status": args["status"], "message": format!("Updated task {}", args["taskId"].as_str().unwrap_or(""))})),
        "ask_questions" | "ask_approval" => {
            let questions_json = if name == "ask_approval" {
                json!([{"q": args["question"], "type": args["type"].as_str().unwrap_or("radio"), "options": args["options"]}])
            } else {
                args["questions"].clone()
            };
            let questions = parse_questions(&questions_json);
            ctx.events.unbounded_send(AgentEvent::Approval { id: id.to_string(), questions }).ok();
            let answers = create_pending_approval(id).await?;
            Ok(json!({"answers": answers, "questions": questions_json, "message": if name == "ask_approval" { "User provided answer" } else { "User provided answers" }}))
        }
        "list_edge_functions" => {
            if db.db_type != "supabase-mgmt" {
                bail!("Edge Functions are not available for this connection type.");
            }
            Ok(json!({"functions": db.driver.supabase_edge_functions().await?}))
        }
        "list_edge_secrets" => {
            if db.db_type != "supabase-mgmt" {
                bail!("Edge Functions are not available for this connection type.");
            }
            Ok(json!({"secrets": db.driver.supabase_edge_secrets().await?}))
        }
        other => bail!("Tool {other} not found"),
    }
}

// ---- the loop ----------------------------------------------------------------------------

pub struct ChatRequest {
    pub provider: ProviderConfig,
    pub permission_mode: String,
    pub db: DbCtx,
    pub exa_api_key: Option<String>,
    pub schema_context: Vec<CatalogTable>,
    /// Prior user/assistant turns as text (`messageTextForHistory`).
    pub history: Vec<(String, String)>,
    pub prompt: String,
}

const MAX_STEPS: usize = 40;

/// `streamPiResponse`: returns the full assistant text.
pub async fn run_chat(req: ChatRequest, events: mpsc::UnboundedSender<AgentEvent>, cancel: Arc<AtomicBool>) -> Result<String> {
    let tools = chat_tools();
    let mut db = req.db;
    db.allow_read = req.permission_mode != "schema_only";
    db.allow_write = false;
    let system = crate::system_prompt::build_system_prompt(&db.db_type, db.default_namespace.as_deref(), &req.schema_context, &req.permission_mode, &tools);
    let mut messages: Vec<Msg> = req.history.into_iter().map(|(role, text)| if role == "assistant" { Msg::assistant_text(text) } else { Msg::user_text(text) }).collect();
    messages.push(Msg::user_text(req.prompt));
    let ctx = ChatToolCtx { db, exa_api_key: req.exa_api_key, events: events.clone() };
    let mut full_text = String::new();

    for _ in 0..MAX_STEPS {
        if cancel.load(Ordering::Relaxed) {
            return Ok(full_text);
        }
        let tx = events.clone();
        let mut on_text = |t: &str| {
            tx.unbounded_send(AgentEvent::Delta(t.to_string())).ok();
        };
        let turn = llm::stream_turn(&req.provider, &system, &messages, &tools, llm::MAX_TOKENS, Stream { on_text: &mut on_text, cancel: &cancel }).await?;
        full_text.push_str(&turn.text);
        if cancel.load(Ordering::Relaxed) {
            return Ok(full_text);
        }
        match turn.stop_reason.as_deref() {
            Some("refusal") => bail!("AI request failed: the model declined this request (model: {}).", req.provider.model),
            Some("max_tokens") if !turn.tool_calls.is_empty() => bail!("AI request failed: the response hit the token limit mid tool call (model: {}).", req.provider.model),
            _ => {}
        }
        messages.push(Msg { role: "assistant", content: turn.blocks.clone() });
        if turn.tool_calls.is_empty() {
            break;
        }
        let mut results = Vec::new();
        for call in &turn.tool_calls {
            let input = call.input.clone().unwrap_or(json!({}));
            events.unbounded_send(AgentEvent::ToolStart { id: call.id.clone(), name: call.name.clone(), input: input.clone() }).ok();
            if let Some(label) = step_label(&call.name, &input) {
                events.unbounded_send(AgentEvent::Step(label)).ok();
            }
            let outcome = match &call.input {
                Err(e) => Err(anyhow!("{e}")),
                Ok(args) => execute_chat_tool(&ctx, &call.id, &call.name, args).await,
            };
            let (text, is_error) = match outcome {
                Ok(v) => (v.to_string(), false),
                Err(e) => (format!("{e:#}"), true),
            };
            events.unbounded_send(AgentEvent::ToolEnd { id: call.id.clone(), output: text.clone(), is_error }).ok();
            let mut r = json!({"type": "tool_result", "tool_use_id": call.id, "content": text});
            if is_error {
                r["is_error"] = Value::Bool(true);
            }
            results.push(r);
        }
        messages.push(Msg { role: "user", content: results });
    }
    if full_text.trim().is_empty() && !cancel.load(Ordering::Relaxed) {
        bail!("The assistant returned an empty response (model: {}).", req.provider.model);
    }
    Ok(full_text)
}

/// Lookup used by tests: tool names offered to the model.
pub fn chat_tool_names() -> Vec<&'static str> {
    chat_tools().iter().map(|t| t.name).collect()
}

#[allow(dead_code)]
fn _assert_send(req: ChatRequest, tx: mpsc::UnboundedSender<AgentEvent>, c: Arc<AtomicBool>) {
    fn is_send<T: Send>(_: T) {}
    is_send(run_chat(req, tx, c));
}

pub type Pending = HashMap<String, ()>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn questions() {
        let q = parse_questions(&json!({"questions": [{"q": "Proceed?", "type": "check", "options": ["Yes", "No", ""]}, {"q": "", "options": ["x"]}]}));
        assert_eq!(q.len(), 1);
        assert_eq!(q[0].kind, "check");
        assert_eq!(q[0].options, vec!["Yes", "No"]);
    }

    #[test]
    fn tools_unique() {
        let names = chat_tool_names();
        let mut s = names.clone();
        s.sort();
        s.dedup();
        assert_eq!(s.len(), names.len());
        assert!(names.contains(&"run_readonly_query"));
    }

    #[test]
    fn approvals_resolve() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let waiter = tokio::spawn(async { create_pending_approval("t-1").await });
            tokio::time::sleep(Duration::from_millis(20)).await;
            assert!(resolve_pending_approval("t-1", json!(["ok"])));
            assert_eq!(waiter.await.unwrap().unwrap(), json!(["ok"]));
        });
    }
}
