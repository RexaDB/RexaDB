//! Port of components/studio/settings/credential-storage-setting.tsx: the
//! keychain / encrypted vault / plaintext choice, stored under
//! `rexadb:credential-storage-mode` (localStorage in the old app → app_settings).

use crate::view::SettingsView;
use gpui::{div, prelude::*, px, AnyElement, Context, FontWeight};
use gpui_component::Icon;
use rexa_store::CredentialStorageMode;
use rexa_ui::{close_top, open_dialog, with_alpha, ActiveTokens, Button, ButtonSize, Dialog, IconName, Tw};

pub const MODE_KEY: &str = "rexadb:credential-storage-mode";

fn mode_str(m: &CredentialStorageMode) -> &'static str {
    match m {
        CredentialStorageMode::Keychain => "keychain",
        CredentialStorageMode::Vault => "vault",
        CredentialStorageMode::Plaintext => "plaintext",
    }
}

/// applyMode: persist and report. The old app's next `getConnections` call
/// re-protects saved credentials under the new mode; connections saved or
/// edited from now on use it here too (rexa-store reads the same key).
fn apply_mode(view: gpui::WeakEntity<SettingsView>, mode: CredentialStorageMode, cx: &mut gpui::App) {
    let ok = crate::persist::local_set(MODE_KEY, mode_str(&mode)).is_ok();
    view.update(cx, |v, cx| {
        v.credential_mode = mode;
        cx.notify();
    })
    .ok();
    if ok {
        rexa_ui::toast::success("Credential storage updated; saved connections are being migrated.", cx);
    } else {
        rexa_ui::toast::error("Could not migrate saved credentials to the selected storage.", cx);
    }
}

pub fn render_credential_storage(view: &SettingsView, cx: &mut Context<SettingsView>) -> AnyElement {
    let t = cx.tokens().clone();
    let mode = view.credential_mode.clone();
    let weak = cx.entity().downgrade();
    let btn = |id: &'static str, label: &'static str, active: bool, destructive: bool| {
        let b = Button::new(id).size(ButtonSize::Sm).label(label);
        if active && destructive {
            b.destructive()
        } else if active {
            b.secondary()
        } else {
            b.outline()
        }
    };
    let (w1, w2, w3) = (weak.clone(), weak.clone(), weak.clone());
    let description = match mode {
        CredentialStorageMode::Plaintext => "Passwords and tokens are stored unencrypted in SQLite. Anyone who can read the database, its WAL, or backups can recover them.",
        CredentialStorageMode::Vault => "Credentials are encrypted in SQLite with Argon2id and AES-GCM. A strong passphrase is required and cannot be recovered if forgotten.",
        CredentialStorageMode::Keychain => "Credentials are stored in the operating-system keychain; SQLite keeps only a reference. If keychain access fails, choose the encrypted vault.",
    };
    div()
        .flex()
        .flex_col()
        .gap_3()
        .p_4()
        .tw_rounded_xl()
        .border_1()
        .border_color(t.studio_border)
        .bg(with_alpha(t.studio_bg, 0.5))
        .when(view.hl("credential-storage"), |d| d.border_2().border_color(with_alpha(t.primary, 0.5)))
        .child(
            div()
                .flex()
                .items_start()
                .gap_2()
                .child(div().mt(px(2.)).child(Icon::new(IconName::ShieldCheck).size_4().text_color(t.muted_foreground)))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Connection Credential Storage"))
                        .child(div().tw_text_xs().text_color(t.muted_foreground).child("Choose how saved passwords and tokens are protected.")),
                ),
        )
        .child(
            div()
                .flex()
                .flex_wrap()
                .gap_2()
                .child(btn("cred-keychain", "System keychain", mode == CredentialStorageMode::Keychain, false).on_click(move |_, _, cx| {
                    apply_mode(w1.clone(), CredentialStorageMode::Keychain, cx)
                }))
                .child(btn("cred-vault", "Encrypted local vault", mode == CredentialStorageMode::Vault, false).on_click(move |_, _, cx| {
                    apply_mode(w2.clone(), CredentialStorageMode::Vault, cx)
                }))
                .child(btn("cred-plaintext", "Plaintext (unsafe)", mode == CredentialStorageMode::Plaintext, true).on_click(move |_, _, cx| {
                    let w = w3.clone();
                    open_dialog(cx, move |_, _| {
                        let w = w.clone();
                        Dialog::new()
                            .title("Store credentials in plaintext?")
                            .description("Database passwords and tokens will be readable in sqlite.db, its write-ahead log, and new backups. Use this only if you accept that exposure.")
                            .footer(Button::new("plain-cancel").outline().label("Cancel").on_click(|_, _, cx| close_top(cx)))
                            .footer(Button::new("plain-ok").destructive().label("I understand\u{2014}store in plaintext").on_click(move |_, _, cx| {
                                close_top(cx);
                                apply_mode(w.clone(), CredentialStorageMode::Plaintext, cx);
                            }))
                    });
                })),
        )
        .child(
            div()
                .tw_text_xs()
                .text_color(if mode == CredentialStorageMode::Plaintext { t.destructive } else { t.muted_foreground })
                .child(description),
        )
        .child(div().tw_text_xs().text_color(t.muted_foreground).child("Backups made before migration may still contain plaintext secrets; rotate or delete them."))
        .into_any_element()
}
