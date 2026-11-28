//! Port of the value logic of `DateEditor` in @rexadbapp/data-table
//! `src/grid/rexa-cell-renderer.tsx` (`toInputValue`, `commitValue`,
//! `restoreOriginalFraction`, `fractionOf`) and `safeParseDate`
//! (`src/grid/cell-content.ts`, date-fns `parseISO`).
//!
//! The browser's `<input type="date|datetime-local">` value format is kept as the
//! editor text: `YYYY-MM-DD` / `YYYY-MM-DDTHH:MM:SS[.mmm]`.

use chrono::{DateTime, Datelike, FixedOffset, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Timelike, Utc};

pub struct DateColumn {
    /// `/time|timestamp/i`
    pub has_time: bool,
    /// `/timestamptz|timetz|with time zone/i`
    pub has_time_zone: bool,
}

impl DateColumn {
    pub fn new(column_type: &str) -> Self {
        let t = column_type.to_lowercase();
        Self { has_time: t.contains("time"), has_time_zone: t.contains("timestamptz") || t.contains("timetz") || t.contains("with time zone") }
    }

    /// `toInputValue`
    pub fn to_input_value(&self, value: &str) -> String {
        if value.is_empty() {
            return String::new();
        }
        let Some(date) = safe_parse_date(value) else { return value.to_string() };
        let date_part = format!("{:04}-{:02}-{:02}", date.year(), date.month(), date.day());
        if !self.has_time {
            return date_part;
        }
        let ms = date.timestamp_subsec_millis();
        let frac = if ms != 0 { format!(".{ms:03}") } else { String::new() };
        format!("{date_part}T{:02}:{:02}:{:02}{frac}", date.hour(), date.minute(), date.second())
    }

    /// `selectedDate`: the calendar day of the editor text.
    pub fn selected_day(&self, local: &str) -> Option<NaiveDate> {
        if local.is_empty() {
            return None;
        }
        let part = if self.has_time { local.split('T').next().unwrap_or_default() } else { local };
        safe_parse_date(part).map(|d| d.date_naive())
    }

    /// Calendar `onSelect`: replace the day, keep the time (or midnight).
    pub fn with_day(&self, local: &str, day: NaiveDate) -> String {
        let date_part = day.format("%Y-%m-%d").to_string();
        if self.has_time {
            let time = local.split_once('T').map(|(_, t)| t).filter(|t| !t.is_empty()).unwrap_or("00:00:00");
            format!("{date_part}T{time}")
        } else {
            date_part
        }
    }

