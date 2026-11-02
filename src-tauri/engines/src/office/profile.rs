// SPDX-License-Identifier: MIT
//! Kento's LibreOffice profile (`-env:UserInstallation`): kept between jobs so only the first
//! start is slow, used by one `soffice` at a time, and set up so that documents can neither run
//! macros nor fetch anything.
//!
//! The settings go into the profile's `user/registrymodifications.xcu` before every run, so a
//! profile LibreOffice made, or one it changed, always has them. Their names and values come from
//! LibreOffice's configuration schema (`officecfg/registry/schema/org/openoffice/Office/*.xcs`).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::Duration;

use crate::{Progress, Result};

/// The lock of each profile in this process. Jobs run one at a time already; the warm-up may
/// not.
pub(super) fn lock(profile: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    locks.entry(profile.to_path_buf()).or_default().clone()
}

/// Holds the profile against other processes until the file is dropped: the app and the command
/// line share the kept profile, and a second `soffice` on it would hand its document to the first
/// instead of converting it. Waits while another process holds it; a cancelled job stops waiting.
pub(super) fn hold(profile: &Path, progress: &Progress) -> Result<fs::File> {
    let mut name = profile.as_os_str().to_os_string();
    name.push(".lock");
    let path = PathBuf::from(name);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(&path)?;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(fs::TryLockError::WouldBlock) => {
                progress.check()?;
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(fs::TryLockError::Error(err)) => return Err(err.into()),
        }
    }
}

struct Setting {
    path: &'static str,
    name: &'static str,
    value: &'static str,
    /// Properties of extensible groups need their type spelled out.
    kind: Option<&'static str>,
}

const fn setting(path: &'static str, name: &'static str, value: &'static str) -> Setting {
    Setting {
        path,
        name,
        value,
        kind: None,
    }
}

const SCRIPTING: &str = "/org.openoffice.Office.Common/Security/Scripting";

const SETTINGS: &[Setting] = &[
    // Macro security "very high" (3, the highest level) with no trusted locations, and macro
    // execution off altogether.
    setting(SCRIPTING, "MacroSecurityLevel", "3"),
    setting(SCRIPTING, "DisableMacrosExecution", "true"),
    // Links (linked pictures and other resources) from documents outside the trusted locations
    // are blocked; there are no trusted locations.
    setting(SCRIPTING, "BlockUntrustedRefererLinks", "true"),
    // Links in documents are never updated while loading: Writer counts 0 always, 1 on request,
    // 2 never; Calc 0 always, 1 never, 2 on request.
    setting("/org.openoffice.Office.Writer/Content/Update", "Link", "2"),
    setting("/org.openoffice.Office.Calc/Content/Update", "Link", "1"),
    // Workbooks keep the results they were saved with (1: never recalculate on load), so a
    // formula such as WEBSERVICE does not run while a file is read.
    setting(
        "/org.openoffice.Office.Calc/Formula/Load",
        "OOXMLRecalcMode",
        "1",
    ),
    setting("/org.openoffice.Office.Calc/Formula/Load", "ODFRecalcMode", "1"),
    // LibreOffice's own interface in English. With a Turkish interface its translations ask the
    // C++ library for the locale "Turkish_Türkiye" (the name Windows gives), which a process in
    // UTF-8 cannot open: LibreOffice crashes on every document. Nothing of its interface shows
    // here, and documents keep their own languages.
    setting("/org.openoffice.Office.Linguistic/General", "UILocale", "en-US"),
    // Nothing leaves the computer: no crash reports, no update checks.
    setting("/org.openoffice.Office.Common/Misc", "CrashReport", "false"),
    Setting {
        path: "/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments",
        name: "AutoCheckEnabled",
        value: "false",
        kind: Some("xs:boolean"),
    },
];

impl Setting {
    fn item(&self) -> String {
        let kind = self
            .kind
            .map(|kind| format!(" oor:type=\"{kind}\""))
            .unwrap_or_default();
        format!(
            "<item oor:path=\"{}\"><prop oor:name=\"{}\" oor:op=\"fuse\"{kind}><value>{}</value></prop></item>",
            self.path, self.name, self.value
        )
    }

    /// Whether an item line of the file sets this property, whatever its value.
    fn is_set_by(&self, line: &str) -> bool {
        let line = normalize(line);
        line.starts_with("<item ")
            && line.contains(&format!(
                "oor:path=\"{}\"><prop oor:name=\"{}\"",
                self.path, self.name
            ))
    }
}

/// LibreOffice may write the quotes inside a path as an entity.
fn normalize(line: &str) -> String {
    line.trim().replace("&apos;", "'")
}

const HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<oor:items \
xmlns:oor=\"http://openoffice.org/2001/registry\" xmlns:xs=\"http://www.w3.org/2001/XMLSchema\" \
xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n";
const FOOTER: &str = "</oor:items>\n";

/// Makes the profile folder and puts Kento's settings into it.
pub(super) fn prepare(profile: &Path) -> Result<()> {
    let user = profile.join("user");
    fs::create_dir_all(&user)?;
    let file = user.join("registrymodifications.xcu");
    let existing = fs::read_to_string(&file).ok();
    let wanted = seeded(existing.as_deref());
    if existing.as_deref() != Some(wanted.as_str()) {
        fs::write(&file, wanted)?;
    }
    Ok(())
}

