//! Port of the AI agent: components/studio/{agents,ai}, lib/{ai,agents,acp},
//! hooks/use-ai-*, use-agent-*, use-sql-ai-*.
//!
//! - Hosted panels: `TabSpec::View { view: "ai-chat" | "ai-threads", params: { connectionId } }`
//!   ([`chat_view::AiChat`], [`threads_view::AiThreads`]) sharing one [`hub::AiHub`].
//! - [`agent`]: the Studio chat agent (tools of lib/ai/pi-tools.ts) on [`llm`]
//!   (Anthropic / OpenAI-compatible / Gemini streaming with tool use).
//! - [`sql_ai`]: the SQL editor's "/ prompt" generator (installed into rexa-sql)
//!   and the grid's AI filter ([`generate_ai_filter`]).
//! - [`mcp`]: the RexaDB MCP stdio server (`rexadb --mcp`).

pub mod agent;
pub mod chat_store;
pub mod chat_view;
pub mod claude;
pub mod db_tools;
pub mod hub;
pub mod llm;
pub mod markdown;
pub mod mcp;
pub mod settings;
pub mod sql_ai;
pub mod sql_guards;
pub mod system_prompt;
pub mod threads_view;
pub mod web;

pub use claude::{
    complete as claude_complete, complete_configured as claude_complete_configured, Completion as ClaudeCompletion, Message as ClaudeMessage,
    Role as ClaudeRole,
};
pub use sql_ai::generate_ai_filter;

use gpui::{AnyView, App, AppContext};
use rexa_core::{Registry, TabSpec};
use std::rc::Rc;

pub fn init(cx: &mut App) {
    rexa_sql::ai::set_sql_ai_generator(Rc::new(sql_ai::NativeSqlAi), cx);
    Registry::tab(cx, "rexa-ai", |spec, session, window, cx| {
        let TabSpec::View { view, .. } = spec else { return None };
        match view.as_str() {
            "ai-chat" => {
                let hub = hub::hub_for(session, cx);
                Some(Into::<AnyView>::into(cx.new(|cx| chat_view::AiChat::new(hub, window, cx))))
            }
            "ai-threads" => {
                let hub = hub::hub_for(session, cx);
                Some(Into::<AnyView>::into(cx.new(|cx| threads_view::AiThreads::new(hub, cx))))
            }
            _ => None,
        }
    });
}
