// SPDX-License-Identifier: MIT
//! Standard base64 (RFC 4648), the way the page sends the pictures it draws (`canvas.toDataURL`).
//! Only decoding is needed, and that is small enough not to need a crate.

/// The bytes of `text`: base64 with or without its `=` padding, with line breaks allowed and an
/// optional `data:…;base64,` prefix. None for anything else.
pub(super) fn decode(text: &str) -> Option<Vec<u8>> {
    let text = text.trim();
    let body = match text.strip_prefix("data:") {
        Some(url) => {
            let (kind, body) = url.split_once(',')?;
            if !kind.ends_with(";base64") {
                return None;
            }
            body
        }
        None => text,
    };
    let mut out = Vec::with_capacity(body.len() / 4 * 3);
    let (mut buffer, mut bits, mut digits, mut padding) = (0u32, 0u32, 0usize, 0usize);
    for byte in body.bytes() {
        if byte.is_ascii_whitespace() {
            continue;
        }
        if byte == b'=' {
            padding += 1;
            continue;
        }
        if padding > 0 {
            return None;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        digits += 1;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    // One digit alone in its group of four holds less than a byte; padding fills a group only.
    let whole = digits % 4 != 1 && (padding == 0 || (padding <= 2 && (digits + padding) % 4 == 0));
    whole.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_padded_and_unpadded_text() {
        assert_eq!(decode("").unwrap(), b"");
        assert_eq!(decode("TQ==").unwrap(), b"M");
        assert_eq!(decode("TWE=").unwrap(), b"Ma");
        assert_eq!(decode("TWFu").unwrap(), b"Man");
        assert_eq!(decode("TQ").unwrap(), b"M");
        assert_eq!(decode("TWE").unwrap(), b"Ma");
        assert_eq!(
            decode("S2VudG8gxJ/DvMWfxLHDtsOnIPCfp6o=").unwrap(),
            "Kento ğüşıöç 🧪".as_bytes()
        );
        assert_eq!(decode("+/+/").unwrap(), [0xFB, 0xFF, 0xBF]);
    }

    #[test]
    fn takes_line_breaks_and_data_urls() {
        assert_eq!(decode("TW\r\nFu\n").unwrap(), b"Man");
        assert_eq!(decode("data:image/png;base64,TWFu").unwrap(), b"Man");
        assert_eq!(decode("data:text/plain,Man"), None, "not base64");
    }

    #[test]
    fn refuses_what_is_not_base64() {
        assert_eq!(decode("T"), None);
        assert_eq!(decode("TWFuT"), None);
        assert_eq!(decode("TW-u"), None, "the URL alphabet is not the page's");
        assert_eq!(decode("TQ=x"), None);
        assert_eq!(decode("TQ==="), None);
        assert_eq!(decode("TWE=="), None);
        assert_eq!(decode("ğ"), None);
    }
}
