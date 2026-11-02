// SPDX-License-Identifier: MIT
//! Resumable downloads and SHA-256 checks. A download goes to `<file>.part`; an interrupted one
//! continues from where it stopped with an HTTP Range request.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::{Arc, Once};
use std::time::Duration;

use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::StatusCode;
use sha2::{Digest, Sha256};
use tokio::sync::watch;

use super::Error;

/// Cancels one group's install; a clone shares the flag.
#[derive(Debug, Clone)]
pub struct Cancel(Arc<watch::Sender<bool>>);

impl Default for Cancel {
    fn default() -> Self {
        Self(Arc::new(watch::channel(false).0))
    }
}

impl Cancel {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }

    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    /// Resolves once `cancel` is called.
    pub async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        // The sender lives in `self`, so waiting ends only through `cancel`.
        let _ = receiver.wait_for(|cancelled| *cancelled).await;
    }

    /// Fails with `Error::Cancelled` once cancelled.
    pub fn check(&self) -> Result<(), Error> {
        if self.is_cancelled() {
            Err(Error::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// The HTTP client for tool downloads. TLS is rustls with the ring provider and the system's
/// certificate store; `https_only` is off only for the tests' local server.
pub fn client(https_only: bool) -> Result<reqwest::Client, Error> {
    static PROVIDER: Once = Once::new();
    PROVIDER.call_once(|| {
        // Fails only when a provider is already installed, which is just as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::Client::builder()
        .user_agent(concat!("Kento/", env!("CARGO_PKG_VERSION")))
        .https_only(https_only)
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(network)
}

/// Downloads `url` into `part` until it holds `size` bytes, continuing a partial file. `progress`
/// gets the bytes on disk. On cancellation or a dropped connection the partial file stays for the
/// next try; a response that cannot belong to the pinned file removes it.
pub async fn fetch(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    size: u64,
    cancel: &Cancel,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<(), Error> {
    let mut have = fs::metadata(part).map_or(0, |meta| meta.len());
    if have > size {
        fs::remove_file(part)?;
        have = 0;
    }
    // A server that no longer honours the range gets one fresh try from the start.
    for _ in 0..2 {
        progress(have);
        if have == size {
            return Ok(());
        }
        let mut request = client.get(url);
        if have > 0 {
            request = request.header(RANGE, format!("bytes={have}-"));
        }
        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            response = request.send() => response.map_err(network)?,
        };
        let status = response.status();
        let resumed = status == StatusCode::PARTIAL_CONTENT && have > 0;
        if status == StatusCode::RANGE_NOT_SATISFIABLE
            || (resumed && range_start(&response) != Some(have))
        {
            tracing::info!("the server refused to resume; starting over");
            fs::remove_file(part)?;
            have = 0;
            continue;
        }
        if status != StatusCode::OK && !resumed {
            return Err(Error::Network(format!("HTTP {status}")));
        }
        if !resumed {
            have = 0;
        }
        if let Some(length) = response.content_length() {
            if have + length != size {
                return Err(Error::Network(format!(
                    "the server sent {length} bytes where {} were expected",
                    size - have
                )));
            }
        }
        let file = if resumed {
            OpenOptions::new().append(true).open(part)?
        } else {
            File::create(part)?
        };
        return stream(response, file, part, have, size, cancel, progress).await;
    }
    Err(Error::Network("the download could not be resumed".into()))
}

async fn stream(
    mut response: reqwest::Response,
    mut file: File,
    part: &Path,
    mut have: u64,
    size: u64,
    cancel: &Cancel,
    progress: &mut (dyn FnMut(u64) + Send),
) -> Result<(), Error> {
    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                file.flush()?;
                return Err(Error::Cancelled);
            }
            chunk = response.chunk() => chunk,
        };
        let chunk = match chunk {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(err) => {
                file.flush()?;
                return Err(network(err));
            }
        };
        if have + chunk.len() as u64 > size {
            drop(file);
            fs::remove_file(part)?;
            return Err(Error::Network(
                "the download is larger than expected".into(),
            ));
        }
        file.write_all(&chunk)?;
        have += chunk.len() as u64;
        progress(have);
    }
    file.flush()?;
    file.sync_all()?;
    if have == size {
        Ok(())
    } else {
        Err(Error::Network(format!(
            "the download stopped at {have} of {size} bytes"
        )))
    }
}

/// Reads a small answer whole, such as release metadata or a checksum list; one larger than `limit`
/// bytes is refused, so a wrong address cannot fill the memory.
pub async fn get(
    client: &reqwest::Client,
    url: &str,
    accept: &str,
    limit: usize,
    cancel: &Cancel,
) -> Result<Vec<u8>, Error> {
    let request = client.get(url).header(reqwest::header::ACCEPT, accept);
    let mut response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        response = request.send() => response.map_err(network)?,
    };
    if response.status() != StatusCode::OK {
        return Err(Error::Network(format!("HTTP {}", response.status())));
    }
    let too_large = || Error::Network(format!("the answer is larger than {limit} bytes"));
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(too_large());
    }
    let mut body = Vec::new();
    loop {
        let chunk = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            chunk = response.chunk() => chunk.map_err(network)?,
        };
        let Some(chunk) = chunk else { break };
        if body.len() + chunk.len() > limit {
            return Err(too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// The first byte of a `Content-Range: bytes 100-199/200` answer.
fn range_start(response: &reqwest::Response) -> Option<u64> {
    let value = response.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    let range = value.strip_prefix("bytes ")?;
    range.split('-').next()?.trim().parse().ok()
}

fn network(err: reqwest::Error) -> Error {
    // The URL can carry signed query strings after a redirect; they say nothing useful.
    Error::Network(err.without_url().to_string())
}

/// The SHA-256 of a file as lowercase hex.
pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 1 << 16];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Checks a finished download against its pinned hash and deletes it when it does not match, so
/// an unverified file is never unpacked or run.
pub fn verify(path: &Path, sha256: &str) -> Result<(), Error> {
    let actual = sha256_file(path)?;
    if actual.eq_ignore_ascii_case(sha256) {
        Ok(())
    } else {
        tracing::warn!("a tool download did not match its pinned SHA-256; deleted");
        fs::remove_file(path)?;
        Err(Error::Checksum)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::Mutex;

    /// How the test server answers.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum Mode {
        /// Honours `Range: bytes=N-` with 206.
        Ranges,
        /// Always sends the whole file with 200.
        IgnoreRanges,
        /// Sends the first half, then holds the connection open.
        Stall,
    }

    /// A tiny HTTP/1.1 server on 127.0.0.1 that serves one body and records each request's Range
    /// header.
    pub(crate) struct Server {
        pub url: String,
        pub ranges: Arc<Mutex<Vec<Option<String>>>>,
    }

    pub(crate) fn serve(body: Vec<u8>, mode: Mode) -> Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/tool.zip", listener.local_addr().unwrap());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let line = line.trim_end();
                    if line.is_empty() {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("range") {
                            range = Some(value.trim().to_string());
                        }
                    }
                }
                seen.lock().unwrap().push(range.clone());
                let start = range
                    .as_deref()
                    .and_then(|r| r.strip_prefix("bytes="))
                    .and_then(|r| r.strip_suffix('-'))
                    .and_then(|n| n.parse::<usize>().ok())
                    .filter(|_| mode == Mode::Ranges);
                let head = match start {
                    Some(from) => format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {from}-{}/{}\r\nConnection: close\r\n\r\n",
                        body.len() - from,
                        body.len() - 1,
                        body.len()
                    ),
                    None => format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    ),
                };
                let from = start.unwrap_or(0);
                let _ = stream.write_all(head.as_bytes());
                if mode == Mode::Stall {
                    let _ = stream.write_all(&body[..body.len() / 2]);
                    let _ = stream.flush();
                    std::thread::sleep(Duration::from_secs(10));
                } else {
                    let _ = stream.write_all(&body[from..]);
                }
            }
        });
        Server { url, ranges }
    }

    /// A tiny HTTP/1.1 server on 127.0.0.1 with several files: each request gets the body for its
    /// path (whole, 200) or a 404, and each path asked for is recorded.
    pub(crate) struct Routes {
        /// `http://127.0.0.1:<port>`, without a slash at the end.
        pub base: String,
        pub asked: Arc<Mutex<Vec<String>>>,
    }

    pub(crate) fn serve_routes(routes: Vec<(String, Vec<u8>)>) -> Routes {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let asked = Arc::new(Mutex::new(Vec::new()));
        let seen = asked.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                if reader.read_line(&mut first).unwrap_or(0) == 0 {
                    continue;
                }
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line.trim_end().is_empty() {
                        break;
                    }
                }
                let path = first.split_whitespace().nth(1).unwrap_or("").to_string();
                seen.lock().unwrap().push(path.clone());
                let body = routes
                    .iter()
                    .find(|(route, _)| *route == path)
                    .map(|(_, b)| b);
                let head = match body {
                    Some(body) => format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    ),
                    None => {
                        "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                            .to_string()
                    }
                };
                let _ = stream.write_all(head.as_bytes());
                if let Some(body) = body {
                    let _ = stream.write_all(body);
                }
            }
        });
        Routes { base, asked }
    }

    pub(crate) fn sample(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 31 % 251) as u8).collect()
    }

    pub(crate) fn sha256(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    #[tokio::test]
    async fn a_partial_file_continues_with_a_range_request() {
        let body = sample(300_000);
        let server = serve(body.clone(), Mode::Ranges);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("tool.zip.part");
        fs::write(&part, &body[..123_456]).unwrap();

        let client = client(false).unwrap();
        let mut seen = Vec::new();
        fetch(
            &client,
            &server.url,
            &part,
            body.len() as u64,
            &Cancel::default(),
            &mut |n| seen.push(n),
        )
        .await
        .unwrap();

        assert_eq!(
            *server.ranges.lock().unwrap(),
            [Some("bytes=123456-".to_string())]
        );
        assert_eq!(seen.first(), Some(&123_456));
        assert_eq!(seen.last(), Some(&(body.len() as u64)));
        assert_eq!(sha256_file(&part).unwrap(), sha256(&body));
        verify(&part, &sha256(&body)).unwrap();
        assert!(part.is_file());
    }

    #[tokio::test]
    async fn a_server_that_ignores_ranges_gives_the_whole_file_again() {
        let body = sample(70_000);
        let server = serve(body.clone(), Mode::IgnoreRanges);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("tool.zip.part");
        fs::write(&part, &body[..1000]).unwrap();
        let client = client(false).unwrap();
        fetch(
            &client,
            &server.url,
            &part,
            body.len() as u64,
            &Cancel::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
        assert_eq!(
            *server.ranges.lock().unwrap(),
            [Some("bytes=1000-".to_string())]
        );
        assert_eq!(sha256_file(&part).unwrap(), sha256(&body));
    }

    #[tokio::test]
    async fn cancelling_keeps_the_part_and_the_next_try_resumes() {
        let body = sample(400_000);
        let stalled = serve(body.clone(), Mode::Stall);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("tool.zip.part");
        let client = client(false).unwrap();
        let cancel = Cancel::default();
        let half = body.len() as u64 / 2;
        let trigger = cancel.clone();
        let result = fetch(
            &client,
            &stalled.url,
            &part,
            body.len() as u64,
            &cancel,
            &mut |n| {
                if n >= half {
                    trigger.cancel();
                }
            },
        )
        .await;
        assert!(matches!(result, Err(Error::Cancelled)), "{result:?}");
        assert_eq!(fs::metadata(&part).unwrap().len(), half);

        let server = serve(body.clone(), Mode::Ranges);
        fetch(
            &client,
            &server.url,
            &part,
            body.len() as u64,
            &Cancel::default(),
            &mut |_| {},
        )
        .await
        .unwrap();
        assert_eq!(
            *server.ranges.lock().unwrap(),
            [Some(format!("bytes={half}-"))]
        );
        assert_eq!(sha256_file(&part).unwrap(), sha256(&body));
    }

    #[tokio::test]
    async fn a_response_of_the_wrong_size_is_refused() {
        let body = sample(5000);
        let server = serve(body.clone(), Mode::Ranges);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("tool.zip.part");
        let client = client(false).unwrap();
        let result = fetch(
            &client,
            &server.url,
            &part,
            4000,
            &Cancel::default(),
            &mut |_| {},
        )
        .await;
        assert!(matches!(result, Err(Error::Network(_))), "{result:?}");
    }

    #[tokio::test]
    async fn a_small_answer_is_read_whole_and_a_large_one_refused() {
        let server = serve_routes(vec![
            ("/small".into(), b"tag".to_vec()),
            ("/large".into(), sample(10_000)),
        ]);
        let client = client(false).unwrap();
        let cancel = Cancel::default();
        let read = |path: &str| {
            let url = format!("{}{path}", server.base);
            let (client, cancel) = (client.clone(), cancel.clone());
            async move { get(&client, &url, "text/plain", 4096, &cancel).await }
        };
        assert_eq!(read("/small").await.unwrap(), b"tag");
        assert!(matches!(read("/large").await, Err(Error::Network(_))));
        assert!(matches!(read("/missing").await, Err(Error::Network(_))));
        assert_eq!(
            *server.asked.lock().unwrap(),
            ["/small", "/large", "/missing"]
        );
    }

    #[test]
    fn a_hash_mismatch_deletes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("tool.zip");
        fs::write(&file, b"not the pinned file").unwrap();
        let result = verify(&file, &sha256(b"the pinned file"));
        assert!(matches!(result, Err(Error::Checksum)));
        assert!(!file.exists());

        fs::write(&file, b"the pinned file").unwrap();
        verify(&file, &sha256(b"the pinned file").to_uppercase()).unwrap();
        assert!(file.exists());
    }
}
