//! Port of components/studio/database/backup-restore-view.tsx and
//! `runDbBackup` (lib/db/actions-core.ts): the studio's
//! `View { view: "database-backup-restore" }` tab.
//!
//! Backups shell out to `pg_dump` (Postgres, password via PGPASSWORD) and
//! `mysqldump` (MySQL, MYSQL_PWD). Like the original, Restore only explains
//! that pg_restore / mysql must be run manually.
//!
//! Deviations (documented): with no output path the dump goes to
//! `~/Downloads/<db>_backup.<ext>` (the sidecar wrote it relative to its own
//! working directory), and mysqldump output is written to that file (the
//! original returned it in the response and dropped it).

use gpui::{div, percentage, prelude::*, px, Animation, AnimationExt, App, AppContext, Context, Entity, FontWeight, Window};
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_drivers::Kind;
use rexa_ui::widgets::{Icon, InputState};
use rexa_ui::{tight, tw, with_alpha, ActiveTokens, Button, ButtonSize, DropdownMenu, IconName, Label, MenuItem, Select, SelectOption, Switch, TextInput, Toast, Tw};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone, Copy, PartialEq)]
enum Section {
    Backup,
    Restore,
}

#[derive(Clone, Default)]
pub struct BackupOptions {
    pub format: String,
    pub schema_only: bool,
    pub data_only: bool,
    pub compress: Option<u32>,
    pub output_path: Option<String>,
}

struct PgParts {
    host: String,
    port: u16,
    user: String,
    password: String,
    database: String,
}

/// `getPgHost` / `getPgPort` / `getPgUsername` / `getPgPassword` / `getPgDatabase`.
fn pg_parts(cs: &str) -> PgParts {
    let url = url::Url::parse(cs.trim()).ok();
    let dec = |s: &str| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned();
    PgParts {
        host: url.as_ref().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "localhost".into()),
        port: url.as_ref().and_then(|u| u.port()).unwrap_or(5432),
        user: url.as_ref().map(|u| dec(u.username())).unwrap_or_default(),
        password: url.as_ref().and_then(|u| u.password().map(dec)).unwrap_or_default(),
        database: url.as_ref().map(|u| dec(u.path().trim_start_matches('/'))).filter(|d| !d.is_empty()).unwrap_or_else(|| "postgres".into()),
    }
}

fn default_output(database: &str, ext: &str) -> String {
    let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
    dir.join(format!("{database}_backup.{ext}")).display().to_string()
}

/// `runDbBackup` → output path.
pub async fn run_db_backup(kind: Kind, cs: &str, o: &BackupOptions) -> anyhow::Result<String> {
    match kind {
        Kind::Postgres => {
            let bin = crate::transfer::apply::resolve_pg_dump_binary().ok_or_else(|| anyhow::anyhow!("pg_dump not found. Install PostgreSQL tools."))?;
            let p = pg_parts(cs);
            let format = if o.format.is_empty() { "custom" } else { o.format.as_str() };
            let ext = match format {
                "plain" => "sql",
                "tar" => "tar",
                "directory" => "dir",
                _ => "dump",
            };
            let out = o.output_path.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default_output(&p.database, ext));
            let mut args = vec![
                format!("--host={}", p.host),
                format!("--port={}", p.port),
                format!("--username={}", p.user),
                format!("--dbname={}", p.database),
                format!("--format={format}"),
                format!("--file={out}"),
            ];
            if o.schema_only {
                args.push("--schema-only".into());
            }
            if o.data_only {
                args.push("--data-only".into());
            }
            if let Some(c) = o.compress.filter(|c| *c > 0) {
                args.push(format!("--compress={c}"));
            }
            let mut cmd = tokio::process::Command::new(bin);
            cmd.args(&args);
            if !p.password.is_empty() {
                cmd.env("PGPASSWORD", &p.password);
            }
            let res = tokio::time::timeout(Duration::from_secs(600), cmd.output()).await.map_err(|_| anyhow::anyhow!("pg_dump timed out"))??;
            if !res.status.success() {
                anyhow::bail!("{}", String::from_utf8_lossy(&res.stderr).trim());
            }
            Ok(out)
        }
        Kind::MySql => {
            let p = pg_parts(cs);
            let mut args = vec![format!("--host={}", p.host), format!("--port={}", url::Url::parse(cs).ok().and_then(|u| u.port()).unwrap_or(3306)), format!("--user={}", p.user), p.database.clone()];
            if o.data_only {
                args.insert(0, "--no-create-info".into());
            }
            if o.schema_only {
                args.insert(0, "--no-data".into());
            }
            let mut cmd = tokio::process::Command::new("mysqldump");
            cmd.args(&args);
            if !p.password.is_empty() {
                cmd.env("MYSQL_PWD", &p.password);
            }
            let res = tokio::time::timeout(Duration::from_secs(600), cmd.output()).await.map_err(|_| anyhow::anyhow!("mysqldump timed out"))??;
            if !res.status.success() {
                anyhow::bail!("{}", String::from_utf8_lossy(&res.stderr).trim());
            }
            let out = o.output_path.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default_output(&p.database, "sql"));
            std::fs::write(&out, &res.stdout)?;
            Ok(out)
        }
        other => anyhow::bail!("Backup not supported for {}.", other.as_str()),
    }
}

