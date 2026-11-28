//! Port of components/ui/calendar.tsx (react-day-picker v9, single mode,
//! `showOutsideDays`): `p-3`, caption `h-8 text-sm font-medium` ("November 2026"),
//! outline `size-7` nav buttons at 50% opacity, weekday row ("Su".."Sa") in
//! `text-xs text-muted-foreground`, 32px ghost day buttons, selected
//! `bg-primary`, today `bg-accent`, outside days muted at 50%.

use crate::{ActiveTokens, IconName, Tw};
use gpui::{div, prelude::*, App, ElementId, FontWeight, SharedString, Window};
use gpui_component::Icon;
use std::rc::Rc;

/// A calendar date (proleptic Gregorian).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Hash)]
pub struct Date {
    pub year: i32,
    pub month: u32, // 1..=12
    pub day: u32,   // 1..=31
}

impl Date {
    pub fn new(year: i32, month: u32, day: u32) -> Self {
        Self { year, month, day }
    }
    /// Today in local time.
    pub fn today() -> Self {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        Self::from_days((secs + local_offset_secs()) / 86_400)
    }
    /// Days since 1970-01-01 → date (Howard Hinnant's algorithm).
    pub fn from_days(z: i64) -> Self {
        let z = z + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z.rem_euclid(146_097);
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
        let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
        let y = (yoe + era * 400 + if m <= 2 { 1 } else { 0 }) as i32;
        Self { year: y, month: m, day: d }
    }
    pub fn to_days(self) -> i64 {
        let y = self.year as i64 - if self.month <= 2 { 1 } else { 0 };
        let era = y.div_euclid(400);
        let yoe = y.rem_euclid(400);
        let m = self.month as i64;
        let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + self.day as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        era * 146_097 + doe - 719_468
    }
    /// 0 = Sunday.
    pub fn weekday(self) -> u32 {
        (self.to_days() + 4).rem_euclid(7) as u32
    }
    pub fn add_days(self, n: i64) -> Self {
        Self::from_days(self.to_days() + n)
    }
    pub fn first_of_month(self) -> Self {
        Self { day: 1, ..self }
    }
    pub fn add_months(self, n: i32) -> Self {
        let total = self.year * 12 + self.month as i32 - 1 + n;
        let (y, m) = (total.div_euclid(12), total.rem_euclid(12) as u32 + 1);
        Self { year: y, month: m, day: self.day.min(days_in_month(y, m)) }
    }
    /// ISO `YYYY-MM-DD`.
    pub fn iso(self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
    pub fn parse_iso(s: &str) -> Option<Self> {
        let mut it = s.get(..10)?.split('-');
        Some(Self::new(it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?))
    }
}

pub fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn local_offset_secs() -> i64 {
    // Ask the OS once (`date +%z`); no tz database dependency needed.
    static OFFSET: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *OFFSET.get_or_init(|| std::process::Command::new("date")
        .arg("+%z")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| {
            let s = s.trim();
            let sign = if s.starts_with('-') { -1 } else { 1 };
            let digits = s.trim_start_matches(['+', '-']);
            let h: i64 = digits.get(..2)?.parse().ok()?;
            let m: i64 = digits.get(2..4)?.parse().ok()?;
            Some(sign * (h * 3600 + m * 60))
        })
        .unwrap_or(0))
}

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS: [&str; 7] = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

#[derive(IntoElement)]
pub struct Calendar {
    id: ElementId,
    selected: Option<Date>,
    month: Option<Date>,
    on_select: Option<Rc<dyn Fn(Date, &mut Window, &mut App)>>,
    disabled: Option<Rc<dyn Fn(Date) -> bool>>,
    selected_colors: Option<(gpui::Hsla, gpui::Hsla)>,
}