    /// `commitValue`: the string saved for editor text `local` over the original `initial_raw`.
    pub fn commit_value(&self, initial_raw: &str, local: &str) -> String {
        if local.is_empty() {
            return String::new();
        }
        if local == self.to_input_value(initial_raw) {
            // Untouched: round-trip the original verbatim (keeps µs precision).
            return initial_raw.to_string();
        }
        if !self.has_time {
            return local.to_string();
        }
        if self.has_time_zone {
            let committed = safe_parse_date(local)
                .map(|d| d.with_timezone(&Utc).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
                .unwrap_or_else(|| local.to_string());
            return self.restore_original_fraction(initial_raw, local, &committed);
        }
        let committed = if local.contains('T') { local.replacen('T', " ", 1) } else { local.to_string() };
        self.restore_original_fraction(initial_raw, local, &committed)
    }

    /// `restoreOriginalFraction`
    fn restore_original_fraction(&self, initial_raw: &str, local: &str, committed: &str) -> String {
        let Some(raw_frac) = fraction_of(initial_raw) else { return committed.to_string() };
        let cur_frac = fraction_of(committed).unwrap_or_default();
        if cur_frac.len() > 3 || !raw_frac.starts_with(cur_frac) || raw_frac.len() <= cur_frac.len() {
            return committed.to_string();
        }
        let original = self.to_input_value(initial_raw);
        let Some(original_wall) = wall_of(&original) else { return committed.to_string() };
        if wall_of(local) != Some(original_wall) {
            return committed.to_string();
        }
        // `committed.replace(/(\d{2}:\d{2}:\d{2})(\.\d+)?/, "$1.<rawFrac>")`
        let Some(start) = find_wall(committed) else { return committed.to_string() };
        let wall_end = start + 8;
        let mut end = wall_end;
        let bytes = committed.as_bytes();
        if bytes.get(end) == Some(&b'.') && bytes.get(end + 1).is_some_and(u8::is_ascii_digit) {
            end += 1;
            while bytes.get(end).is_some_and(u8::is_ascii_digit) {
                end += 1;
            }
        }
        format!("{}.{}{}", &committed[..wall_end], raw_frac, &committed[end..])
    }
}

/// Byte offset of the first `\d{2}:\d{2}:\d{2}`.
fn find_wall(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    (0..b.len().saturating_sub(7)).find(|&i| {
        let d = |j: usize| b[i + j].is_ascii_digit();
        d(0) && d(1) && b[i + 2] == b':' && d(3) && d(4) && b[i + 5] == b':' && d(6) && d(7)
    })
}

fn wall_of(s: &str) -> Option<&str> {
    find_wall(s).map(|i| &s[i..i + 8])
}

/// `fractionOf`: sub-second digits of `HH:MM:SS.ffff`.
fn fraction_of(value: &str) -> Option<&str> {
    let mut rest = value;
    while let Some(i) = find_wall(rest) {
        let after = &rest[i + 8..];
        if let Some(digits) = after.strip_prefix('.') {
            let n = digits.bytes().take_while(u8::is_ascii_digit).count();
            if n > 0 {
                return Some(&digits[..n]);
            }
        }
        rest = &rest[i + 1..];
    }
    None
}

/// `safeParseDate` (date-fns `parseISO`): no offset → local time.
pub fn safe_parse_date(value: &str) -> Option<DateTime<Local>> {
    let value = value.trim();
    let (date_part, time_part) = match value.find(['T', ' ']) {
        Some(i) => (&value[..i], Some(&value[i + 1..])),
        None => (value, None),
    };
    let date = NaiveDate::parse_from_str(date_part, "%Y-%m-%d").ok()?;
    let Some(time_part) = time_part.filter(|t| !t.is_empty()) else {
        return Local.from_local_datetime(&date.and_hms_opt(0, 0, 0)?).earliest();
    };
    // Split the zone suffix (Z, ±HH, ±HHMM, ±HH:MM).
    let (clock, zone) = match time_part.find(['Z', 'z', '+', '-']) {
        Some(i) => (&time_part[..i], Some(&time_part[i..])),
        None => (time_part, None),
    };
    let clock = clock.trim();
    let time = NaiveTime::parse_from_str(clock, "%H:%M:%S%.f")
        .or_else(|_| NaiveTime::parse_from_str(clock, "%H:%M"))
        .ok()?;
    let naive = NaiveDateTime::new(date, time);
    match zone.map(str::trim) {
        None => Local.from_local_datetime(&naive).earliest(),
        Some(z) if z.eq_ignore_ascii_case("z") => Some(Utc.from_utc_datetime(&naive).with_timezone(&Local)),
        Some(z) => {
            let sign = if z.starts_with('-') { -1 } else { 1 };
            let digits: String = z[1..].chars().filter(char::is_ascii_digit).collect();
            let (h, m) = match digits.len() {
                2 => (digits.parse::<i32>().ok()?, 0),
                4 => (digits[..2].parse::<i32>().ok()?, digits[2..].parse::<i32>().ok()?),
                _ => return None,
            };
            let offset = FixedOffset::east_opt(sign * (h * 3600 + m * 60))?;
            Some(offset.from_local_datetime(&naive).earliest()?.with_timezone(&Local))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_date_round_trips() {
        let c = DateColumn::new("date");
        assert_eq!(c.to_input_value("2024-03-05"), "2024-03-05");
        assert_eq!(c.commit_value("2024-03-05", "2024-03-05"), "2024-03-05");
        assert_eq!(c.commit_value("2024-03-05", "2024-03-09"), "2024-03-09");
        assert_eq!(c.with_day("2024-03-05", NaiveDate::from_ymd_opt(2024, 4, 1).unwrap()), "2024-04-01");
    }

    #[test]
    fn naive_timestamp_keeps_wall_clock_and_microseconds() {
        let c = DateColumn::new("timestamp without time zone");
        assert!(c.has_time && !c.has_time_zone);
        let raw = "2024-03-05 10:20:30.123456";
        assert_eq!(c.to_input_value(raw), "2024-03-05T10:20:30.123");
        assert_eq!(c.commit_value(raw, "2024-03-05T10:20:30.123"), raw);
        // Only the day changed: microseconds come back.
        let moved = c.with_day("2024-03-05T10:20:30.123", NaiveDate::from_ymd_opt(2024, 3, 7).unwrap());
        assert_eq!(c.commit_value(raw, &moved), "2024-03-07 10:20:30.123456");
        // The time changed: no restoration.
        assert_eq!(c.commit_value(raw, "2024-03-05T11:00:00"), "2024-03-05 11:00:00");
    }

    #[test]
    fn timestamptz_commits_utc_instant() {
        let c = DateColumn::new("timestamptz");
        let raw = "2024-03-05T10:20:30Z";
        let input = c.to_input_value(raw);
        assert_eq!(c.commit_value(raw, &input), raw);
        let edited = c.with_day(&input, NaiveDate::from_ymd_opt(2024, 3, 6).unwrap());
        let committed = c.commit_value(raw, &edited);
        assert_eq!(safe_parse_date(&committed).unwrap(), safe_parse_date("2024-03-06T10:20:30Z").unwrap());
    }

    #[test]
    fn unparseable_value_passes_through() {
        let c = DateColumn::new("date");
        assert_eq!(c.to_input_value("infinity"), "infinity");
        assert!(safe_parse_date("2024-03-05 10:20:30+05:30").is_some());
    }
}
