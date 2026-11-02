// SPDX-License-Identifier: MIT
//! yt-dlp's error lines as the plain reasons the interface gives (SPEC 5.10). yt-dlp prints
//! each failure as one `ERROR:` line naming the site's own message; the phrases below are the
//! ones those messages use. Anything else keeps yt-dlp's words for "Copy details".

use super::run::Log;
use crate::{Error, WebProblem};

/// The checks run in this order, so that "Private video. Sign in if you've been granted access"
/// is private before it is a sign-in, and "HTTP Error 503: Service Unavailable" is the server's
/// trouble rather than the video's.
const DRM: &[&str] = &[
    "drm protected",
    "drm-protected",
    "protected by drm",
    "drm protection",
    "uses drm",
];
const LIVE: &[&str] = &[
    "live event will begin",
    "this live event",
    "premieres in",
    "premiere will begin",
    "is currently live",
    "live stream",
    "livestream",
    "is_upcoming",
];
const GONE: &[&str] = &[
    "private video",
    "video is private",
    "account is private",
    "is private",
    "been removed",
    "was removed",
    "been deleted",
    "terminated",
    "no longer available",
    "does not exist",
    "video unavailable",
    "this video is unavailable",
    "your country",
    "your region",
    "geo restrict",
    "geo-restrict",
    "geo-block",
    "geoblock",
    "copyright",
    "http error 404",
    "http error 410",
    "page not found",
];
const NOTHING: &[&str] = &[
    "unsupported url",
    "no video formats",
    "no video in this post",
    "there is no video",
    "there's no video",
    "no video could be found",
    "no video found",
    "no media",
    "requested format is not available",
];
const LOGIN: &[&str] = &[
    "sign in",
    "signin",
    "log in",
    "login",
    "logged in",
    "logged-in",
    "authentication",
    "cookies",
    "--username",
    "account",
    "members-only",
    "members only",
    "join this channel",
    "confirm your age",
    "age-restricted",
    "age restricted",
    "age verification",
    "inappropriate",
    "premium",
    "subscriber",
    "registered users",
];
const SERVER: &[&str] = &[
    "http error 5",
    "service unavailable",
    "bad gateway",
    "gateway time",
];
const UNAVAILABLE: &[&str] = &[
    "not available",
    "unavailable",
    "http error 403",
    "forbidden",
    "http error 451",
];
const NETWORK: &[&str] = &[
    "getaddrinfo",
    "name or service not known",
    "nodename nor servname",
    "name resolution",
    "failed to resolve",
    "could not resolve",
    "no address associated",
    "connection refused",
    "actively refused",
    "connection reset",
    "connection aborted",
    "forcibly closed",
    "remote end closed",
    "timed out",
    "timeout",
    "network is unreachable",
    "no route to host",
    "unable to connect",
    "transporterror",
    "urlopen error",
    "connectionerror",
    "certificate",
    "ssl:",
    "errno 11001",
    "errno 11004",
    "errno 10051",
    "errno 10054",
    "errno 10060",
    "errno 10061",
];

/// The plain reason in a piece of yt-dlp's output, if it names one.
pub(super) fn classify(text: &str) -> Option<WebProblem> {
    let text = text.to_lowercase();
    let has = |phrases: &[&str]| phrases.iter().any(|phrase| text.contains(phrase));
    [
        (DRM, WebProblem::Drm),
        (LIVE, WebProblem::Live),
        (GONE, WebProblem::Unavailable),
        (NOTHING, WebProblem::NoMedia),
        (LOGIN, WebProblem::Login),
        (SERVER, WebProblem::Network),
        (UNAVAILABLE, WebProblem::Unavailable),
        (NETWORK, WebProblem::Network),
    ]
    .into_iter()
    .find_map(|(phrases, problem)| has(phrases).then_some(problem))
}

/// Whether a line says DRM is in the way (yt-dlp warns so when it keeps a video without
/// formats).
pub(super) fn mentions_drm(line: &str) -> bool {
    classify(line) == Some(WebProblem::Drm)
}

/// Warnings that YouTube's player challenges could not be solved: Deno or yt-dlp's challenge
/// scripts are missing or failed. Most formats are then missing, which is not the page's fault.
const RUNTIME: &[&str] = &[
    "challenge solving failed",
    "challenge solver",
    "javascript runtime",
    "js runtime",
    "wiki/ejs",
];

