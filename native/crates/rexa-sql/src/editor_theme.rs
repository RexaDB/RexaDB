//! Port of lib/studio/editor-themes.ts (studio-dark, app-theme → Monaco
//! theme, custom VS Code / Monaco theme JSON, `resolveEditorThemeId`),
//! lib/studio/monaco-selection.ts and the parts of Monaco's built-in `vs` /
//! `vs-dark` themes the SQL grammar's tokens resolve to
//! (monaco-editor esm/vs/editor/standalone/common/themes.js), plus
//! hooks/use-global-editor-theme.ts's settings (`editor_theme_id`,
//! `custom_editor_themes`).

use gpui::{FontStyle, FontWeight, HighlightStyle, Hsla, Rgba};
use rexa_ui::{parse_color, Tokens};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Base {
    Vs,
    VsDark,
    HcBlack,
    HcLight,
}

impl Base {
    fn parse(s: &str) -> Option<Base> {
        Some(match s {
            "vs" => Base::Vs,
            "vs-dark" => Base::VsDark,
            "hc-black" => Base::HcBlack,
            "hc-light" => Base::HcLight,
            _ => return None,
        })
    }
    pub fn is_dark(self) -> bool {
        matches!(self, Base::VsDark | Base::HcBlack)
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ThemeRule {
    #[serde(default)]
    pub token: String,
    pub foreground: Option<String>,
    pub background: Option<String>,
    #[serde(rename = "fontStyle")]
    pub font_style: Option<String>,
}

/// `MonacoThemeDefinition`
#[derive(Clone, Debug)]
pub struct ThemeDefinition {
    pub base: Base,
    pub inherit: bool,
    pub rules: Vec<ThemeRule>,
    pub colors: HashMap<String, String>,
}

fn rule(token: &str, fg: &str) -> ThemeRule {
    ThemeRule { token: token.into(), foreground: Some(fg.into()), ..Default::default() }
}

/// Monaco's base rules, restricted to the scopes SQL tokens can reach.
fn base_rules(base: Base) -> Vec<ThemeRule> {
    match base {
        Base::Vs | Base::HcLight => vec![
            rule("", "000000"),
            rule("invalid", "cd3131"),
            rule("variable", "001188"),
            rule("variable.predefined", "4864AA"),
            rule("constant", "dd0000"),
            rule("comment", "008000"),
            rule("number", "098658"),
            rule("type", "008080"),
            rule("delimiter", "000000"),
            rule("string", "A31515"),
            rule("string.sql", "FF0000"),
            rule("keyword", "0000FF"),
            rule("operator.sql", "778899"),
            rule("predefined.sql", "C700C7"),
        ],
        Base::VsDark | Base::HcBlack => vec![
            rule("", "D4D4D4"),
            rule("invalid", "f44747"),
            rule("variable", "74B0DF"),
            rule("variable.predefined", "4864AA"),
            rule("constant", "569CD6"),
            rule("comment", "608B4E"),
            rule("number", "B5CEA8"),
            rule("type", "3DC9B0"),
            rule("delimiter", "DCDCDC"),
            rule("string", "CE9178"),
            rule("string.sql", "FF0000"),
            rule("keyword", "569CD6"),
            rule("operator.sql", "778899"),
            rule("predefined.sql", "FF00FF"),
        ],
    }
}

fn base_colors(base: Base) -> HashMap<String, String> {
    let pairs: &[(&str, &str)] = if base.is_dark() {
        &[
            ("editor.background", "#1E1E1E"),
            ("editor.foreground", "#D4D4D4"),
            ("editor.selectionBackground", "#264F78"),
            ("editor.inactiveSelectionBackground", "#3A3D41"),
            ("editorLineNumber.foreground", "#858585"),
            ("editorLineNumber.activeForeground", "#C6C6C6"),
            ("editorCursor.foreground", "#AEAFAD"),
        ]
    } else {
        &[
            ("editor.background", "#FFFFFE"),
            ("editor.foreground", "#000000"),
            ("editor.selectionBackground", "#ADD6FF"),
            ("editor.inactiveSelectionBackground", "#E5EBF1"),
            ("editorLineNumber.foreground", "#237893"),
            ("editorLineNumber.activeForeground", "#0B216F"),
            ("editorCursor.foreground", "#000000"),
        ]
    };
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

/// `parseCssColor`'s job is done by `rexa_ui::parse_color`; Monaco rule colors come without `#`.
fn rule_color(c: &str) -> Option<Hsla> {
    let c = c.trim();
    if c.starts_with('#') || c.contains('(') {
        parse_color(c)
    } else {
        parse_color(&format!("#{c}"))
    }
}

fn to_hex(c: Hsla) -> String {
    let r: Rgba = c.into();
    let b = |v: f32| (v.clamp(0., 1.) * 255.).round() as u8;
    if r.a >= 1. {
        format!("#{:02x}{:02x}{:02x}", b(r.r), b(r.g), b(r.b))
    } else {
        format!("#{:02x}{:02x}{:02x}{:02x}", b(r.r), b(r.g), b(r.b), b(r.a))
    }
}

/// `darkMonacoSelection`: 55% primary + 45% foreground; selected text takes the background.
pub fn dark_monaco_selection(primary: Hsla, foreground: Hsla) -> Hsla {
    let (p, f): (Rgba, Rgba) = (primary.into(), foreground.into());
    Rgba { r: p.r * 0.55 + f.r * 0.45, g: p.g * 0.55 + f.g * 0.45, b: p.b * 0.55 + f.b * 0.45, a: 1. }.into()
}

/// `getStudioDarkTheme`
pub fn studio_dark_theme(t: &Tokens) -> ThemeDefinition {
    let get = |k: &str, fallback: &str| t.var(k).map(to_hex).unwrap_or_else(|| fallback.to_string());
    let selection = get("--studio-selection", "rgba(91, 141, 239, 0.22)");
    let active = to_hex(dark_monaco_selection(
        t.var("--primary").unwrap_or_else(|| parse_color("#3b82f6").unwrap()),
        t.var("--foreground").unwrap_or_else(|| parse_color("#e2e2e2").unwrap()),
    ));
    let mut colors = HashMap::new();
    for (k, v) in [
        ("editor.background", get("--studio-bg", "#111111")),
        ("editor.foreground", get("--studio-cell-text", "#e2e2e2")),
        ("editor.lineHighlightBackground", get("--studio-row-hover", "#202020")),
        ("editorGutter.background", get("--studio-bg", "#111111")),
        ("editor.selectionBackground", active),
        ("editor.selectionForeground", get("--background", "#111113")),
        ("editor.inactiveSelectionBackground", selection.clone()),
        ("editor.selectionHighlightBackground", selection),
        ("editorCursor.foreground", get("--studio-cell-text", "#e2e2e2")),
        ("editorLineNumber.foreground", get("--studio-cell-muted", "#9d9d9d")),
        ("editorLineNumber.activeForeground", get("--studio-cell-text", "#e2e2e2")),
    ] {
        colors.insert(k.to_string(), v);
    }
    ThemeDefinition { base: Base::VsDark, inherit: true, rules: Vec::new(), colors }
}

/// An app theme as `lib/studio/app-themes.ts` stores it.
#[derive(Clone, Debug, Deserialize)]
pub struct AppThemeDef {
    pub id: String,
    pub base: String,
    pub colors: HashMap<String, String>,
}

/// Built-in + custom app themes (assets/themes.json + `custom_app_themes`).
pub fn app_themes(custom_json: Option<&str>) -> Vec<AppThemeDef> {
    let mut themes: Vec<AppThemeDef> = serde_json::from_str(include_str!("../../../assets/themes.json")).unwrap_or_default();
    if let Some(custom) = custom_json.and_then(|j| serde_json::from_str::<Vec<AppThemeDef>>(j).ok()) {
        themes.extend(custom);
    }
    themes
}

/// `buildMonacoThemeFromAppTheme`
pub fn monaco_theme_from_app_theme(theme: &AppThemeDef) -> ThemeDefinition {
    let pick = |k: &str| theme.colors.get(k).cloned();
    let pick2 = |a: &str, b: &str, f: &str| pick(a).or_else(|| pick(b)).unwrap_or_else(|| f.to_string());
    let pick3 = |a: &str, b: &str, c: &str, f: &str| pick(a).or_else(|| pick(b)).or_else(|| pick(c)).unwrap_or_else(|| f.to_string());
    let norm = |v: String| parse_color(&v).map(to_hex).unwrap_or(v);
    let dark = theme.base == "dark";
    let background = norm(pick2("--studio-bg", "--background", "#111111"));
    let foreground = norm(pick2("--studio-cell-text", "--foreground", "#e2e2e2"));
    let muted = norm(pick2("--studio-cell-muted", "--muted-foreground", "#9d9d9d"));
    let line_highlight = norm(pick2("--studio-row-hover", "--muted", "#202020"));
    let selection = norm(pick("--studio-selection").unwrap_or_else(|| "rgba(91, 141, 239, 0.22)".into()));
    let active = dark.then(|| {
        to_hex(dark_monaco_selection(
            parse_color(&pick("--primary").unwrap_or_else(|| "#3b82f6".into())).unwrap_or_default(),
            parse_color(&pick("--foreground").unwrap_or_else(|| "#e2e2e2".into())).unwrap_or_default(),
        ))
    });
    let keyword = norm(pick3("--syntax-keyword", "--chart-4", "--primary", "#60a5fa"));
    let string = norm(pick2("--syntax-string", "--chart-2", "#8bd5ca"));
    let number = norm(pick2("--syntax-number", "--chart-3", "#f59e0b"));
    let function = norm(pick3("--syntax-function", "--chart-1", "--chart-4", "#a78bfa"));
    let variable = norm(pick2("--syntax-variable", "--chart-5", "#f472b6"));
    let r = |token: &str, fg: &str, style: Option<&str>| ThemeRule {
        token: token.into(),
        foreground: Some(fg.trim_start_matches('#').to_string()),
        background: None,
        font_style: style.map(str::to_string),
    };
    let rules = vec![
        r("comment", &muted, None),
        r("string", &string, None),
        r("string.sql", &string, None),
        r("number", &number, None),
        r("keyword", &keyword, Some("bold")),
        r("keyword.sql", &keyword, Some("bold")),
        r("operator", &foreground, None),
        r("delimiter", &foreground, None),
        r("type", &function, None),
        r("function", &function, None),
        r("identifier", &foreground, None),
        r("variable", &variable, None),
    ];
    let mut colors: HashMap<String, String> = [
        ("editor.background", background.clone()),
        ("editor.foreground", foreground.clone()),
        ("editor.lineHighlightBackground", line_highlight),
        ("editor.selectionBackground", active.clone().unwrap_or_else(|| selection.clone())),
        ("editor.inactiveSelectionBackground", selection.clone()),
        ("editorGutter.background", background),
        ("editorLineNumber.foreground", muted),
        ("editorLineNumber.activeForeground", foreground.clone()),
        ("editorCursor.foreground", foreground),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    if active.is_some() {
        if let Some(bg) = pick("--background") {
            colors.insert("editor.selectionForeground".into(), norm(bg));
        }
    }
    ThemeDefinition { base: if dark { Base::VsDark } else { Base::Vs }, inherit: true, rules, colors }
}

#[derive(Deserialize)]
struct VsCodeTokenColor {
    scope: Option<serde_json::Value>,
    #[serde(default)]
    settings: ThemeRule,
}

#[derive(Deserialize)]
struct ThemeInput {
    #[serde(rename = "type")]
    kind: Option<String>,
    colors: Option<HashMap<String, String>>,
    #[serde(rename = "tokenColors")]
    token_colors: Option<Vec<VsCodeTokenColor>>,
    rules: Option<Vec<ThemeRule>>,
    base: Option<String>,
    inherit: Option<bool>,
}

/// `parseThemeJson`: Monaco (`rules`/`base`) or VS Code (`tokenColors`/`colors`) JSON.
pub fn parse_theme_json(json: &str) -> Result<ThemeDefinition, String> {
    let input: ThemeInput = serde_json::from_str(json).map_err(|_| "Theme JSON is not valid JSON.".to_string())?;
    let base = input.base.as_deref().and_then(Base::parse).unwrap_or(match input.kind.as_deref() {
        Some("light") => Base::Vs,
        Some("hc") => Base::HcBlack,
        _ => Base::VsDark,
    });
    let colors = input.colors.clone().unwrap_or_default();
    if input.rules.is_some() || input.base.is_some() {
        return Ok(ThemeDefinition { base, inherit: input.inherit.unwrap_or(true), rules: input.rules.unwrap_or_default(), colors });
    }
    if input.token_colors.is_none() && input.colors.is_none() {
        return Err("Theme JSON must include either 'rules' (Monaco) or 'tokenColors'/'colors' (VS Code).".into());
    }
    let mut rules = Vec::new();
    for entry in input.token_colors.unwrap_or_default() {
        let scopes: Vec<String> = match entry.scope {
            Some(serde_json::Value::Array(a)) => a.iter().filter_map(|v| v.as_str()).map(|s| s.trim().to_string()).collect(),
            Some(serde_json::Value::String(s)) => s.split(',').map(|s| s.trim().to_string()).collect(),
            _ => Vec::new(),
        };
        for scope in scopes.into_iter().filter(|s| !s.is_empty()) {
            rules.push(ThemeRule { token: scope, ..entry.settings.clone() });
        }
    }
    Ok(ThemeDefinition { base, inherit: true, rules, colors })
}

/// `resolveEditorThemeId`
pub fn resolve_editor_theme_id(selection: Option<&str>, dark: bool, app_editor_theme_id: Option<&str>) -> String {
    match selection {
        None | Some("") | Some("auto") => match app_editor_theme_id {
            Some(id) => id.to_string(),
            None => if dark { "studio-dark".into() } else { "light".into() },
        },
        Some(s) => s.to_string(),
    }
}

#[derive(Deserialize)]
struct CustomEditorTheme {
    id: String,
    #[serde(rename = "themeJson")]
    theme_json: String,
}

/// Editor-relevant settings (font, theme) read from `app_settings`.
#[derive(Clone, Debug)]
pub struct EditorSettings {
    pub font_size: f32,
    pub font_family: Option<String>,
    pub theme_id: Option<String>,
    pub custom_editor_themes: Option<String>,
    pub app_theme_id: Option<String>,
    pub custom_app_themes: Option<String>,
    pub studio: serde_json::Value,
}

impl EditorSettings {
    pub fn load() -> Self {
        let store = rexa_store::Store::open().ok();
        let get = |k: &str| store.as_ref().and_then(|s| s.setting(k).ok().flatten());
        let studio: serde_json::Value =
            get("studio_settings").and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::Value::Null);
        // `editorFontSize` is stored as "14px" or a number; `parseInt(…) || 13`.
        let font_size = match &studio["editorFontSize"] {
            serde_json::Value::Number(n) => n.as_f64().unwrap_or(13.) as f32,
            serde_json::Value::String(s) => {
                s.trim().trim_end_matches("px").trim().parse::<f32>().ok().filter(|v| *v > 0.).unwrap_or(13.)
            }
            _ => 13.,
        };
        let font_family = studio["editorFontFamily"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        EditorSettings {
            font_size,
            font_family,
            theme_id: get("editor_theme_id"),
            custom_editor_themes: get("custom_editor_themes"),
            app_theme_id: get("app_theme_id"),
            custom_app_themes: get("custom_app_themes"),
            studio,
        }
    }

    pub fn bool(&self, key: &str, default: bool) -> bool {
        self.studio[key].as_bool().unwrap_or(default)
    }

    /// The Monaco theme the editor shows (`themeId` in monaco-sql-input).
    pub fn theme(&self, tokens: &Tokens) -> ThemeDefinition {
        let app = self
            .app_theme_id
            .as_deref()
            .and_then(|id| app_themes(self.custom_app_themes.as_deref()).into_iter().find(|t| t.id == id));
        let app_id = app.as_ref().map(|a| format!("app-{}", a.id));
        let id = resolve_editor_theme_id(self.theme_id.as_deref(), tokens.dark, app_id.as_deref());
        if let (Some(app), Some(app_id)) = (&app, &app_id) {
            if *app_id == id {
                return monaco_theme_from_app_theme(app);
            }
        }
        if let Some(custom) = self
            .custom_editor_themes
            .as_deref()
            .and_then(|j| serde_json::from_str::<Vec<CustomEditorTheme>>(j).ok())
            .and_then(|list| list.into_iter().find(|t| t.id == id))
        {
            if let Ok(def) = parse_theme_json(&custom.theme_json) {
                return def;
            }
        }
        match id.as_str() {
            "studio-dark" => studio_dark_theme(tokens),
            "vs-dark" => ThemeDefinition { base: Base::VsDark, inherit: true, rules: vec![], colors: HashMap::new() },
            "hc-black" => ThemeDefinition { base: Base::HcBlack, inherit: true, rules: vec![], colors: HashMap::new() },
            // "light" / "vs" / unknown ids: Monaco falls back to `vs`.
            _ => ThemeDefinition { base: Base::Vs, inherit: true, rules: vec![], colors: HashMap::new() },
        }
    }
}

#[derive(Clone, Debug)]
struct Resolved {
    segments: Vec<String>,
    fg: Option<Hsla>,
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
}

/// A theme compiled for painting: token scope → style, plus editor colors.
#[derive(Clone, Debug)]
pub struct CompiledTheme {
    pub base: Base,
    rules: Vec<Resolved>,
    colors: HashMap<String, Hsla>,
}

impl CompiledTheme {
    pub fn new(def: &ThemeDefinition) -> Self {
        let mut raw = if def.inherit { base_rules(def.base) } else { Vec::new() };
        // Monaco: `editor.foreground` becomes the default token color.
        if let Some(fg) = def.colors.get("editor.foreground") {
            raw.push(ThemeRule { token: String::new(), foreground: Some(fg.clone()), ..Default::default() });
        }
        raw.extend(def.rules.iter().cloned());
        let rules = raw
            .into_iter()
            .map(|r| {
                let style = r.font_style.as_deref();
                let has = |w: &str| style.map(|s| s.split_whitespace().any(|x| x == w));
                Resolved {
                    segments: r.token.split('.').filter(|s| !s.is_empty()).map(str::to_string).collect(),
                    fg: r.foreground.as_deref().and_then(rule_color),
                    bold: has("bold"),
                    italic: has("italic"),
                    underline: has("underline"),
                }
            })
            .collect();
        let mut colors = HashMap::new();
        let mut all = if def.inherit { base_colors(def.base) } else { HashMap::new() };
        all.extend(def.colors.clone());
        for (k, v) in all {
            if let Some(c) = parse_color(&v) {
                colors.insert(k, c);
            }
        }
        CompiledTheme { base: def.base, rules, colors }
    }

    pub fn color(&self, key: &str) -> Option<Hsla> {
        self.colors.get(key).copied()
    }

    /// Monaco's token-theme match: the most specific rule whose dotted scope
    /// is a prefix of the token's; later rules override earlier ones of equal
    /// specificity, and unset properties inherit from less specific matches.
    pub fn style(&self, scope: &str) -> HighlightStyle {
        let token: Vec<&str> = scope.split('.').filter(|s| !s.is_empty()).collect();
        let mut matches: Vec<&Resolved> = self
            .rules
            .iter()
            .filter(|r| r.segments.len() <= token.len() && r.segments.iter().zip(&token).all(|(a, b)| a == b))
            .collect();
        matches.sort_by_key(|r| r.segments.len()); // stable: keeps declaration order within a length
        let (mut fg, mut bold, mut italic, mut underline) = (None, None, None, None);
        for r in matches {
            if r.fg.is_some() {
                fg = r.fg;
            }
            if r.bold.is_some() {
                bold = r.bold;
                italic = r.italic;
                underline = r.underline;
            }
        }
        HighlightStyle {
            color: fg,
            font_weight: bold.filter(|b| *b).map(|_| FontWeight::BOLD),
            font_style: italic.filter(|b| *b).map(|_| FontStyle::Italic),
            underline: underline.filter(|b| *b).map(|_| gpui::UnderlineStyle { thickness: gpui::px(1.), ..Default::default() }),
            ..Default::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_theme_resolves_sql_tokens() {
        let themes = app_themes(None);
        let dark = themes.iter().find(|t| t.id == "rexadb-dark").unwrap();
        let c = CompiledTheme::new(&monaco_theme_from_app_theme(dark));
        let kw = c.style("keyword.sql");
        assert_eq!(kw.color, parse_color("#de51a8"));
        assert_eq!(kw.font_weight, Some(FontWeight::BOLD));
        // `keyword.block.sql` falls back to `keyword`.
        assert_eq!(c.style("keyword.block.sql").color, parse_color("#de51a8"));
        // Base vs-dark rules win where the app theme has nothing more specific.
        assert_eq!(c.style("predefined.sql").color, parse_color("#FF00FF"));
        assert_eq!(c.style("operator.sql").color, parse_color("#778899"));
        assert_eq!(c.style("string.sql").color, parse_color("#ffca16"));
        assert_eq!(c.style("identifier.sql").color, parse_color("#e2e2e2"));
    }

    #[test]
    fn vscode_theme_json() {
        let def = parse_theme_json(r##"{"type":"light","tokenColors":[{"scope":"keyword, string","settings":{"foreground":"#ff0000"}}]}"##)
            .unwrap();
        assert_eq!(def.base, Base::Vs);
        assert_eq!(def.rules.len(), 2);
        assert!(parse_theme_json("{}").is_err());
    }
}