impl Calendar {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), selected: None, month: None, on_select: None, disabled: None, selected_colors: None }
    }
    pub fn selected(mut self, d: Option<Date>) -> Self {
        self.selected = d;
        self
    }
    /// Initially displayed month (`defaultMonth`); defaults to the selection or today.
    pub fn default_month(mut self, d: Date) -> Self {
        self.month = Some(d);
        self
    }
    pub fn on_select(mut self, f: impl Fn(Date, &mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(f));
        self
    }
    /// `classNames.day_selected` override: (background, text).
    pub fn selected_colors(mut self, bg: gpui::Hsla, fg: gpui::Hsla) -> Self {
        self.selected_colors = Some((bg, fg));
        self
    }
    /// `disabled` matcher.
    pub fn disabled(mut self, f: impl Fn(Date) -> bool + 'static) -> Self {
        self.disabled = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Calendar {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let initial = self.month.or(self.selected).unwrap_or_else(Date::today).first_of_month();
        let month_state = window.use_keyed_state(crate::popup::sub_id(&self.id, "month"), cx, move |_, _| initial);
        let month = *month_state.read(cx);
        let today = Date::today();
        let start = month.add_days(-(month.weekday() as i64));
        let rows = {
            let last = Date::new(month.year, month.month, days_in_month(month.year, month.month));
            let days = (last.to_days() - start.to_days() + 1) as usize;
            days.div_ceil(7)
        };
        let nav = |id: &'static str, icon: IconName, delta: i32| {
            let ms = month_state.clone();
            div()
                .id(id)
                .size_7()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_lg()
                .border_1()
                .border_color(if t.dark { crate::white(0.12) } else { t.border })
                .opacity(0.5)
                .hover(|s| s.opacity(1.))
                .cursor_pointer()
                .child(Icon::new(icon).size_4())
                .on_click(move |_, _, cx| ms.update(cx, |m, cx| {
                    *m = m.add_months(delta);
                    cx.notify();
                }))
        };
        let caption: SharedString = format!("{} {}", MONTHS[month.month as usize - 1], month.year).into();
        let weeks = (0..rows).map(|w| {
            div().flex().children((0..7).map(|d| {
                let date = start.add_days((w * 7 + d) as i64);
                let outside = date.month != month.month;
                let selected = Some(date) == self.selected;
                let is_today = date == today;
                let disabled = self.disabled.as_ref().is_some_and(|f| f(date));
                let on_select = self.on_select.clone();
                let mut b = div()
                    .id(("day", date.to_days() as u64))
                    .size_8()
                    .flex()
                    .items_center()
                    .justify_center()
                    .tw_rounded_lg()
                    .tw_text_sm()
                    .child(date.day.to_string());
                b = if selected {
                    let (bg, fg) = self.selected_colors.unwrap_or((t.primary, t.var_or("--primary-foreground", gpui::white())));
                    b.bg(bg).text_color(fg)
                } else if is_today {
                    b.bg(t.accent).text_color(t.accent_foreground)
                } else {
                    b.hover(|s| s.bg(if t.dark { crate::white(0.06) } else { crate::with_alpha(t.muted, 0.6) }).text_color(t.foreground))
                };
                if outside && !selected {
                    b = b.text_color(t.muted_foreground).opacity(0.5);
                }
                if disabled {
                    b = b.text_color(t.muted_foreground).opacity(0.5);
                } else {
                    b = b.cursor_pointer().when_some(on_select, |b, f| b.on_click(move |_, w, cx| f(date, w, cx)));
                }
                div().w_8().child(b)
            }))
        });
        div()
            .id(self.id)
            .p_3()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .relative()
                    .flex()
                    .h_8()
                    .items_center()
                    .justify_center()
                    .px_8()
                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).whitespace_nowrap().child(caption))
                    .child(
                        div()
                            .absolute()
                            .left_0()
                            .right_0()
                            .top_0()
                            .h_8()
                            .flex()
                            .items_center()
                            .justify_between()
                            .px_1()
                            .child(nav("cal-prev", IconName::ChevronLeft, -1))
                            .child(nav("cal-next", IconName::ChevronRight, 1)),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .child(div().flex().mb_1().children(WEEKDAYS.map(|w| {
                        div().w_8().text_center().tw_text_xs().text_color(t.muted_foreground).child(w)
                    })))
                    .child(div().flex().flex_col().gap_1().children(weeks)),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_math() {
        let d = Date::new(2026, 11, 13);
        assert_eq!(Date::from_days(d.to_days()), d);
        assert_eq!(d.weekday(), 5); // Friday
        assert_eq!(Date::new(2024, 1, 31).add_months(1), Date::new(2024, 2, 29));
        assert_eq!(Date::new(1970, 1, 1).to_days(), 0);
    }
}
