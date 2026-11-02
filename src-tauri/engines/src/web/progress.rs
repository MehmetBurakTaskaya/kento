// SPDX-License-Identifier: MIT
//! yt-dlp's own progress output, in the shape Kento's templates give it (`args.rs`), and one
//! bar across the steps of a download that only ever moves forward.

use serde_json::Value;

use crate::WebProblem;

/// One progress line of a download.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Step {
    /// `downloading`, `finished` or `error`.
    pub status: String,
    pub done: Option<f64>,
    pub total: Option<f64>,
    pub estimate: Option<f64>,
    /// Fragment number and count, for streams that come in pieces.
    pub fragment: Option<(f64, f64)>,
    /// The item's place in the queue and the queue's length, for posts with several items.
    pub item: Option<(u32, u32)>,
    /// The format being downloaded; video and audio are separate formats before a merge.
    pub format: String,
}

/// What yt-dlp says about a video before downloading it.
#[derive(Debug, Clone, PartialEq, Default)]
pub(super) struct Item {
    pub index: Option<u32>,
    pub title: Option<String>,
    pub playlist_title: Option<String>,
    pub is_live: Option<bool>,
    pub live_status: Option<String>,
    pub playlist_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) enum Line {
    Step(Step),
    /// A step after the download (merging, converting, moving).
    Post,
    Item(Item),
}

/// Kento's lines among yt-dlp's output; everything else is `None`.
pub(super) fn parse(line: &str) -> Option<Line> {
    let line = line.trim_matches(|c: char| c == '\r' || c == '\n' || c == ' ');
    let mut fields = line.split('\t');
    let tag = fields.next()?;
    let fields: Vec<&str> = fields.collect();
    let field = |index: usize| fields.get(index).copied().unwrap_or("NA");
    match tag {
        "kento-progress" => {
            let status = field(0).trim();
            if status.is_empty() || status == "NA" {
                return None;
            }
            let fragment = match (number(field(4)), number(field(5))) {
                (Some(index), Some(count)) if count > 0.0 => Some((index, count)),
                _ => None,
            };
            let item = match (number(field(6)), number(field(7))) {
                (Some(place), Some(count)) if place >= 1.0 && count >= 1.0 => {
                    Some((place as u32, count as u32))
                }
                _ => None,
            };
            Some(Line::Step(Step {
                status: status.to_owned(),
                done: number(field(1)),
                total: number(field(2)),
                estimate: number(field(3)),
                fragment,
                item,
                format: fields
                    .get(8..)
                    .map(|rest| rest.join("\t"))
                    .unwrap_or_default(),
            }))
        }
        "kento-post" => Some(Line::Post),
        "kento-item" => Some(Line::Item(Item {
            index: number(field(0))
                .filter(|index| *index >= 0.0)
                .map(|index| index as u32),
            title: json_text(field(1)),
            playlist_title: json_text(field(2)),
            is_live: json(field(3)).and_then(|value| value.as_bool()),
            live_status: json_text(field(4)),
            playlist_id: json(field(5)).and_then(|value| match value {
                Value::String(text) if !text.is_empty() => Some(text),
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            }),
        })),
        _ => None,
    }
}

/// Whether yt-dlp is about to download what Kento refuses: a live stream, or one video of a
/// playlist, channel or profile (the items of an Instagram post are its own).
pub(super) fn refused(item: &Item, post: bool) -> Option<WebProblem> {
    let live = item.is_live == Some(true)
        || matches!(
            item.live_status.as_deref(),
            Some("is_live" | "is_upcoming" | "post_live")
        );
    if live {
        Some(WebProblem::Live)
    } else if item.playlist_id.is_some() && !post {
        Some(WebProblem::Collection)
    } else {
        None
    }
}

/// The title the files are named after: the post's, else the first video's.
pub(super) fn title(items: &[Item]) -> &str {
    items
        .iter()
        .find_map(|item| item.playlist_title.as_deref())
        .or_else(|| items.iter().find_map(|item| item.title.as_deref()))
        .unwrap_or("")
}

/// A missing field is `NA` (yt-dlp's placeholder) or JSON `null`.
fn missing(text: &str) -> bool {
    matches!(text, "" | "NA" | "null" | "None")
}

fn number(text: &str) -> Option<f64> {
    let text = text.trim();
    if missing(text) {
        return None;
    }
    text.parse::<f64>().ok().filter(|value| value.is_finite())
}

fn json(text: &str) -> Option<Value> {
    let text = text.trim();
    if missing(text) {
        return None;
    }
    serde_json::from_str(text).ok()
}

