//! Port of components/providers/credential-vault-prompt.tsx (`CredentialVaultPrompt`):
//! the setup / unlock dialog for the encrypted credential vault, used when a
//! connection is saved with "Encrypted vault" storage or a `vault:` credential is
//! opened. Validation and texts follow the original; `on_passphrase` derives or
//! unlocks the vault and returns an error message to show inline.

use gpui::{div, prelude::*, App, Entity, SharedString, Window};
use rexa_ui::widgets::InputState;
use rexa_ui::{ActiveTokens, Button, Dialog, Label, PasswordInput, Tw};
use std::rc::Rc;

type Submit = Rc<dyn Fn(String, &mut Window, &mut App) -> Result<(), String>>;

/// Open the prompt. `setup` = no vault exists yet ("Create encrypted credential vault").
pub fn open(setup: bool, cx: &mut App, on_passphrase: impl Fn(String, &mut Window, &mut App) -> Result<(), String> + 'static) {
    let submit: Submit = Rc::new(on_passphrase);
    // Fresh keyed state per prompt.
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    rexa_ui::open_dialog(cx, move |window, cx| {
        let key = |name: &str| SharedString::from(format!("vault-prompt-{nonce}-{name}"));
        let pass: Entity<InputState> = window.use_keyed_state(key("pass"), cx, |w, cx| InputState::new(w, cx).masked(true));
        let confirm: Entity<InputState> = window.use_keyed_state(key("confirm"), cx, |w, cx| InputState::new(w, cx).masked(true));
        let error: Entity<Option<String>> = window.use_keyed_state(key("error"), cx, |_, _| None);
        let t = cx.tokens().clone();
        let message = error.read(cx).clone();
        let (p, c, e, s) = (pass.clone(), confirm.clone(), error.clone(), submit.clone());
        let on_submit = move |window: &mut Window, cx: &mut App| {
            let passphrase = p.read(cx).value().to_string();
            let confirmation = c.read(cx).value().to_string();
            let fail = |msg: &str, cx: &mut App| e.update(cx, |v, cx| {
                *v = Some(msg.to_string());
                cx.notify();
            });
            if setup && passphrase.chars().count() < 12 {
                return fail("Use at least 12 characters.", cx);
            }
            if setup && passphrase != confirmation {
                return fail("The passphrases do not match.", cx);
            }
            if passphrase.is_empty() {
                return fail("Enter the vault passphrase.", cx);
            }
            match s(passphrase, window, cx) {
                Ok(()) => rexa_ui::close_top(cx),
                Err(msg) => fail(&msg, cx),
            }
        };
        let on_submit = Rc::new(on_submit);
        let submit_btn = on_submit.clone();
        Dialog::new()
            .title(if setup { "Create encrypted credential vault" } else { "Unlock credential vault" })
            .description(if setup {
                "Credentials will be encrypted in SQLite with Argon2id and AES-GCM. Choose a strong passphrase; it cannot be recovered if forgotten."
            } else {
                "Enter your vault passphrase. It stays in memory for this app session and is never saved."
            })
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(div().flex().flex_col().gap_2().child(Label::new("Vault passphrase")).child(PasswordInput::new(key("pass-input"), &pass)))
                    .when(setup, |d| d.child(div().flex().flex_col().gap_2().child(Label::new("Confirm passphrase")).child(PasswordInput::new(key("confirm-input"), &confirm))))
                    .when_some(message, |d, m| d.child(div().tw_text_sm().text_color(t.destructive).child(m)))
                    .on_key_down(move |ev, window, cx| {
                        if ev.keystroke.key == "enter" {
                            on_submit(window, cx);
                        }
                    }),
            )
            .footer(Button::new("vault-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
            .footer(Button::new("vault-submit").label(if setup { "Create vault" } else { "Unlock" }).on_click(move |_, window, cx| submit_btn(window, cx)))
    });
}