/// The error for a run that gave nothing: the plain reason in yt-dlp's error lines, or yt-dlp's
/// last error line itself. A run that ended well but gave nothing found no media, unless the
/// JavaScript runtime is why.
pub(super) fn failure(log: &Log, success: bool) -> Error {
    let lines: Vec<&str> = if log.errors.is_empty() {
        let tail: Vec<&str> = log.tail.iter().map(String::as_str).collect();
        tail[tail.len().saturating_sub(3)..].to_vec()
    } else {
        log.errors.iter().map(String::as_str).collect()
    };
    let problem = classify(&lines.join("\n"));
    if matches!(problem, None | Some(WebProblem::NoMedia)) {
        if let Some(error) = runtime(&log.warnings) {
            return error;
        }
    }
    if let Some(problem) = problem {
        return Error::Web(problem);
    }
    if success {
        return Error::Web(WebProblem::NoMedia);
    }
    match lines.last().and_then(|line| words(line)) {
        Some(words) => Error::Other(words),
        None => Error::Other("yt-dlp stopped without a message".into()),
    }
}

/// `NoMedia` from a probe, unless yt-dlp warned that the JavaScript runtime failed: then its
/// warning, so "Copy details" says what to fix instead of blaming the page.
pub(super) fn no_media(log: &Log) -> Error {
    runtime(&log.warnings).unwrap_or(Error::Web(WebProblem::NoMedia))
}

fn runtime(warnings: &[String]) -> Option<Error> {
    warnings
        .iter()
        .find(|line| {
            let line = line.to_lowercase();
            RUNTIME.iter().any(|phrase| line.contains(phrase))
        })
        .and_then(|line| words(line))
        .map(Error::Other)
}