/// The file with Kento's settings in it: unchanged when they are all there, otherwise with any
/// other value of those properties replaced; a new file when there is none or it is broken.
fn seeded(existing: Option<&str>) -> String {
    let items: Vec<String> = SETTINGS.iter().map(Setting::item).collect();
    let Some((body, end)) = existing.and_then(|text| {
        let end = text.rfind("</oor:items>")?;
        text.contains("<oor:items")
            .then_some((&text[..end], &text[end..]))
    }) else {
        let mut out = String::from(HEADER);
        for item in &items {
            out.push_str(item);
            out.push('\n');
        }
        out.push_str(FOOTER);
        return out;
    };
    let present = |item: &String| body.lines().any(|line| normalize(line) == *item);
    if items.iter().all(present) {
        return existing.unwrap_or_default().to_owned();
    }
    let mut out = String::with_capacity(body.len() + items.len() * 160);
    for line in body.split_inclusive('\n') {
        if !SETTINGS.iter().any(|setting| setting.is_set_by(line)) {
            out.push_str(line);
        }
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    for item in &items {
        out.push_str(item);
        out.push('\n');
    }
    out.push_str(end);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn office_profile_a_new_profile_gets_every_setting() {
        let text = seeded(None);
        assert!(text.starts_with("<?xml"));
        assert!(text.trim_end().ends_with("</oor:items>"));
        for expected in [
            "<item oor:path=\"/org.openoffice.Office.Common/Security/Scripting\"><prop \
             oor:name=\"MacroSecurityLevel\" oor:op=\"fuse\"><value>3</value></prop></item>",
            "<prop oor:name=\"DisableMacrosExecution\" oor:op=\"fuse\"><value>true</value>",
            "<prop oor:name=\"BlockUntrustedRefererLinks\" oor:op=\"fuse\"><value>true</value>",
            "Office.Writer/Content/Update\"><prop oor:name=\"Link\" oor:op=\"fuse\"><value>2<",
            "Office.Calc/Content/Update\"><prop oor:name=\"Link\" oor:op=\"fuse\"><value>1<",
            "<prop oor:name=\"CrashReport\" oor:op=\"fuse\"><value>false</value>",
            "Job['UpdateCheck']/Arguments\"><prop oor:name=\"AutoCheckEnabled\" oor:op=\"fuse\" \
             oor:type=\"xs:boolean\"><value>false</value>",
        ] {
            assert!(text.contains(expected), "missing {expected}");
        }
        // Well-formed: one item per line between the root's tags.
        let items = text
            .lines()
            .filter(|line| line.starts_with("<item "))
            .count();
        assert_eq!(items, SETTINGS.len());
        assert_eq!(seeded(Some("not xml")), text, "a broken file starts again");
    }

    #[test]
    fn office_profile_libreoffices_own_settings_stay_and_ours_win() {
        let own = format!(
            "{HEADER}<item oor:path=\"/org.openoffice.Office.Common/Misc\"><prop \
             oor:name=\"FirstRun\" oor:op=\"fuse\"><value>false</value></prop></item>\n\
             <item oor:path=\"/org.openoffice.Office.Common/Security/Scripting\"><prop \
             oor:name=\"MacroSecurityLevel\" oor:op=\"fuse\"><value>0</value></prop></item>\n\
             <item oor:path=\"/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job[&apos;UpdateCheck&apos;]/Arguments\"><prop \
             oor:name=\"AutoCheckEnabled\" oor:op=\"fuse\" oor:type=\"xs:boolean\"><value>true</value></prop></item>\n\
             {FOOTER}"
        );
        let text = seeded(Some(&own));
        assert!(
            text.contains("oor:name=\"FirstRun\""),
            "LibreOffice's own items stay"
        );
        assert!(
            !text.contains("<value>0</value>"),
            "a lower macro level is replaced"
        );
        assert_eq!(
            text.matches("oor:name=\"AutoCheckEnabled\"").count(),
            1,
            "the update check is set once"
        );
        assert!(text.contains("oor:type=\"xs:boolean\"><value>false</value>"));
        assert_eq!(text.matches("oor:name=\"MacroSecurityLevel\"").count(), 1);
        assert!(text.trim_end().ends_with("</oor:items>"));
        // Once everything is in place, the file is left as it is.
        assert_eq!(seeded(Some(&text)), text);
    }

    #[test]
    fn office_profile_prepare_writes_the_file_once() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("Profil ğüşıöç 🧪");
        prepare(&profile).unwrap();
        let file = profile.join("user").join("registrymodifications.xcu");
        let first = fs::read_to_string(&file).unwrap();
        assert!(first.contains("MacroSecurityLevel"));
        prepare(&profile).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), first);
    }

    #[test]
    fn office_profile_each_profile_has_one_lock() {
        let a = lock(Path::new("/profiles/a"));
        let again = lock(Path::new("/profiles/a"));
        let b = lock(Path::new("/profiles/b"));
        assert!(Arc::ptr_eq(&a, &again));
        assert!(!Arc::ptr_eq(&a, &b));
    }

    #[test]
    fn office_profile_is_held_against_other_processes() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("Profil ğüş 🧪");
        let held = hold(&profile, &Progress::none()).unwrap();
        assert!(dir.path().join("Profil ğüş 🧪.lock").is_file());
        // Another open of the lock file stands for another process: it waits until cancelled.
        let cancelled = || true;
        let progress = Progress::new(&|_| {}, &cancelled);
        assert!(matches!(
            hold(&profile, &progress),
            Err(crate::Error::Cancelled)
        ));
        drop(held);
        drop(hold(&profile, &Progress::none()).unwrap());
    }
}
