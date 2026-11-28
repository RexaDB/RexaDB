//! Port of components/studio/monaco-sql-input.tsx: the Monaco SQL editor —
//! gpui-component's editor engine dressed as Monaco with the original's
//! options (`minimap: false`, `wordWrap: "off"`, `padding: { top: 16, bottom: 16 }`,
//! `lineNumbersMinChars: 2`, `glyphMargin: false`, `folding: false`,
//! `scrollBeyondLastLine: false`), the theme's editor colors, Monaco's SQL
//! grammar for highlighting, the schema-aware completion provider, the
//! shortcuts it registers (Cmd+Enter, Cmd+Shift+Enter, Cmd+S, Cmd+Shift+C,
//! Shift+Alt+F), the `/` AI trigger, the placeholder overlay and the
//! `Ln x, Col y` status bar.
//!
//! Find / replace (`sql-query-find.tsx` covers the textarea engine; Monaco has
//! its own find widget) is the engine's search panel (Cmd+F / Cmd+Shift+F).
//! Multi-cursor: Cmd+Alt+↑/↓ (Monaco's add-cursor shortcuts) come from the engine.

use crate::completion::SqlCompletionProvider;
use crate::editor_theme::CompiledTheme;
use crate::highlight::{MonacoSqlHighlighter, SharedTheme};
use crate::suggestions::SchemaEntry;
use gpui::{
    actions, div, prelude::*, px, AnyElement, App, Bounds, Context, Element, ElementId, Entity, EventEmitter,
    FocusHandle, Focusable, GlobalElementId, Hsla, InspectorElementId, KeyBinding, LayoutId, Pixels, SharedString,
    Subscription, Window,
};
use gpui_base::input::InputEditorStyle;
use gpui_component::input::{Editor, EditorState, Enter, Escape, InputEvent, RopeExt, ToggleCodeActions};
use rexa_ui::{with_alpha, ActiveTokens, Tw, MONO};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

actions!(sql_editor, [SaveSnippet, CopyQuery, FormatQuery]);

const CONTEXT: &str = "MonacoSqlInput";

pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("cmd-s", SaveSnippet, Some(CONTEXT)),
        KeyBinding::new("cmd-shift-c", CopyQuery, Some(CONTEXT)),
        KeyBinding::new("shift-alt-f", FormatQuery, Some(CONTEXT)),
    ]);
}

#[derive(Clone, Debug)]
pub enum MonacoEvent {
    /// `onChange(value)`
    Changed(String),
    /// Cmd+Enter (runs the selection when there is one, like the original's action).
    Run { selection: bool },
    /// Cmd+Shift+Enter
    RunSelected,
    SaveSnippet,
    CopyQuery,
    Format,
    RequestAiMode,
    ExitAiMode,
    /// Cmd+. inside the editor (the engine binds it to code actions).
    Stop,
}

pub struct MonacoSqlInput {
    pub state: Entity<EditorState>,
    theme: SharedTheme,
    pub db_type: String,
    pub font_size: f32,
    pub font_family: SharedString,
    pub placeholder: SharedString,
    pub read_only: bool,
    pub slash_ai_trigger: bool,
    pub schema: Rc<RefCell<Vec<SchemaEntry>>>,
    ai_mode: Rc<Cell<bool>>,
    /// Text we set ourselves, so the resulting Change isn't echoed back.
    suppress_change: bool,
    _subs: Vec<Subscription>,
}

impl EventEmitter<MonacoEvent> for MonacoSqlInput {}

impl Focusable for MonacoSqlInput {
    fn focus_handle(&self, cx: &App) -> FocusHandle {
        self.state.read(cx).focus_handle(cx)
    }
}

impl MonacoSqlInput {
    pub fn new(
        db_type: &str,
        value: &str,
        theme: CompiledTheme,
        font_size: f32,
        font_family: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let theme: SharedTheme = Rc::new(RefCell::new(theme));
        let plain = db_type == "redis";
        let language = match db_type {
            "mongodb" => "javascript",
            "redis" => "plaintext",
            _ => "sql",
        };
        let schema = Rc::new(RefCell::new(Vec::new()));
        let ai_mode = Rc::new(Cell::new(false));
        let state = cx.new(|cx| {
            let mut s = EditorState::new(window, cx)
                .language(language)
                .line_number(true)
                .folding(false)
                .soft_wrap(false)
                .searchable(true)
                .scroll_beyond_last_line(None)
                .default_value(value.to_string());
            if language != "javascript" {
                s.set_highlighter_factory(MonacoSqlHighlighter::factory(theme.clone(), plain), cx);
            }
            s.lsp_mut().completion_provider = Some(Rc::new(SqlCompletionProvider {
                schema: schema.clone(),
                db_type: db_type.to_string(),
                ai_mode: ai_mode.clone(),
            }));
            s
        });
        let subs = vec![
            cx.subscribe(&state, |this: &mut Self, state, ev: &InputEvent, cx| {
                if let InputEvent::Change = ev {
                    if this.suppress_change {
                        return;
                    }
                    let value = state.read(cx).value().to_string();
                    cx.emit(MonacoEvent::Changed(value));
                }
                cx.notify();
            }),
            cx.observe(&state, |_, _, cx| cx.notify()),
        ];
        MonacoSqlInput {
            state,
            theme,
            db_type: db_type.to_string(),
            font_size,
            // Monaco's default font on macOS: Menlo.
            font_family: font_family.map(SharedString::from).unwrap_or_else(|| MONO.into()),
            placeholder: SharedString::default(),
            read_only: false,
            slash_ai_trigger: true,
            schema,
            ai_mode,
            suppress_change: false,
            _subs: subs,
        }
    }

