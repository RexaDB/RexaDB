//! Port of Monaco's SQL Monarch grammar (monaco-editor 0.55.1,
//! esm/vs/basic-languages/sql/sql.js) — the tokenizer behind the editor's
//! syntax colors. Token names carry the grammar's `.sql` postfix, so they
//! resolve against Monaco themes exactly like in the original
//! (`keyword.sql`, `predefined.sql`, `operator.sql`, …).

use crate::monarch_words::*;
use std::collections::HashSet;
use std::ops::Range;
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Token {
    White,
    Comment,
    CommentQuote,
    Number,
    String,
    Identifier,
    IdentifierQuote,
    Keyword,
    KeywordBlock,
    KeywordChoice,
    KeywordTry,
    KeywordCatch,
    Operator,
    Predefined,
    Delimiter,
    DelimiterParenthesis,
    /// Monarch's error token for unmatched input (`''`).
    Invalid,
}

impl Token {
    pub fn scope(self) -> &'static str {
        match self {
            Token::White => "white.sql",
            Token::Comment => "comment.sql",
            Token::CommentQuote => "comment.quote.sql",
            Token::Number => "number.sql",
            Token::String => "string.sql",
            Token::Identifier => "identifier.sql",
            Token::IdentifierQuote => "identifier.quote.sql",
            Token::Keyword => "keyword.sql",
            Token::KeywordBlock => "keyword.block.sql",
            Token::KeywordChoice => "keyword.choice.sql",
            Token::KeywordTry => "keyword.try.sql",
            Token::KeywordCatch => "keyword.catch.sql",
            Token::Operator => "operator.sql",
            Token::Predefined => "predefined.sql",
            Token::Delimiter => "delimiter.sql",
            Token::DelimiterParenthesis => "delimiter.parenthesis.sql",
            Token::Invalid => "",
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum State {
    Root,
    Comment,
    String,
    Bracketed,
    Quoted,
}

fn set(words: &'static [&'static str]) -> HashSet<String> {
    words.iter().map(|w| w.to_ascii_lowercase()).collect()
}

struct Words {
    keywords: HashSet<String>,
    operators: HashSet<String>,
    functions: HashSet<String>,
    variables: HashSet<String>,
    pseudo: HashSet<String>,
}

fn words() -> &'static Words {
    static W: OnceLock<Words> = OnceLock::new();
    W.get_or_init(|| Words {
        keywords: set(KEYWORDS),
        operators: set(OPERATORS),
        functions: set(BUILTIN_FUNCTIONS),
        variables: set(BUILTIN_VARIABLES),
        pseudo: set(PSEUDO_COLUMNS),
    })
}

fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'@' || c == b'#' || c == b'$'
}

fn is_ident_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// `\b` after `len` bytes of `s` at `i` (ASCII word boundary).
fn boundary_after(s: &[u8], end: usize) -> bool {
    end >= s.len() || !is_ident_word(s[end])
}

fn starts_ci(s: &[u8], i: usize, word: &str) -> bool {
    s.len() >= i + word.len() && s[i..i + word.len()].eq_ignore_ascii_case(word.as_bytes())
}

