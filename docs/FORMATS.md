# Formats, tools and file actions

Generated from the catalog in `src-tauri/src/catalog` by `npm run catalog:export`; do not edit by hand.

**Status:** *ready* works today; *preview* depends on the computer (HEIC needs the system's HEIF support); *planned* arrives in a later phase. **[+]** marks an enhancement beyond the core feature set. Core needs no download; Media, Office and Extras are optional tool groups (SPEC 4.2).

| | Count |
| --- | ---: |
| Formats | 54 |
| Core input formats | 46 |
| Conversion routes | 355 |
| Tools | 31 |
| File actions | 8 |

## Image

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| AVIF | JPG, PNG, WEBP, BMP, TIFF, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| AVIF | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| BMP | JPG, PNG, WEBP, AVIF, TIFF, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| BMP | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| GIF | JPG, PNG, WEBP, AVIF, BMP, TIFF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| GIF | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| GIF | MP4, WEBM, MOV | Media | planned | animated GIF |
| HEIC | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO [+] | Core | preview | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF: read with the system's HEIF support |
| JPG | PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| JPG | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| PNG | JPG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| PNG | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| SVG | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| SVG | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| TIFF | JPG, PNG, WEBP, AVIF, BMP, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| TIFF | HEIC | Core | preview | only where a reliable HEIC encoder exists |
| WEBP | JPG, PNG, AVIF, BMP, TIFF, GIF, PDF, ICO [+] | Core | ready | ICO: several sizes in one icon |
| WEBP | HEIC | Core | preview | only where a reliable HEIC encoder exists |

## Video

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| AVI | MP4, MOV, MKV, WEBM, WMV, GIF, MP3, M4A [+], WAV [+] | Media | planned |  |
| MKV | MP4, MOV, WEBM, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media | planned |  |
| MOV | MP4, MKV, WEBM, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media | planned |  |
| MP4 | MOV, MKV, WEBM, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media | planned |  |
| WEBM | MP4, MOV, MKV, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media | planned |  |
| WMV | MP4, MOV, MKV, WEBM, AVI, GIF, MP3, M4A [+], WAV [+] | Media | planned |  |

## Audio

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| AIFF | FLAC, M4A, MP3, OGG, OPUS, WAV, WMA | Media | planned |  |
| FLAC | AIFF, M4A, MP3, OGG, OPUS, WAV, WMA | Media | planned |  |
| M4A | AIFF, FLAC, MP3, OGG, OPUS, WAV, WMA | Media | planned |  |
| MP3 | AIFF, FLAC, M4A, OGG, OPUS, WAV, WMA | Media | planned |  |
| OGG | AIFF, FLAC, M4A, MP3, OPUS, WAV, WMA | Media | planned |  |
| OPUS | AIFF, FLAC, M4A, MP3, OGG, WAV, WMA | Media | planned |  |
| WAV | AIFF, FLAC, M4A, MP3, OGG, OPUS, WMA | Media | planned |  |
| WMA | AIFF, FLAC, M4A, MP3, OGG, OPUS, WAV | Media | planned |  |

## Document

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| DOCX | PDF, ODT [+], RTF, TXT, MD, HTML, EPUB | Office | planned |  |
| RTF | PDF, DOCX, ODT [+], TXT, MD, HTML, EPUB | Office | planned |  |
| RTFD | PDF, DOCX, ODT [+], RTF, TXT, MD, HTML, EPUB | Office | planned | best effort |
| TXT | MD, HTML | Core | ready |  |
| TXT | PDF, DOCX, ODT [+], RTF, EPUB | Office | planned |  |
| MD | TXT, HTML | Core | ready |  |
| MD | PDF, DOCX, ODT [+], RTF, EPUB | Office | planned |  |
| HTML | TXT, MD | Core | ready |  |
| HTML | PDF, DOCX, ODT [+], RTF, EPUB | Office | planned |  |
| EPUB | PDF, DOCX, ODT [+], RTF, TXT, MD, HTML | Office | planned |  |
| PAGES | PDF, DOCX, ODT [+], RTF, TXT, MD, HTML, EPUB | Office | planned |  |
| TEXTCLIPPING | TXT | Core | ready | best effort |
| TEXTCLIPPING | PDF, DOCX, ODT [+], RTF, MD, HTML, EPUB | Office | planned | best effort |
| ODT [+] | PDF, DOCX, RTF, TXT, MD, HTML, EPUB | Office | planned |  |
| DOC [+] | PDF, DOCX, ODT, RTF, TXT, MD, HTML, EPUB | Office | planned |  |

## Spreadsheet

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| CSV | TSV, XLSX, HTML | Core | ready |  |
| CSV | ODS, PDF | Office | planned |  |
| TSV | CSV, XLSX, HTML | Core | ready |  |
| TSV | ODS, PDF | Office | planned |  |
| XLS | CSV, TSV, XLSX, HTML | Core | ready | CSV, TSV: the first sheet; XLSX, HTML: values only |
| XLS | ODS, PDF | Office | planned |  |
| XLSX | CSV, TSV, HTML | Core | ready | CSV, TSV: the first sheet; HTML: values only |
| XLSX | ODS, PDF | Office | planned |  |
| ODS | CSV, TSV, XLSX, HTML | Core | ready | CSV, TSV: the first sheet; XLSX, HTML: values only |
| ODS | PDF | Office | planned |  |
| NUMBERS [+] | XLSX, ODS, CSV, TSV, PDF, HTML | Office | planned |  |

## Presentation

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| PPT | PDF, PPTX, ODP [+], PNG, JPG | Office | planned | PNG, JPG: one image per slide |
| PPTX | PDF, ODP [+], PNG, JPG | Office | planned | PNG, JPG: one image per slide |
| ODP [+] | PDF, PPTX, PNG, JPG | Office | planned | PNG, JPG: one image per slide |
| KEY [+] | PDF, PPTX, ODP, PNG, JPG | Office | planned | PNG, JPG: one image per slide |

## Subtitles

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| SRT | VTT, TXT | Core | ready |  |
| VTT | SRT, TXT | Core | ready |  |

## PDF

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| PDF | JPG, PNG, TXT, MD | Core | ready | JPG, PNG: one image per page; TXT, MD: text only |
| PDF | PPTX, XLSX, DOCX, EPUB, HTML | Office | planned | PPTX: with page images; XLSX: best effort |

## Archive

| From | To | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| ZIP | TAR, TAR.GZ, 7Z [+] | Core | ready |  |
| TAR | ZIP, TAR.GZ, 7Z [+] | Core | ready |  |
| GZ | ZIP, TAR, 7Z [+] | Core | ready |  |
| RAR | ZIP, TAR, TAR.GZ, 7Z [+] | Core | ready | extract only (UnRAR licence) |
| 7Z [+] | ZIP, TAR, TAR.GZ | Core | ready |  |

## Tools

| Tool | Works on | Needs | Status | Notes |
| --- | --- | --- | --- | --- |
| Compress | Image, Video, Audio, PDF | Core | planned | video and audio need the Media tools; PDF compression is [+] |
| Metadata | Image, PDF, Video, Audio | Extras | planned | media files also use ffprobe from the Media tools |
| Edit image | Image | Core | planned |  |
| Mark up | Image | Core | planned |  |
| Add frame | Image | Core | planned |  |
| Crop image | Image | Core | planned |  |
| Make a collage | Image | Core | planned |  |
| Redact image | Image | Core | planned |  |
| Read QR codes | Image, PDF | Core | ready |  |
| Make a QR code [+] | text or a link | Core | planned | from text or a link |
| Split PDF | PDF | Core | ready |  |
| Edit PDF | PDF | Core | ready |  |
| Merge PDFs | PDF | Core | ready |  |
| PDF from images | Image | Core | ready |  |
| Extract archive | Archive | Core | ready |  |
| Remove audio | Video | Media | planned |  |
| Trim video | Video | Media | planned |  |
| Crop video area | Video | Media | planned |  |
| Change video speed | Video | Media | planned |  |
| Merge videos | Video | Media | planned |  |
| Extract frames | Video | Media | planned |  |
| Split video | Video | Media | planned |  |
| Redact video | Video | Media | planned |  |
| Normalize loudness | Audio | Media | planned |  |
| Trim audio | Audio | Media | planned |  |
| Audio channels | Audio | Media | planned |  |
| Redact audio | Audio | Media | planned |  |
| Audio to video | Audio | Media | planned |  |
| Remove background [+] | Image | Extras | planned | permissively licensed models only |
| Extract text [+] | Image, PDF | Core | planned | Windows OCR and Apple Vision |
| Burn in subtitles [+] | Video, Subtitles | Media | planned |  |

## File actions

| Action | Status |
| --- | --- |
| Share | planned |
| Put on shelf | planned |
| Copy to… | planned |
| Move to… | planned |
| Copy path | planned |
| Open in terminal | planned |
| Show in Explorer / Show in Finder [+] | planned |
| Archive (ZIP) [+] | planned |
