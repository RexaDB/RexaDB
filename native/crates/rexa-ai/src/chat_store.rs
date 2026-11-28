//! Port of lib/db/chat-json-storage.ts (+ the `/api/studio/chats*` routes of
//! server/index.ts and lib/api/studio-chat-storage.ts): the Studio AI chat
//! keeps each thread as `<app data>/chats/<connectionId>/<chatId>.json` with a
//! `_index.json` per connection. (The `ai_chats` / `ai_chat_messages` tables in
//! sqlite.db are the legacy storage; the original Studio chat no longer reads
//! them, so neither do we — both apps share these JSON files.)

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `randomId()` of use-ai-assistant.ts: 8 base-36 characters.
pub fn random_id() -> String {
    let n = uuid::Uuid::new_v4().as_u128();
    let mut v = n;
    let mut s = String::new();
    for _ in 0..8 {
        let d = (v % 36) as u32;
        v /= 36;
        s.push(std::char::from_digit(d, 36).unwrap_or('0'));
    }
    s
}

/// `StoredAiChatMessage`.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub chat_id: String,
    /// "user" | "assistant" | "system" | "tool"
    pub role: String,
    pub content: String,
    pub timestamp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta_json: Option<String>,
}

/// `StoredAiChat` (from the index).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredChat {
    pub id: String,
    pub connection_id: i64,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub last_message: String,
    #[serde(default)]
    pub message_count: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatFile {
    title: String,
    created_at: u64,
    updated_at: u64,
    messages: Vec<StoredMessage>,
}

fn chat_dir(connection_id: i64) -> PathBuf {
    rexa_store::app_data_dir().join("chats").join(connection_id.to_string())
}

/// Chat ids become file names; refuse anything that could escape the directory.
pub fn valid_chat_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn load_index(connection_id: i64) -> Vec<StoredChat> {
    fs::read(chat_dir(connection_id).join("_index.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect()
}

fn save_index(connection_id: i64, entries: &[StoredChat]) -> std::io::Result<()> {
    let dir = chat_dir(connection_id);
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("_index.json"), serde_json::to_vec_pretty(entries).map_err(std::io::Error::other)?)
}

/// `listChats` (the threads sidebar sorts by `updatedAt` desc).
pub fn list_chats(connection_id: i64) -> Vec<StoredChat> {
    let mut chats = load_index(connection_id);
    chats.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
    chats
}

/// `loadChatMessages` → (title, messages).
pub fn load_chat(connection_id: i64, chat_id: &str) -> Option<(String, Vec<StoredMessage>)> {
    if !valid_chat_id(chat_id) {
        return None;
    }
    let raw = fs::read(chat_dir(connection_id).join(format!("{chat_id}.json"))).ok()?;
    let file: ChatFile = serde_json::from_slice(&raw).ok()?;
    Some((file.title, file.messages))
}

/// `saveChatMessages`.
pub fn save_chat(connection_id: i64, chat_id: &str, title: &str, messages: &[StoredMessage]) -> std::io::Result<()> {
    if !valid_chat_id(chat_id) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid chat id"));
    }
    let dir = chat_dir(connection_id);
    fs::create_dir_all(&dir)?;
    let now = now_ms();
    let created_at = messages.first().map_or(now, |m| m.timestamp);
    let file = ChatFile { title: title.to_string(), created_at, updated_at: now, messages: messages.to_vec() };
    let tmp = dir.join(format!(".{chat_id}.json.tmp"));
    fs::write(&tmp, serde_json::to_vec_pretty(&file).map_err(std::io::Error::other)?)?;
    fs::rename(tmp, dir.join(format!("{chat_id}.json")))?;

    let last = messages.iter().rev().find(|m| m.role == "user" || m.role == "assistant");
    let entry = StoredChat {
        id: chat_id.to_string(),
        connection_id,
        title: title.to_string(),
        created_at,
        updated_at: now,
        last_message: last.map(|m| m.content.chars().take(120).collect()).unwrap_or_default(),
        message_count: messages.len(),
    };
    let mut index = load_index(connection_id);
    match index.iter_mut().find(|e| e.id == chat_id) {
        Some(e) => *e = entry,
        None => index.push(entry),
    }
    index.sort_by_key(|c| std::cmp::Reverse(c.updated_at));
    save_index(connection_id, &index)
}

/// `deleteChat`.
pub fn delete_chat(connection_id: i64, chat_id: &str) -> std::io::Result<()> {
    if !valid_chat_id(chat_id) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid chat id"));
    }
    fs::remove_file(chat_dir(connection_id).join(format!("{chat_id}.json")))?;
    let mut index = load_index(connection_id);
    index.retain(|e| e.id != chat_id);
    save_index(connection_id, &index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        let id = random_id();
        assert_eq!(id.len(), 8);
        assert!(valid_chat_id(&id));
        assert!(!valid_chat_id("../x"));
        assert!(!valid_chat_id(""));
    }

    #[test]
    fn message_json_shape() {
        let m = StoredMessage { id: "a".into(), chat_id: "c".into(), role: "tool".into(), content: "x".into(), timestamp: 1, meta_json: None };
        let v = serde_json::to_value(&m).unwrap();
        assert_eq!(v["chatId"], "c");
        let back: StoredMessage = serde_json::from_value(serde_json::json!({"id":"a","chatId":"c","role":"assistant","content":"","timestamp":2,"metaJson":null})).unwrap();
        assert_eq!(back.role, "assistant");
    }
}