    pub fn value(&self, cx: &App) -> String {
        self.state.read(cx).value().to_string()
    }

    /// `editor.setValue(query)` when the model differs (keeps the caret at the end).
    pub fn set_value(&mut self, value: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.state.read(cx).value().as_ref() == value {
            return;
        }
        self.suppress_change = true;
        self.state.update(cx, |s, cx| s.set_value(value.to_string(), window, cx));
        self.suppress_change = false;
        cx.notify();
    }

    pub fn set_theme(&mut self, theme: CompiledTheme, cx: &mut Context<Self>) {
        *self.theme.borrow_mut() = theme;
        self.state.update(cx, |_, cx| cx.notify());
        cx.notify();
    }

    pub fn set_ai_mode(&mut self, on: bool) {
        self.ai_mode.set(on);
    }

    pub fn set_schema(&mut self, entries: Vec<SchemaEntry>) {
        *self.schema.borrow_mut() = entries;
    }

    /// The selected text (`model.getValueInRange(selection)`), empty when none.
    pub fn selected_text(&self, cx: &App) -> String {
        let s = self.state.read(cx);
        let r = s.selected_range();
        if r.is_empty() {
            return String::new();
        }
        s.text().slice(r).to_string()
    }

    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        self.state.update(cx, |s, cx| s.focus(window, cx));
    }

    fn line_height(&self) -> f32 {
        // Monaco on macOS: lineHeight = round(fontSize * 1.5).
        (self.font_size * 1.5).round()
    }
}

impl Render for MonacoSqlInput {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let theme = self.theme.borrow().clone();
        let dark = theme.base.is_dark();
        let color = |k: &str, f: Hsla| theme.color(k).unwrap_or(f);
        let background = color("editor.background", t.studio_bg);
        let foreground = color("editor.foreground", t.foreground);
        let style = InputEditorStyle {
            foreground: color("editorLineNumber.activeForeground", foreground),
            muted_foreground: color("editorLineNumber.foreground", t.muted_foreground),
            background,
            border: t.border,
            selection: color("editor.selectionBackground", t.studio_selection),
            caret: color("editorCursor.foreground", foreground),
            editor_active_line: theme.color("editor.lineHighlightBackground"),
            editor_gutter_background: Some(color("editorGutter.background", background)),
            highlight_styles: std::sync::Arc::new(NoStyles),
            ..Default::default()
        };
        let _ = dark;

        let (line, col, selection_size) = {
            let s = self.state.read(cx);
            let pos = s.text().offset_to_position(s.cursor());
            let r = s.selected_range();
            let sel = (!r.is_empty()).then(|| s.text().slice(r).to_string().encode_utf16().count());
            (pos.line + 1, pos.character + 1, sel)
        };
        let empty = self.state.read(cx).value().trim().is_empty();
        let lh = self.line_height();
        let entity = cx.entity();

        let editor = Editor::new(&self.state)
            .appearance(false)
            .bordered(false)
            .readonly(self.read_only)
            .font_family(self.font_family.clone())
            .text_size(px(self.font_size))
            .line_height(px(lh))
            .text_color(foreground)
            .h_full();