fn json_text(text: &str) -> Option<String> {
    match json(text)? {
        Value::String(text) => Some(text.trim().to_owned()).filter(|text| !text.is_empty()),
        _ => None,
    }
}

/// The share of a part's room the first part takes: the video of a merge is most of the bytes,
/// and a part that comes next starts where the last one ended.
const PART: f32 = 0.9;

/// One progress bar across a download: each item of a post gets an equal span; inside it the
/// downloads come first and the steps after them (merging, MP3) take the last `post` share.
#[derive(Debug, Clone)]
pub(super) struct Meter {
    post: f32,
    at: f32,
    item: Option<(u32, u32)>,
    format: Option<String>,
    finished: bool,
    part: (f32, f32),
}

impl Meter {
    pub fn new(post: f32) -> Meter {
        Meter {
            post: post.clamp(0.0, 0.9),
            at: 0.0,
            item: None,
            format: None,
            finished: false,
            part: (0.0, 0.0),
        }
    }

    /// The bar's position after this line, when the line tells how far the part is.
    pub fn step(&mut self, step: &Step) -> Option<f32> {
        if step.item.is_some() && step.item != self.item {
            self.item = step.item;
            self.format = None;
            self.finished = false;
        }
        let new_part = self.finished || self.format.as_deref() != Some(step.format.as_str());
        if new_part {
            let from = if self.format.is_none() {
                self.span().0
            } else {
                self.part.1
            };
            let end = self.downloads_end().max(from);
            self.part = (from, from + (end - from) * PART);
            self.format = Some(step.format.clone());
            self.finished = false;
        }
        let fraction = if step.status == "finished" {
            self.finished = true;
            1.0
        } else {
            fraction(step)?
        };
        let (from, to) = self.part;
        Some(self.advance(from + (to - from) * fraction))
    }

    /// The position once the downloads of the current item are done and its last steps run.
    pub fn post(&mut self) -> f32 {
        let end = self.downloads_end();
        self.advance(end)
    }

    fn advance(&mut self, to: f32) -> f32 {
        self.at = self.at.max(to.clamp(0.0, 1.0));
        self.at
    }

    fn span(&self) -> (f32, f32) {
        match self.item {
            Some((place, count)) if place >= 1 && count >= 1 => {
                let count = count as f32;
                let place = (place as f32).min(count);
                ((place - 1.0) / count, place / count)
            }
            _ => (0.0, 1.0),
        }
    }

    fn downloads_end(&self) -> f32 {
        let (from, to) = self.span();
        from + (to - from) * (1.0 - self.post)
    }
}

