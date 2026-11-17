//! The editor's syntax highlighter: Monaco's SQL grammar ([`crate::tokenizer`])
//! colored by the active Monaco theme ([`crate::editor_theme`]), plugged into
//! gpui-component's editor engine in place of its tree-sitter highlighter.

use crate::editor_theme::CompiledTheme;
use crate::tokenizer::{tokenize, Token};
use gpui::{Context, HighlightStyle, SharedString, Window};
use gpui_component::input::{
    EditorState, FoldRange, HighlightStyleResolver, InputEdit, InputHighlighter, InputHighlighterFactory, Rope,
};
use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

pub type SharedTheme = Rc<RefCell<CompiledTheme>>;

pub struct MonacoSqlHighlighter {
    theme: SharedTheme,
    /// Plain text (Redis / unknown): everything in the default color.
    plain: bool,
    tokens: Vec<(Range<usize>, Token)>,
}

impl MonacoSqlHighlighter {
    pub fn factory(theme: SharedTheme, plain: bool) -> InputHighlighterFactory {
        Rc::new(move |_language: &str| {
            Some(Box::new(MonacoSqlHighlighter { theme: theme.clone(), plain, tokens: Vec::new() }) as Box<dyn InputHighlighter>)
        })
    }
}

impl InputHighlighter for MonacoSqlHighlighter {
    fn language(&self) -> SharedString {
        "sql".into()
    }

    fn update(&mut self, _edit: Option<InputEdit>, text: &Rope, _folding: bool, _: &mut Window, _: &mut Context<EditorState>) {
        // SQL buffers are small; Monaco re-tokenizes lines lazily, we re-run the
        // whole (linear) grammar on each change.
        self.tokens = if self.plain { Vec::new() } else { tokenize(&text.to_string()) };
    }

    fn styles(&self, range: &Range<usize>, _: &dyn HighlightStyleResolver) -> Vec<(Range<usize>, HighlightStyle)> {
        let theme = self.theme.borrow();
        let mut out = Vec::new();
        let mut pos = range.start;
        let start_ix = self.tokens.partition_point(|(r, _)| r.end <= range.start);
        for (r, tok) in &self.tokens[start_ix..] {
            if r.start >= range.end {
                break;
            }
            let s = r.start.max(range.start);
            let e = r.end.min(range.end);
            if s > pos {
                out.push((pos..s, HighlightStyle::default()));
            }
            if e > s {
                out.push((s..e, theme.style(tok.scope())));
                pos = e;
            }
        }
        if pos < range.end {
            out.push((pos..range.end, HighlightStyle::default()));
        }
        out
    }

    fn fold_ranges(&self, _text: &Rope) -> Vec<FoldRange> {
        // `folding: false` in monaco-sql-input.
        Vec::new()
    }
}