/// yt-dlp's own words from one line, without its `ERROR:`/`WARNING:` tag, kept short.
fn words(line: &str) -> Option<String> {
    let line = line
        .trim_start_matches("ERROR:")
        .trim_start_matches("WARNING:")
        .trim_start()
        .trim_start_matches("yt-dlp:")
        .trim();
    if line.is_empty() {
        return None;
    }
    let short: String = line.chars().take(300).collect();
    Some(format!("yt-dlp: {short}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn errors_map_to_plain_reasons() {
        let cases: &[(&str, Option<WebProblem>)] = &[
            (
                "ERROR: [youtube] abc: This video is DRM protected",
                Some(WebProblem::Drm),
            ),
            (
                "ERROR: [youtube] abc: This live event will begin in 3 hours.",
                Some(WebProblem::Live),
            ),
            (
                "ERROR: [youtube] abc: Premieres in 12 minutes",
                Some(WebProblem::Live),
            ),
            (
                "ERROR: [youtube] abc: Sign in to confirm your age. This video may be \
                 inappropriate for some users.",
                Some(WebProblem::Login),
            ),
            (
                "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use \
                 --cookies-from-browser or --cookies for the authentication.",
                Some(WebProblem::Login),
            ),
            (
                "ERROR: [youtube] abc: Join this channel to get access to members-only content",
                Some(WebProblem::Login),
            ),
            (
                "ERROR: [Instagram] C1: Requested content is not available, rate-limit reached \
                 or login required. Use --cookies, --cookies-from-browser, --username and \
                 --password, --netrc-cmd, or --netrc (instagram) to provide account credentials",
                Some(WebProblem::Login),
            ),
            (
                "ERROR: [youtube] abc: Private video. Sign in if you've been granted access to \
                 this video",
                Some(WebProblem::Unavailable),
            ),
            (
                "ERROR: [youtube] abc: Video unavailable. This video has been removed by the \
                 uploader",
                Some(WebProblem::Unavailable),
            ),
            (
                "ERROR: [youtube] abc: The uploader has not made this video available in your \
                 country",
                Some(WebProblem::Unavailable),
            ),
            (
                "ERROR: [generic] Unable to download webpage: HTTP Error 404: Not Found \
                 (caused by <HTTPError 404: Not Found>)",
                Some(WebProblem::Unavailable),
            ),
            (
                "ERROR: [vimeo] 1: HTTP Error 403: Forbidden",
                Some(WebProblem::Unavailable),
            ),
            (
                "ERROR: Unsupported URL: https://example.org/about",
                Some(WebProblem::NoMedia),
            ),
            (
                "ERROR: [Instagram] C1: There is no video in this post",
                Some(WebProblem::NoMedia),
            ),
            (
                "ERROR: [generic] x: Requested format is not available. Use --list-formats",
                Some(WebProblem::NoMedia),
            ),
            (
                "ERROR: [generic] Unable to download webpage: <urlopen error [Errno 11001] \
                 getaddrinfo failed> (caused by TransportError('<urlopen error [Errno 11001] \
                 getaddrinfo failed>'))",
                Some(WebProblem::Network),
            ),
            (
                "ERROR: [generic] Unable to download webpage: [Errno 61] Connection refused",
                Some(WebProblem::Network),
            ),
            (
                "ERROR: unable to download video data: The read operation timed out",
                Some(WebProblem::Network),
            ),
            (
                "ERROR: [generic] Unable to download webpage: HTTP Error 503: Service \
                 Unavailable",
                Some(WebProblem::Network),
            ),
            (
                "ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide \
                 the path using --ffmpeg-location",
                None,
            ),
            ("yt-dlp: error: no such option: --js-runtimes", None),
            // A word inside an address is not a reason.
            (
                "ERROR: Unsupported URL: https://example.org/hydrm/x",
                Some(WebProblem::NoMedia),
            ),
        ];
        for (line, expected) in cases {
            assert_eq!(classify(line), *expected, "{line}");
        }
        assert!(mentions_drm(
            "WARNING: [generic] x: This video is DRM protected"
        ));
        assert!(!mentions_drm(
            "WARNING: Falling back on generic information extractor"
        ));
    }

    fn log(errors: &[&str], tail: &[&str]) -> Log {
        Log {
            errors: errors.iter().map(|line| (*line).to_owned()).collect(),
            warnings: Vec::new(),
            tail: tail.iter().map(|line| (*line).to_owned()).collect(),
        }
    }

    #[test]
    fn a_failed_javascript_runtime_is_said_plainly() {
        let warning = "WARNING: [youtube] abc: n challenge solving failed: Some formats may be \
                       missing. Ensure you have a supported JavaScript runtime and challenge \
                       solver script distribution installed.";
        let mut troubled = log(
            &["ERROR: [youtube] abc: Requested format is not available. Use --list-formats"],
            &[],
        );
        troubled.warnings.push(warning.to_owned());
        let Error::Other(message) = failure(&troubled, false) else {
            panic!("the runtime's warning is the reason");
        };
        assert!(
            message.starts_with("yt-dlp: [youtube] abc: n challenge"),
            "{message}"
        );
        assert!(matches!(no_media(&troubled), Error::Other(_)));
        // A clear reason from the site still wins.
        troubled.errors = vec!["ERROR: [youtube] abc: Private video".into()];
        assert!(matches!(
            failure(&troubled, false),
            Error::Web(WebProblem::Unavailable)
        ));
        // Without such a warning nothing changes.
        assert!(matches!(
            no_media(&log(&[], &[])),
            Error::Web(WebProblem::NoMedia)
        ));
    }

    #[test]
    fn failures_keep_ytdlps_last_words_when_no_reason_fits() {
        let error = failure(
            &log(&["ERROR: [generic] x: Something odd happened"], &[]),
            false,
        );
        let Error::Other(message) = error else {
            panic!("expected Other, got {error:?}");
        };
        assert_eq!(message, "yt-dlp: [generic] x: Something odd happened");

        let error = failure(
            &log(
                &[],
                &[
                    "Usage: yt-dlp [OPTIONS] URL [URL...]",
                    "",
                    "yt-dlp: error: no such option: --no-remote-components",
                ],
            ),
            false,
        );
        let Error::Other(message) = error else {
            panic!("expected Other, got {error:?}");
        };
        assert!(message.contains("no such option"), "{message}");

        assert!(matches!(
            failure(&log(&[], &[]), false),
            Error::Other(message) if message.contains("without a message")
        ));
        assert!(matches!(
            failure(&log(&[], &[]), true),
            Error::Web(WebProblem::NoMedia)
        ));
        assert!(matches!(
            failure(
                &log(
                    &[
                        "ERROR: [youtube] a: Video unavailable",
                        "ERROR: [youtube] b: This video is DRM protected"
                    ],
                    &[]
                ),
                false
            ),
            Error::Web(WebProblem::Drm)
        ));
    }
}