/// How far one part is, from its bytes (or yt-dlp's estimate of the total), else its fragments.
fn fraction(step: &Step) -> Option<f32> {
    let done = step.done.filter(|done| *done >= 0.0);
    let total = step.total.or(step.estimate).filter(|total| *total > 0.0);
    let fraction = match (done, total) {
        (Some(done), Some(total)) => done / total,
        _ => {
            let (index, count) = step.fragment?;
            index / count
        }
    };
    Some((fraction as f32).clamp(0.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(line: &str) -> Step {
        match parse(line) {
            Some(Line::Step(step)) => step,
            other => panic!("not a step: {other:?}"),
        }
    }

    #[test]
    fn reads_progress_lines() {
        let line = "kento-progress\tdownloading\t1048576\t4194304\tNA\tNA\tNA\tNA\tNA\t137";
        assert_eq!(
            step(line),
            Step {
                status: "downloading".into(),
                done: Some(1_048_576.0),
                total: Some(4_194_304.0),
                estimate: None,
                fragment: None,
                item: None,
                format: "137".into(),
            }
        );
        // Fragments, an estimate, a place in a post and a format name with a tab-free space.
        let line = "kento-progress\tdownloading\t2000.5\tNA\t8000\t3\t12\t2\t5\thls 1080p\r\n";
        let parsed = step(line);
        assert_eq!(parsed.estimate, Some(8000.0));
        assert_eq!(parsed.fragment, Some((3.0, 12.0)));
        assert_eq!(parsed.item, Some((2, 5)));
        assert_eq!(parsed.format, "hls 1080p");
        assert_eq!(parse("kento-post\tstarted\tMerger"), Some(Line::Post));
        assert_eq!(parse("[download] 12.5% of 4.00MiB"), None);
        assert_eq!(parse("kento-progress\tNA"), None);
        assert_eq!(parse("ERROR: kento-progress"), None);
    }

    #[test]
    fn reads_item_lines() {
        let line = "kento-item\tNA\t\"\\u00c7a\\u011fr\\u0131: test\\tvideo\"\tNA\tfalse\t\
                    \"not_live\"\tNA";
        let Some(Line::Item(item)) = parse(line) else {
            panic!("not an item");
        };
        assert_eq!(
            item,
            Item {
                index: None,
                title: Some("Çağrı: test\tvideo".into()),
                playlist_title: None,
                is_live: Some(false),
                live_status: Some("not_live".into()),
                playlist_id: None,
            }
        );
        assert_eq!(refused(&item, false), None);
        assert_eq!(title(std::slice::from_ref(&item)), "Çağrı: test\tvideo");

        let line = "kento-item\t03\t\"Video by kento.test\"\t\"Post by kento.test\"\tnull\
                    \tnull\t\"C1abc\"";
        let Some(Line::Item(entry)) = parse(line) else {
            panic!("not an item");
        };
        assert_eq!(entry.index, Some(3));
        assert_eq!(entry.playlist_id.as_deref(), Some("C1abc"));
        assert_eq!(title(&[item, entry.clone()]), "Post by kento.test");
        // One video of a post is fine; one video of anything else means a whole collection.
        assert_eq!(refused(&entry, true), None);
        assert_eq!(refused(&entry, false), Some(WebProblem::Collection));
        assert_eq!(title(&[]), "");
    }

    #[test]
    fn live_items_are_refused() {
        for (is_live, status) in [
            (Some(true), None),
            (None, Some("is_upcoming")),
            (Some(false), Some("post_live")),
        ] {
            let item = Item {
                is_live,
                live_status: status.map(str::to_owned),
                ..Item::default()
            };
            assert_eq!(refused(&item, true), Some(WebProblem::Live), "{item:?}");
        }
        let ended = Item {
            is_live: Some(false),
            live_status: Some("was_live".into()),
            ..Item::default()
        };
        assert_eq!(refused(&ended, false), None);
    }

    fn line(status: &str, done: u64, total: u64, item: Option<(u32, u32)>, format: &str) -> Step {
        Step {
            status: status.into(),
            done: Some(done as f64),
            total: Some(total as f64),
            estimate: None,
            fragment: None,
            item,
            format: format.into(),
        }
    }

    /// Keeps a position, checking that it did not go back.
    fn push(seen: &mut Vec<f32>, at: Option<f32>) -> f32 {
        let at = at.expect("a position");
        assert!(at >= *seen.last().unwrap(), "{at} after {seen:?}");
        seen.push(at);
        at
    }

    #[test]
    fn the_bar_only_moves_forward_across_parts() {
        let mut meter = Meter::new(0.05);
        let seen = &mut vec![0.0f32];
        // The video part, then the sound part, then the merge.
        push(seen, meter.step(&line("downloading", 0, 1000, None, "137")));
        push(
            seen,
            meter.step(&line("downloading", 500, 1000, None, "137")),
        );
        let after_video = push(seen, meter.step(&line("finished", 1000, 1000, None, "137")));
        assert!((0.8..0.9).contains(&after_video), "{after_video}");
        push(seen, meter.step(&line("downloading", 10, 100, None, "251")));
        let after_audio = push(seen, meter.step(&line("finished", 100, 100, None, "251")));
        assert!(after_audio < 0.95);
        let merged = push(seen, Some(meter.post()));
        assert!((merged - 0.95).abs() < 1e-6);
        // A late line from an earlier part never pulls the bar back.
        push(seen, meter.step(&line("downloading", 1, 1000, None, "137")));
        // A line without sizes or fragments gives no position.
        let unknown = Step {
            total: None,
            ..line("downloading", 5, 0, None, "251")
        };
        assert_eq!(meter.step(&unknown), None);
    }

    #[test]
    fn each_item_of_a_post_gets_its_share() {
        let mut meter = Meter::new(0.05);
        let first = meter
            .step(&line("finished", 10, 10, Some((1, 4)), "img"))
            .unwrap();
        assert!(first <= 0.25);
        let second = meter
            .step(&line("downloading", 5, 10, Some((2, 4)), "img"))
            .unwrap();
        assert!(second > 0.25 && second < 0.5, "{second}");
        let last = meter
            .step(&line("finished", 10, 10, Some((4, 4)), "img"))
            .unwrap();
        assert!(last > 0.75 && last <= 1.0, "{last}");
        // Fragments count when sizes do not.
        let mut meter = Meter::new(0.15);
        let fragments = Step {
            done: None,
            total: None,
            fragment: Some((5.0, 10.0)),
            ..line("downloading", 0, 0, None, "hls")
        };
        let at = meter.step(&fragments).unwrap();
        assert!((at - 0.5 * 0.85 * PART).abs() < 1e-4, "{at}");
    }
}