        let language_label = match self.db_type.as_str() {
            "mongodb" => "JavaScript",
            "redis" => "Plain",
            _ => "SQL",
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .relative()
                    .flex_1()
                    .min_h_0()
                    .bg(background)
                    .key_context(CONTEXT)
                    .capture_action({
                        let entity = entity.clone();
                        move |action: &Enter, _window, cx| {
                            if !action.secondary {
                                return;
                            }
                            cx.stop_propagation();
                            entity.update(cx, |this, cx| {
                                if action.shift {
                                    cx.emit(MonacoEvent::RunSelected);
                                } else {
                                    let selection = !this.state.read(cx).selected_range().is_empty();
                                    cx.emit(MonacoEvent::Run { selection });
                                }
                            });
                        }
                    })
                    .capture_action({
                        let entity = entity.clone();
                        move |_: &ToggleCodeActions, _window, cx| {
                            cx.stop_propagation();
                            entity.update(cx, |_, cx| cx.emit(MonacoEvent::Stop));
                        }
                    })
                    .capture_action({
                        let entity = entity.clone();
                        move |_: &Escape, _window, cx| {
                            // Handled here so Escape still reaches the engine's widgets otherwise.
                            let exit = entity.read(cx).ai_mode.get() && entity.read(cx).value(cx).trim().is_empty();
                            if exit {
                                cx.stop_propagation();
                                entity.update(cx, |_, cx| cx.emit(MonacoEvent::ExitAiMode));
                            }
                        }
                    })
                    .capture_key_down({
                        let entity = entity.clone();
                        move |ev, _window, cx| {
                            let k = &ev.keystroke;
                            if k.key == "enter" && k.modifiers.platform && k.modifiers.shift {
                                // cmd-shift-enter isn't bound by the engine; handled as RunSelected.
                                cx.stop_propagation();
                                entity.update(cx, |_, cx| cx.emit(MonacoEvent::RunSelected));
                                return;
                            }
                            // `/` on an empty editor enters AI mode (ACTIVATE_AI_MODE).
                            let this = entity.read(cx);
                            let should = this.slash_ai_trigger && !this.ai_mode.get() && this.value(cx).trim().is_empty();
                            if should
                                && k.key_char.as_deref() == Some("/")
                                && !k.modifiers.platform
                                && !k.modifiers.control
                                && !k.modifiers.alt
                            {
                                cx.stop_propagation();
                                entity.update(cx, |_, cx| cx.emit(MonacoEvent::RequestAiMode));
                            }
                        }
                    })
                    .on_action(cx.listener(|_, _: &SaveSnippet, _, cx| cx.emit(MonacoEvent::SaveSnippet)))
                    .on_action(cx.listener(|_, _: &CopyQuery, _, cx| cx.emit(MonacoEvent::CopyQuery)))
                    .on_action(cx.listener(|_, _: &FormatQuery, _, cx| cx.emit(MonacoEvent::Format)))
                    .child(EditorFrame {
                        child: Some(editor.into_any_element()),
                        state: self.state.clone(),
                        style,
                        // Monaco: padding top/bottom 16. The engine draws the gutter
                        // from `left`; Monaco's content starts 26px in for two digits
                        // (16px numbers + 10px decorations); the engine reserves three
                        // digits + 6px, so pull the gutter left to land the text there.
                        paddings: gpui::Edges { top: px(16.), bottom: px(16.), left: px(-10.), right: px(0.) },
                    })
                    .when(empty && !self.placeholder.is_empty(), |el| {
                        // pointer-events-none absolute inset-y-0 left-[12px] right-0 z-10 px-4 py-4
                        // font-mono text-sm leading-[21px] text-muted-foreground/45
                        el.child(
                            div()
                                .absolute()
                                .top_0()
                                .bottom_0()
                                .left(px(12.))
                                .right_0()
                                .px_4()
                                .py_4()
                                .font_family(MONO)
                                .text_size(px(14.))
                                .line_height(px(21.))
                                .text_color(with_alpha(t.muted_foreground, 0.45))
                                .child(self.placeholder.clone()),
                        )
                    }),
            )
            .child(
                // h-5 text-xs font-mono px-2 flex items-center justify-between
                // text-muted-foreground/60 border-t border-border bg-studio-bg/80
                div()
                    .h_5()
                    .flex_shrink_0()
                    .tw_text_xs()
                    .font_family(MONO)
                    .px_2()
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_color(with_alpha(t.muted_foreground, 0.6))
                    .border_t_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.studio_bg, 0.8))
                    .child(div().flex().items_center().gap_1())
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .when(self.read_only, |d| {
                                d.child(
                                    div()
                                        .text_color(with_alpha(rexa_ui::tw("amber-500"), 0.7))
                                        .font_weight(gpui::FontWeight::SEMIBOLD)
                                        .child("READ-ONLY"),
                                )
                            })
                            .children(selection_size.map(|n| div().child(format!("{n} chars selected"))))
                            .child(div().child(format!("Ln {line}, Col {col}")))
                            .child(div().opacity(0.6).child(language_label.to_uppercase())),
                    ),
            )
    }
}

struct NoStyles;
impl gpui_component::input::HighlightStyleResolver for NoStyles {
    fn style(&self, _: &str) -> Option<gpui::HighlightStyle> {
        None
    }
}

/// Wraps the engine's `Input` and re-projects our Monaco colors and paddings
/// onto the editor state after `Input` has projected gpui-component's theme
/// (it does so on every render, during layout), and before prepaint/paint
/// read them.
struct EditorFrame {
    child: Option<AnyElement>,
    state: Entity<EditorState>,
    style: InputEditorStyle,
    paddings: gpui::Edges<Pixels>,
}

impl IntoElement for EditorFrame {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for EditorFrame {
    type RequestLayoutState = AnyElement;
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, AnyElement) {
        let mut child = self.child.take().expect("EditorFrame laid out twice");
        let id = child.request_layout(window, cx);
        let (style, paddings) = (self.style.clone(), self.paddings);
        self.state.update(cx, |s, _| {
            s.set_editor_style(style);
            s.set_editor_paddings(paddings);
        });
        (id, child)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        child: &mut AnyElement,
        window: &mut Window,
        cx: &mut App,
    ) {
        child.prepaint(window, cx);
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _bounds: Bounds<Pixels>,
        child: &mut AnyElement,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        child.paint(window, cx);
    }
}
