// SPDX-License-Identifier: MIT
//! Interface languages. The strings live in /locales, shared with the page; Rust reads them for the
//! tray menu and window titles. Plural forms and other ICU messages are formatted on the page only.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Language {
    pub code: &'static str,
    /// The language's name in itself, as the language list shows it.
    pub name: &'static str,
}

/// The twelve languages Kento will speak (SPEC 5.19), in the order the list shows them.
pub const PLANNED: [Language; 12] = [
    Language {
        code: "en",
        name: "English",
    },
    Language {
        code: "es",
        name: "Español",
    },
    Language {
        code: "zh-Hans",
        name: "简体中文",
    },
    Language {
        code: "ja",
        name: "日本語",
    },
    Language {
        code: "de",
        name: "Deutsch",
    },
    Language {
        code: "fr",
        name: "Français",
    },
    Language {
        code: "pt-BR",
        name: "Português (Brasil)",
    },
    Language {
        code: "ar",
        name: "العربية",
    },
    Language {
        code: "ko",
        name: "한국어",
    },
    Language {
        code: "it",
        name: "Italiano",
    },
    Language {
        code: "ru",
        name: "Русский",
    },
    Language {
        code: "tr",
        name: "Türkçe",
    },
];

/// Test languages the page builds from English (long text, right to left). Development builds
/// accept them as a setting; the tray then shows English.
pub const PSEUDO: [&str; 2] = ["en-XA", "ar-XB"];

pub fn is_pseudo(code: &str) -> bool {
    cfg!(debug_assertions) && PSEUDO.contains(&code)
}

/// The languages with a file in /locales.
pub fn available() -> Vec<Language> {
    PLANNED
        .iter()
        .copied()
        .filter(|lang| dictionary(lang.code).is_some())
        .collect()
}

fn dictionaries() -> &'static HashMap<&'static str, HashMap<String, String>> {
    static DICTS: OnceLock<HashMap<&'static str, HashMap<String, String>>> = OnceLock::new();
    DICTS.get_or_init(|| {
        let files: [(&str, &str); 12] = [
            ("en", include_str!("../../locales/en.json")),
            ("es", include_str!("../../locales/es.json")),
            ("zh-Hans", include_str!("../../locales/zh-Hans.json")),
            ("ja", include_str!("../../locales/ja.json")),
            ("de", include_str!("../../locales/de.json")),
            ("fr", include_str!("../../locales/fr.json")),
            ("pt-BR", include_str!("../../locales/pt-BR.json")),
            ("ar", include_str!("../../locales/ar.json")),
            ("ko", include_str!("../../locales/ko.json")),
            ("it", include_str!("../../locales/it.json")),
            ("ru", include_str!("../../locales/ru.json")),
            ("tr", include_str!("../../locales/tr.json")),
        ];
        files
            .into_iter()
            .map(|(code, json)| {
                let dict: HashMap<String, String> =
                    serde_json::from_str(json).expect("locale files are valid JSON");
                (code, dict)
            })
            .collect()
    })
}

fn dictionary(code: &str) -> Option<&'static HashMap<String, String>> {
    dictionaries().get(code)
}

/// The text for a key in a language, falling back to English and then to the key itself.
pub fn text(lang: &str, key: &str) -> String {
    dictionary(lang)
        .and_then(|dict| dict.get(key))
        .or_else(|| dictionary("en").and_then(|dict| dict.get(key)))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

/// Maps a system language tag (tr-TR, pt_PT, zh-Hans-CN…) to one of `codes`, or None.
/// Portuguese goes to Brazilian Portuguese and Simplified Chinese to zh-Hans; Traditional
/// Chinese has no match.
pub fn match_language(tag: &str, codes: &[&str]) -> Option<String> {
    let tag = tag.replace('_', "-");
    let lower = tag.to_ascii_lowercase();
    if let Some(code) = codes.iter().find(|code| code.to_ascii_lowercase() == lower) {
        return Some((*code).to_string());
    }
    let mut parts = lower.split('-');
    let base = parts.next().unwrap_or_default();
    let rest: Vec<&str> = parts.collect();
    let wanted = match base {
        "pt" => "pt-BR".to_string(),
        "zh" => {
            let traditional = rest
                .iter()
                .any(|p| matches!(*p, "hant" | "tw" | "hk" | "mo"));
            if traditional {
                return None;
            }
            "zh-Hans".to_string()
        }
        other => other.to_string(),
    };
    codes
        .iter()
        .find(|code| code.eq_ignore_ascii_case(&wanted))
        .map(|code| (*code).to_string())
}

/// The language the interface uses: the user's choice, else the system language when Kento speaks
/// it, else English.
pub fn resolve(setting: &str, system: Option<&str>) -> String {
    let codes: Vec<&str> = available().iter().map(|lang| lang.code).collect();
    if is_pseudo(setting) {
        return setting.to_string();
    }
    if setting != "system" {
        if let Some(code) = codes.iter().find(|code| code.eq_ignore_ascii_case(setting)) {
            return (*code).to_string();
        }
    }
    system
        .and_then(|tag| match_language(tag, &codes))
        .unwrap_or_else(|| "en".to_string())
}

/// The system's language tag, read once.
pub fn system_locale() -> Option<String> {
    sys_locale::get_locale()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [&str; 12] = [
        "en", "es", "zh-Hans", "ja", "de", "fr", "pt-BR", "ar", "ko", "it", "ru", "tr",
    ];

    #[test]
    fn matches_system_tags_to_the_closest_language() {
        assert_eq!(match_language("tr-TR", &ALL).as_deref(), Some("tr"));
        assert_eq!(match_language("en_GB", &ALL).as_deref(), Some("en"));
        assert_eq!(match_language("es-MX", &ALL).as_deref(), Some("es"));
        assert_eq!(match_language("pt-PT", &ALL).as_deref(), Some("pt-BR"));
        assert_eq!(match_language("pt-BR", &ALL).as_deref(), Some("pt-BR"));
        assert_eq!(match_language("zh-CN", &ALL).as_deref(), Some("zh-Hans"));
        assert_eq!(
            match_language("zh-Hans-SG", &ALL).as_deref(),
            Some("zh-Hans")
        );
        assert_eq!(match_language("zh-TW", &ALL), None);
        assert_eq!(match_language("zh-Hant-HK", &ALL), None);
        assert_eq!(match_language("ar-EG", &ALL).as_deref(), Some("ar"));
        assert_eq!(match_language("nl-NL", &ALL), None);
    }

    #[test]
    fn resolves_the_setting_then_the_system_then_english() {
        assert_eq!(resolve("tr", Some("de-DE")), "tr");
        assert_eq!(resolve("system", Some("tr-TR")), "tr");
        assert_eq!(resolve("system", Some("de-DE")), "de");
        // A system language Kento does not speak falls back to English.
        assert_eq!(resolve("system", Some("nl-NL")), "en");
        assert_eq!(resolve("system", None), "en");
        assert_eq!(resolve("xx", Some("tr-TR")), "tr");
    }

    #[test]
    fn every_locale_has_the_keys_of_english() {
        let en = dictionary("en").unwrap();
        for lang in available() {
            let dict = dictionary(lang.code).unwrap();
            for key in en.keys() {
                assert!(dict.contains_key(key), "{} is missing {key}", lang.code);
            }
            assert_eq!(
                dict.len(),
                en.len(),
                "{} has keys English does not",
                lang.code
            );
        }
        assert_eq!(available().len(), 12);
        assert_eq!(text("tr", "nav.home"), "Ana Sayfa");
        assert_eq!(text("tr", "no.such.key"), "no.such.key");
    }
}
