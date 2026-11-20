//! Theme helpers from lib/studio/editor-themes.ts (createThemeId,
//! parseThemeJson validation), lib/studio/app-themes.ts (parseAppThemeJson) and
//! settings-view.tsx (generateCopyName, validateAndPrepareTheme).

use serde_json::{Map, Value};
use std::collections::HashSet;

/// createThemeId: kebab-case slug, de-duplicated with `-2`, `-3`, ….
pub fn create_theme_id(name: &str, existing: &HashSet<String>) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            slug.push(c);
            dash = false;
        } else if !dash {
            slug.push('-');
            dash = true;
        }
    }
    let base = slug.trim_matches('-').to_string();
    let base = if base.is_empty() { "custom-theme".to_string() } else { base };
    if !existing.contains(&base) {
        return base;
    }
    let mut n = 2;
    while existing.contains(&format!("{base}-{n}")) {
        n += 1;
    }
    format!("{base}-{n}")
}

/// generateCopyName.
pub fn copy_name(selected: &str, existing: &HashSet<String>) -> String {
    let mut name = format!("{selected} (copy)");
    let mut n = 2;
    while existing.contains(&name) {
        name = format!("{selected} (copy {n})");
        n += 1;
    }
    name
}

/// parseThemeJson (editor): returns the theme's own `name` on success.
pub fn parse_editor_theme(json: &str) -> Result<Option<String>, String> {
    let v: Value = serde_json::from_str(json).map_err(|_| "Theme JSON is not valid JSON.".to_string())?;
    let Value::Object(o) = v else { return Err("Theme JSON must be an object.".into()) };
    let name = o.get("name").and_then(|n| n.as_str()).map(|s| s.trim().to_string());
    if o.get("rules").is_some_and(|r| r.is_array()) || o.get("base").is_some() {
        return Ok(name);
    }
    if o.get("tokenColors").is_none() && o.get("colors").is_none() {
        return Err("Theme JSON must include either 'rules' (Monaco) or 'tokenColors'/'colors' (VS Code).".into());
    }
    Ok(name)
}

/// parseAppThemeJson → (name, base, colors with `--` prefixes).
pub fn parse_app_theme(json: &str) -> Result<(String, String, Map<String, Value>), String> {
    let v: Value = serde_json::from_str(json).map_err(|_| "Theme JSON is not valid JSON.".to_string())?;
    let Value::Object(o) = v else { return Err("Theme JSON must be an object.".into()) };
    let base = o.get("base").or_else(|| o.get("type")).and_then(|b| b.as_str()).unwrap_or_default();
    if base != "light" && base != "dark" {
        return Err("Theme JSON must include a 'type' or 'base' of 'light' or 'dark'.".into());
    }
    let Some(Value::Object(raw)) = o.get("colors").or_else(|| o.get("variables")) else {
        return Err("Theme JSON must include a 'colors' object.".into());
    };
    let mut colors = Map::new();
    for (k, v) in raw {
        let s = match v {
            Value::String(s) if !s.is_empty() => s.clone(),
            Value::Null | Value::Bool(false) => continue,
            Value::String(_) => continue,
            other => other.to_string(),
        };
        let key = if k.starts_with("--") { k.clone() } else { format!("--{k}") };
        colors.insert(key, Value::from(s));
    }
    if colors.is_empty() {
        return Err("Theme JSON colors must contain at least one CSS variable.".into());
    }
    let name = o.get("name").and_then(|n| n.as_str()).map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("Custom Theme");
    Ok((name.to_string(), base.to_string(), colors))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_and_copies() {
        let mut ex = HashSet::new();
        assert_eq!(create_theme_id("My Theme!", &ex), "my-theme");
        ex.insert("my-theme".to_string());
        assert_eq!(create_theme_id("My Theme", &ex), "my-theme-2");
        assert_eq!(create_theme_id("!!!", &ex), "custom-theme");
        let names: HashSet<String> = ["Dark (copy)".to_string()].into();
        assert_eq!(copy_name("Dark", &names), "Dark (copy 2)");
    }

    #[test]
    fn parses_themes() {
        assert!(parse_editor_theme("{}").is_err());
        assert!(parse_editor_theme(r#"{"base":"vs-dark","rules":[]}"#).is_ok());
        let (n, b, c) = parse_app_theme(r##"{"name":"X","type":"dark","colors":{"background":"#000"}}"##).unwrap();
        assert_eq!((n.as_str(), b.as_str()), ("X", "dark"));
        assert_eq!(c["--background"], "#000");
    }
}