fn skip_ws(s: &[u8], mut i: usize) -> usize {
    while i < s.len() && s[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// The scope rules (`BEGIN TRAN`, `BEGIN TRY`, `CASE`, `END`, `WHEN`, …).
fn match_scope(s: &[u8], i: usize) -> Option<(usize, Token)> {
    if starts_ci(s, i, "begin") {
        let after = i + 5;
        let j = skip_ws(s, after);
        if j > after {
            // BEGIN\s+(DISTRIBUTED\s+)?TRAN(SACTION)?\b
            let mut k = j;
            if starts_ci(s, k, "distributed") {
                let m = skip_ws(s, k + 11);
                if m > k + 11 {
                    k = m;
                }
            }
            if starts_ci(s, k, "tran") {
                let end = if starts_ci(s, k, "transaction") { k + 11 } else { k + 4 };
                if boundary_after(s, end) {
                    return Some((end, Token::Keyword));
                }
            }
            for (w, t) in [("try", Token::KeywordTry), ("catch", Token::KeywordCatch)] {
                if starts_ci(s, j, w) && boundary_after(s, j + w.len()) {
                    return Some((j + w.len(), t));
                }
            }
        }
    }
    if starts_ci(s, i, "end") {
        let j = skip_ws(s, i + 3);
        if j > i + 3 {
            for (w, t) in [("try", Token::KeywordTry), ("catch", Token::KeywordCatch)] {
                if starts_ci(s, j, w) && boundary_after(s, j + w.len()) {
                    return Some((j + w.len(), t));
                }
            }
        }
    }
    for (w, t) in [
        ("begin", Token::KeywordBlock),
        ("case", Token::KeywordBlock),
        ("end", Token::KeywordBlock),
        ("when", Token::KeywordChoice),
        ("then", Token::KeywordChoice),
    ] {
        if starts_ci(s, i, w) && boundary_after(s, i + w.len()) {
            return Some((i + w.len(), t));
        }
    }
    None
}

/// `numbers` rules; returns the end of the match.
fn match_number(s: &[u8], i: usize) -> Option<usize> {
    let c = s[i];
    if c == b'0' && i + 1 < s.len() && (s[i + 1] == b'x' || s[i + 1] == b'X') {
        let mut j = i + 2;
        while j < s.len() && s[j].is_ascii_hexdigit() {
            j += 1;
        }
        return Some(j);
    }
    if c == b'$' {
        // [$][+-]*\d*(\.\d*)?  (always matches at least the `$`)
        let mut j = i + 1;
        while j < s.len() && (s[j] == b'+' || s[j] == b'-') {
            j += 1;
        }
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
        if j < s.len() && s[j] == b'.' {
            j += 1;
            while j < s.len() && s[j].is_ascii_digit() {
                j += 1;
            }
        }
        return Some(j);
    }
    // ((\d+(\.\d*)?)|(\.\d+))([eE][\-+]?\d+)?
    let mut j = i;
    if c.is_ascii_digit() {
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
        if j < s.len() && s[j] == b'.' {
            j += 1;
            while j < s.len() && s[j].is_ascii_digit() {
                j += 1;
            }
        }
    } else if c == b'.' && i + 1 < s.len() && s[i + 1].is_ascii_digit() {
        j += 1;
        while j < s.len() && s[j].is_ascii_digit() {
            j += 1;
        }
    } else {
        return None;
    }
    if j < s.len() && (s[j] == b'e' || s[j] == b'E') {
        let mut k = j + 1;
        if k < s.len() && (s[k] == b'+' || s[k] == b'-') {
            k += 1;
        }
        let digits = k;
        while k < s.len() && s[k].is_ascii_digit() {
            k += 1;
        }
        if k > digits {
            j = k;
        }
    }
    Some(j)
}

/// Tokenize `text` into contiguous runs covering it completely.
pub fn tokenize(text: &str) -> Vec<(Range<usize>, Token)> {
    let s = text.as_bytes();
    let w = words();
    let mut out: Vec<(Range<usize>, Token)> = Vec::new();
    let push = |range: Range<usize>, tok: Token, out: &mut Vec<(Range<usize>, Token)>| {
        if range.is_empty() {
            return;
        }
        if let Some(last) = out.last_mut() {
            if last.1 == tok && last.0.end == range.start {
                last.0.end = range.end;
                return;
            }
        }
        out.push((range, tok));
    };
    let mut state = State::Root;
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        match state {
            State::Comment => {
                if s[i..].starts_with(b"*/") {
                    push(i..i + 2, Token::CommentQuote, &mut out);
                    i += 2;
                    state = State::Root;
                } else {
                    push(i..i + 1, Token::Comment, &mut out);
                    i += 1;
                }
            }
            State::String => {
                if s[i..].starts_with(b"''") {
                    push(i..i + 2, Token::String, &mut out);
                    i += 2;
                } else if c == b'\'' {
                    push(i..i + 1, Token::String, &mut out);
                    i += 1;
                    state = State::Root;
                } else {
                    push(i..i + 1, Token::String, &mut out);
                    i += 1;
                }
            }
            State::Bracketed => {
                if s[i..].starts_with(b"]]") {
                    push(i..i + 2, Token::Identifier, &mut out);
                    i += 2;
                } else if c == b']' {
                    push(i..i + 1, Token::IdentifierQuote, &mut out);
                    i += 1;
                    state = State::Root;
                } else {
                    push(i..i + 1, Token::Identifier, &mut out);
                    i += 1;
                }
            }
            State::Quoted => {
                if s[i..].starts_with(b"\"\"") {
                    push(i..i + 2, Token::Identifier, &mut out);
                    i += 2;
                } else if c == b'"' {
                    push(i..i + 1, Token::IdentifierQuote, &mut out);
                    i += 1;
                    state = State::Root;
                } else {
                    push(i..i + 1, Token::Identifier, &mut out);
                    i += 1;
                }
            }
            State::Root => {
                // comments
                if s[i..].starts_with(b"--") {
                    let end = s[i..].iter().position(|&b| b == b'\n').map_or(s.len(), |p| i + p);
                    push(i..end, Token::Comment, &mut out);
                    i = end;
                    continue;
                }
                if s[i..].starts_with(b"/*") {
                    push(i..i + 2, Token::CommentQuote, &mut out);
                    i += 2;
                    state = State::Comment;
                    continue;
                }
                // whitespace
                if c.is_ascii_whitespace() {
                    let end = skip_ws(s, i);
                    push(i..end, Token::White, &mut out);
                    i = end;
                    continue;
                }
                // pseudoColumns: [$][A-Za-z_][\w@#$]*
                if c == b'$' && i + 1 < s.len() && (s[i + 1].is_ascii_alphabetic() || s[i + 1] == b'_') {
                    let mut j = i + 2;
                    while j < s.len() && is_word(s[j]) {
                        j += 1;
                    }
                    let word = text[i..j].to_ascii_lowercase();
                    push(i..j, if w.pseudo.contains(&word) { Token::Predefined } else { Token::Identifier }, &mut out);
                    i = j;
                    continue;
                }
                // numbers
                if let Some(end) = match_number(s, i) {
                    push(i..end, Token::Number, &mut out);
                    i = end;
                    continue;
                }
                // strings
                if s[i..].starts_with(b"N'") {
                    push(i..i + 2, Token::String, &mut out);
                    i += 2;
                    state = State::String;
                    continue;
                }
                if c == b'\'' {
                    push(i..i + 1, Token::String, &mut out);
                    i += 1;
                    state = State::String;
                    continue;
                }
                // complexIdentifiers
                if c == b'[' {
                    push(i..i + 1, Token::IdentifierQuote, &mut out);
                    i += 1;
                    state = State::Bracketed;
                    continue;
                }
                if c == b'"' {
                    push(i..i + 1, Token::IdentifierQuote, &mut out);
                    i += 1;
                    state = State::Quoted;
                    continue;
                }
                // scopes
                if let Some((end, tok)) = match_scope(s, i) {
                    push(i..end, tok, &mut out);
                    i = end;
                    continue;
                }
                if matches!(c, b';' | b',' | b'.') {
                    push(i..i + 1, Token::Delimiter, &mut out);
                    i += 1;
                    continue;
                }
                if matches!(c, b'(' | b')') {
                    push(i..i + 1, Token::DelimiterParenthesis, &mut out);
                    i += 1;
                    continue;
                }
                if is_word(c) {
                    let mut j = i + 1;
                    while j < s.len() && is_word(s[j]) {
                        j += 1;
                    }
                    let word = text[i..j].to_ascii_lowercase();
                    let tok = if w.operators.contains(&word) {
                        Token::Operator
                    } else if w.variables.contains(&word) || w.functions.contains(&word) {
                        Token::Predefined
                    } else if w.keywords.contains(&word) {
                        Token::Keyword
                    } else {
                        Token::Identifier
                    };
                    push(i..j, tok, &mut out);
                    i = j;
                    continue;
                }
                if b"<>=!%&+-*/|~^".contains(&c) {
                    push(i..i + 1, Token::Operator, &mut out);
                    i += 1;
                    continue;
                }
                // Unmatched (incl. non-ASCII): one character.
                let len = text[i..].chars().next().map_or(1, char::len_utf8);
                push(i..i + len, Token::Invalid, &mut out);
                i += len;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(t: &str) -> Vec<(&str, Token)> {
        tokenize(t).into_iter().map(|(r, k)| (&t[r], k)).collect()
    }

    #[test]
    fn basic_select() {
        assert_eq!(
            toks("SELECT count(*) FROM t WHERE a = 'x' -- hi"),
            vec![
                ("SELECT", Token::Keyword),
                (" ", Token::White),
                ("count", Token::Predefined),
                ("(", Token::DelimiterParenthesis),
                ("*", Token::Operator),
                (")", Token::DelimiterParenthesis),
                (" ", Token::White),
                ("FROM", Token::Keyword),
                (" ", Token::White),
                ("t", Token::Identifier),
                (" ", Token::White),
                ("WHERE", Token::Keyword),
                (" ", Token::White),
                ("a", Token::Identifier),
                (" ", Token::White),
                ("=", Token::Operator),
                (" ", Token::White),
                ("'x'", Token::String),
                (" ", Token::White),
                ("-- hi", Token::Comment),
            ]
        );
    }

    #[test]
    fn scopes_and_identifiers() {
        let t = toks("case when \"A\"\"b\" then 1.5e3 end");
        assert_eq!(t[0], ("case", Token::KeywordBlock));
        assert_eq!(t[2], ("when", Token::KeywordChoice));
        assert!(t.contains(&("1.5e3", Token::Number)));
        assert!(t.contains(&("A\"\"b", Token::Identifier)));
        assert_eq!(toks("and")[0].1, Token::Operator);
    }
}