pub struct BackupRestoreView {
    session: Arc<Session>,
    section: Section,
    backing_up: bool,
    format: String,
    schema_only: bool,
    data_only: bool,
    compress: u32,
    output: Entity<InputState>,
    restore_file: Entity<InputState>,
    last_backup: Option<String>,
}

impl BackupRestoreView {
    fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let output = cx.new(|cx| InputState::new(window, cx).placeholder("e.g., /tmp/my_db_backup.dump"));
        let restore_file = cx.new(|cx| InputState::new(window, cx).placeholder("e.g., /tmp/my_db_backup.dump"));
        cx.observe(&restore_file, |_, _, cx| cx.notify()).detach();
        Self { session, section: Section::Backup, backing_up: false, format: "custom".into(), schema_only: false, data_only: false, compress: 9, output, restore_file, last_backup: None }
    }

    fn db_type(&self) -> &'static str {
        self.session.driver.kind().as_str()
    }

    fn supported(&self) -> bool {
        matches!(self.session.driver.kind(), Kind::Postgres | Kind::MySql)
    }

    fn backup(&mut self, cx: &mut Context<Self>) {
        let opts = BackupOptions {
            format: self.format.clone(),
            schema_only: self.schema_only,
            data_only: self.data_only,
            compress: Some(self.compress),
            output_path: Some(self.output.read(cx).value().to_string()),
        };
        let conn = self.session.connection.clone();
        let kind = self.session.driver.kind();
        let vault = rexa_core::credential_vault(cx);
        self.backing_up = true;
        cx.notify();
        let task = runtime::spawn(async move {
            let creds = tokio::task::spawn_blocking(move || rexa_store::resolve_credentials(&conn, vault.as_deref())).await??;
            run_db_backup(kind, &creds.connection_string, &opts).await
        });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                this.backing_up = false;
                match r {
                    Ok(path) => {
                        this.last_backup = Some(path);
                        Toast::success("Backup completed successfully").show(cx);
                    }
                    Err(e) => {
                        let msg = format!("{e:#}");
                        Toast::error(if msg.is_empty() { "Backup failed".into() } else { msg }).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn browse(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let current = self.output.read(cx).value().to_string();
        let dir = std::path::Path::new(&current).parent().filter(|p| p.is_dir()).map(|p| p.to_path_buf()).unwrap_or_else(|| {
            std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default()
        });
        let name = std::path::Path::new(&current).file_name().map(|n| n.to_string_lossy().into_owned());
        let prompt = cx.prompt_for_new_path(&dir, name.as_deref());
        cx.spawn_in(window, async move |this, cx| {
            if let Ok(Ok(Some(path))) = prompt.await {
                let value = path.display().to_string();
                this.update_in(cx, |this, window, cx| {
                    this.output.update(cx, |s, cx| s.set_value(value, window, cx));
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }
}

fn spin(size: f32) -> impl IntoElement {
    Icon::new(IconName::LoaderCircle).size(px(size)).with_animation("backup-spin", Animation::new(Duration::from_secs(1)).repeat(), |i, t| i.rotate(percentage(t)))
}

impl Render for BackupRestoreView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let db_type = self.db_type();
        let db_label = if db_type == "postgres" { "PostgreSQL".to_string() } else { db_type.to_uppercase() };
        let amber = tw("amber-500");
        let supported = self.supported();
        let this = cx.entity().downgrade();
        let section = self.section;
        let header = |icon: IconName, icon_bg: gpui::Hsla, icon_fg: gpui::Hsla, desc: &'static str| {
            let this = this.clone();
            div()
                .flex()
                .items_center()
                .gap_3()
                .child(div().size_9().flex_shrink_0().tw_rounded_lg().bg(icon_bg).text_color(icon_fg).flex().items_center().justify_center().child(Icon::new(icon).size_4()))
                .child(
                    div()
                        .child(
                            DropdownMenu::new("backup-section")
                                .trigger(
                                    div()
                                        .id("backup-section-trigger")
                                        .flex()
                                        .items_center()
                                        .gap(px(2.))
                                        .tw_text_sm()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(t.foreground)
                                        .cursor_pointer()
                                        .child(if section == Section::Backup { "Backup" } else { "Restore" })
                                        .child(Icon::new(IconName::ChevronDown).size_3().text_color(t.muted_foreground)),
                                )
                                .menu(move |m, _, _| {
                                    let (a, b) = (this.clone(), this.clone());
                                    m.item(MenuItem::new("Backup").on_select(move |_, cx| {
                                        a.update(cx, |s, cx| {
                                            s.section = Section::Backup;
                                            cx.notify();
                                        })
                                        .ok();
                                    }))
                                    .item(MenuItem::new("Restore").on_select(move |_, cx| {
                                        b.update(cx, |s, cx| {
                                            s.section = Section::Restore;
                                            cx.notify();
                                        })
                                        .ok();
                                    }))
                                }),
                        )
                        .child(div().tw_text_xs().text_color(t.muted_foreground).child(desc)),
                )
        };
        let warn = |text: &'static str| {
            div()
                .flex()
                .items_center()
                .gap_2()
                .p_2()
                .bg(with_alpha(amber, 0.05))
                .border_1()
                .border_color(with_alpha(amber, 0.2))
                .tw_rounded_lg()
                .tw_text_xs()
                .text_color(amber)
                .child(Icon::new(IconName::TriangleAlert).size_3().flex_shrink_0())
                .child(div().min_w_0().flex_1().child(text))
        };
        let card = || div().flex().flex_col().gap_5().bg(with_alpha(t.background, 0.4)).border_1().border_color(t.studio_border).tw_rounded_lg().p_6();

        let body = if section == Section::Backup {
            let mut formats = vec![
                SelectOption::new("custom", "Custom (.dump) - compressed, flexible"),
                SelectOption::new("plain", "Plain SQL (.sql)"),
                SelectOption::new("tar", "Tar archive (.tar)"),
            ];
            if db_type == "postgres" {
                formats.push(SelectOption::new("directory", "Directory (directory format)"));
            }
            let (f1, f2, f3, f4) = (this.clone(), this.clone(), this.clone(), this.clone());
            let stepper_btn = |id: &'static str, label: &'static str, left: bool, f: Box<dyn Fn(&mut BackupRestoreView)>| {
                let this = this.clone();
                div()
                    .id(id)
                    .h_8()
                    .w_7()
                    .flex()
                    .items_center()
                    .justify_center()
                    .border_1()
                    .border_color(t.input)
                    .when(left, |d| d.border_r_0().rounded_l(px(6.)))
                    .when(!left, |d| d.border_l_0().rounded_r(px(6.)))
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .hover(|s| s.text_color(t.foreground).bg(with_alpha(t.accent, 0.5)))
                    .cursor_pointer()
                    .on_click(move |_, _, cx| {
                        this.update(cx, |s, cx| {
                            f(s);
                            cx.notify();
                        })
                        .ok();
                    })
                    .child(label)
            };
            card()
                .child(header(IconName::Download, with_alpha(t.primary, 0.1), t.primary, "Export database to a file"))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(
                            div()
                                .flex()
                                .gap_4()
                                .child(
                                    div().flex_1().flex().flex_col().gap_2().child(div().tw_text_xs().text_color(t.muted_foreground).child(Label::new("Format"))).child(
                                        Select::new("backup-format").small().w_full().options(formats).value(Some(self.format.clone())).on_change(move |v, _, cx| {
                                            f1.update(cx, |s, cx| {
                                                s.format = v.to_string();
                                                cx.notify();
                                            })
                                            .ok();
                                        }),
                                    ),
                                )
                                .when(self.format != "plain", |d| {
                                    d.child(
                                        div().flex().flex_col().gap_2().child(div().tw_text_xs().text_color(t.muted_foreground).child(Label::new("Compression (0-9)"))).child(
                                            div()
                                                .flex()
                                                .child(stepper_btn("compress-dec", "−", true, Box::new(|s| s.compress = s.compress.saturating_sub(1))))
                                                .child(
                                                    div()
                                                        .h_8()
                                                        .w_10()
                                                        .flex()
                                                        .items_center()
                                                        .justify_center()
                                                        .border_1()
                                                        .border_color(t.input)
                                                        .font_family(rexa_ui::MONO)
                                                        .tw_text_xs()
                                                        .child(self.compress.to_string()),
                                                )
                                                .child(stepper_btn("compress-inc", "+", false, Box::new(|s| s.compress = (s.compress + 1).min(9)))),
                                        ),
                                    )
                                }),
                        )
                        .child(
                            div().flex().flex_col().gap_2().child(div().tw_text_xs().text_color(t.muted_foreground).child(Label::new("Output Path (optional)"))).child(
                                div()
                                    .flex()
                                    .gap_2()
                                    .child(div().flex_1().child(TextInput::new(&self.output).h(32.)))
                                    .child(Button::new("backup-browse").outline().size(ButtonSize::Sm).icon(IconName::FolderOpen).label("Browse").on_click(cx.listener(|this, _, window, cx| this.browse(window, cx)))),
                            ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_6()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(Switch::new("schema-only").checked(self.schema_only).on_change(move |v, _, cx| {
                                            f2.update(cx, |s, cx| {
                                                s.schema_only = v;
                                                if v {
                                                    s.data_only = false;
                                                }
                                                cx.notify();
                                            })
                                            .ok();
                                        }))
                                        .child(div().tw_text_xs().text_color(t.muted_foreground).child("Schema only")),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_2()
                                        .child(Switch::new("data-only").checked(self.data_only).on_change(move |v, _, cx| {
                                            f3.update(cx, |s, cx| {
                                                s.data_only = v;
                                                if v {
                                                    s.schema_only = false;
                                                }
                                                cx.notify();
                                            })
                                            .ok();
                                        }))
                                        .child(div().tw_text_xs().text_color(t.muted_foreground).child("Data only")),
                                ),
                        )
                        .when(!supported, |d| d.child(warn("Backup is only supported for PostgreSQL and MySQL connections."))),
                )
                .child(
                    Button::new("backup-start")
                        .size(ButtonSize::Sm)
                        .w_full()
                        .disabled(self.backing_up || !supported)
                        .when(self.backing_up, |b| b.child(spin(12.)))
                        .when(!self.backing_up, |b| b.icon(IconName::FileArchive))
                        .label(if self.backing_up { "Backing up..." } else { "Start Backup" })
                        .on_click(move |_, _, cx| {
                            f4.update(cx, |s, cx| s.backup(cx)).ok();
                        }),
                )
                .when_some(self.last_backup.clone(), |d, last| {
                    let em = tw("emerald-500");
                    d.child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .p_2()
                            .bg(with_alpha(em, 0.05))
                            .border_1()
                            .border_color(with_alpha(em, 0.2))
                            .tw_rounded_lg()
                            .tw_text_xs()
                            .text_color(em)
                            .child(Icon::new(IconName::CircleCheck).size_3().flex_shrink_0())
                            .child(format!("Last backup: {last}")),
                    )
                })
                .into_any_element()
        } else {
            let can_restore = supported && !self.restore_file.read(cx).value().trim().is_empty();
            card()
                .child(header(IconName::Upload, with_alpha(amber, 0.1), amber, "Import database from a backup file"))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(div().flex().flex_col().gap_2().child(div().tw_text_xs().text_color(t.muted_foreground).child(Label::new("Backup File Path"))).child(TextInput::new(&self.restore_file).h(32.)))
                        .child(warn("Restore will overwrite existing data. Make sure you have a backup before proceeding. Only supports pg_restore compatible files.")),
                )
                .child(
                    div()
                        .id("restore-start")
                        .h_8()
                        .w_full()
                        .flex()
                        .items_center()
                        .justify_center()
                        .gap(px(6.))
                        .tw_rounded_md()
                        .border_1()
                        .border_color(with_alpha(amber, 0.3))
                        .tw_text_xs()
                        .text_color(amber)
                        .when(!can_restore, |d| d.opacity(0.5))
                        .when(can_restore, |d| {
                            d.cursor_pointer().hover(|s| s.bg(with_alpha(amber, 0.1)).border_color(with_alpha(amber, 0.5))).on_click(|_, _, cx| {
                                Toast::info("Restore functionality requires pg_restore/mysql CLI. Manual restore recommended.").show(cx);
                            })
                        })
                        .child(Icon::new(IconName::Upload).size_3())
                        .child("Start Restore"),
                )
                .into_any_element()
        };

        div().id("backup-restore").size_full().overflow_y_scroll().bg(t.studio_bg).child(
            div()
                .mx_auto()
                .w_full()
                .max_w(px(1024.))
                .p_8()
                .flex()
                .flex_col()
                .gap_10()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().tw_text_sm().font_weight(FontWeight::BOLD).text_color(t.foreground).child(tight("Backup & Restore")))
                        .child(div().tw_text_sm().text_color(t.muted_foreground).child(format!("Create and restore database backups for {db_label}."))),
                )
                .child(body),
        )
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(cx, "rexa-features-backup", |spec, session, window, cx| {
        let TabSpec::View { view, .. } = spec else { return None };
        if view != "database-backup-restore" {
            return None;
        }
        Some(cx.new(|cx| BackupRestoreView::new(session, window, cx)).into())
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pg_parts() {
        let p = pg_parts("postgres://me:p%40ss@db.local:6543/app?sslmode=require");
        assert_eq!((p.host.as_str(), p.port, p.user.as_str(), p.password.as_str(), p.database.as_str()), ("db.local", 6543, "me", "p@ss", "app"));
    }

    #[test]
    fn live_pg_backup() {
        let Ok(cs) = std::env::var("REXA_TRANSFER_PG_SRC") else { return };
        let dir = std::env::temp_dir().join(format!("rexa-backup-{}.sql", std::process::id()));
        let rt = tokio::runtime::Runtime::new().unwrap();
        let out = rt
            .block_on(run_db_backup(Kind::Postgres, &cs, &BackupOptions { format: "plain".into(), schema_only: true, output_path: Some(dir.display().to_string()), ..Default::default() }))
            .unwrap();
        assert!(std::fs::read_to_string(&out).unwrap().contains("CREATE TABLE"));
        let _ = std::fs::remove_file(out);
    }
}
