// SPDX-License-Identifier: MIT
//! One archive entry as every reader describes it, and the time formats the archives store.

use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    File,
    Dir,
    /// A symbolic or hard link: never followed, recreated or repacked.
    Link,
    /// Devices, pipes and format-specific records.
    Other,
}

#[derive(Debug, Clone)]
pub(super) struct Entry {
    /// The stored path, unchecked: see `safe::components`.
    pub name: String,
    pub kind: Kind,
    /// The size the archive states, when it states one.
    pub size: Option<u64>,
    /// Seconds since 1970-01-01 UTC.
    pub mtime: Option<i64>,
    /// Unix permission bits.
    pub mode: Option<u32>,
}

/// Seconds between 1601-01-01 (Windows file times) and 1970-01-01.
const FILETIME_EPOCH: i64 = 11_644_473_600;
const FILETIME_PER_SEC: u64 = 10_000_000;

/// A Windows file time (100 ns since 1601 UTC) as Unix seconds; 0 means "not set".
pub(super) fn from_filetime(filetime: u64) -> Option<i64> {
    if filetime == 0 {
        return None;
    }
    i64::try_from(filetime / FILETIME_PER_SEC)
        .ok()
        .map(|secs| secs - FILETIME_EPOCH)
}

pub(super) fn to_filetime(secs: i64) -> Option<u64> {
    u64::try_from(secs.checked_add(FILETIME_EPOCH)?)
        .ok()?
        .checked_mul(FILETIME_PER_SEC)
}

/// A calendar date and time (UTC) as Unix seconds.
pub(super) fn from_civil(year: i64, month: u32, day: u32, hour: u32, min: u32, sec: u32) -> i64 {
    days_from_civil(year, month, day) * 86_400
        + i64::from(hour) * 3_600
        + i64::from(min) * 60
        + i64::from(sec)
}

/// Unix seconds as (year, month, day, hour, minute, second) in UTC.
pub(super) fn to_civil(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let rest = secs.rem_euclid(86_400) as u32;
    let (year, month, day) = civil_from_days(days);
    (year, month, day, rest / 3_600, rest % 3_600 / 60, rest % 60)
}

/// A packed MS-DOS date and time (date in the high 16 bits), read as UTC.
pub(super) fn from_dos(packed: u32) -> Option<i64> {
    let (date, time) = (packed >> 16, packed & 0xFFFF);
    let (day, month) = (date & 0x1F, (date >> 5) & 0x0F);
    if packed == 0 || day == 0 || !(1..=12).contains(&month) {
        return None;
    }
    let year = 1980 + i64::from(date >> 9);
    let (hour, min, sec) = (time >> 11, (time >> 5) & 0x3F, (time & 0x1F) * 2);
    Some(from_civil(year, month, day, hour, min, sec))
}

pub(super) fn from_system(time: SystemTime) -> Option<i64> {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => i64::try_from(after.as_secs()).ok(),
        Err(before) => i64::try_from(before.duration().as_secs()).ok().map(|s| -s),
    }
}

pub(super) fn to_system(secs: i64) -> Option<SystemTime> {
    let span = std::time::Duration::from_secs(secs.unsigned_abs());
    if secs >= 0 {
        UNIX_EPOCH.checked_add(span)
    } else {
        UNIX_EPOCH.checked_sub(span)
    }
}

// Proleptic Gregorian calendar conversions on day counts relative to 1970-01-01.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month = i64::from(month);
    let day_of_year =
        (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}
