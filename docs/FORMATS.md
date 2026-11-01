# Formats, tools and file actions

Generated from the catalog in `src-tauri/src/catalog` by `npm run catalog:export`; do not edit by hand.

Every entry is *planned* until its engine ships (Phase 2 onwards). **[+]** marks an enhancement beyond the core feature set. Core needs no download; Media, Office and Extras are optional tool groups (SPEC 4.2).

| | Count |
| --- | ---: |
| Formats | 54 |
| Core input formats | 46 |
| Conversion routes | 355 |
| Tools | 31 |
| File actions | 8 |

## Image

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| AVIF | JPG, PNG, WEBP, BMP, TIFF, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| BMP | JPG, PNG, WEBP, AVIF, TIFF, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| GIF | JPG, PNG, WEBP, AVIF, BMP, TIFF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| GIF | MP4, WEBM, MOV | Media | animated GIF |
| HEIC | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO [+] | Core | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF: read with the system's HEIF support |
| JPG | PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| PNG | JPG, WEBP, AVIF, BMP, TIFF, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| SVG | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| TIFF | JPG, PNG, WEBP, AVIF, BMP, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |
| WEBP | JPG, PNG, AVIF, BMP, TIFF, GIF, PDF, HEIC, ICO [+] | Core | HEIC: only where a reliable HEIC encoder exists; ICO: several sizes in one icon |

## Video

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| AVI | MP4, MOV, MKV, WEBM, WMV, GIF, MP3, M4A [+], WAV [+] | Media |  |
| MKV | MP4, MOV, WEBM, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media |  |
| MOV | MP4, MKV, WEBM, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media |  |
| MP4 | MOV, MKV, WEBM, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media |  |
| WEBM | MP4, MOV, MKV, AVI, WMV, GIF, MP3, M4A [+], WAV [+] | Media |  |
| WMV | MP4, MOV, MKV, WEBM, AVI, GIF, MP3, M4A [+], WAV [+] | Media |  |

## Audio

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| AIFF | FLAC, M4A, MP3, OGG, OPUS, WAV, WMA | Media |  |
| FLAC | AIFF, M4A, MP3, OGG, OPUS, WAV, WMA | Media |  |
| M4A | AIFF, FLAC, MP3, OGG, OPUS, WAV, WMA | Media |  |
| MP3 | AIFF, FLAC, M4A, OGG, OPUS, WAV, WMA | Media |  |
| OGG | AIFF, FLAC, M4A, MP3, OPUS, WAV, WMA | Media |  |
| OPUS | AIFF, FLAC, M4A, MP3, OGG, WAV, WMA | Media |  |
| WAV | AIFF, FLAC, M4A, MP3, OGG, OPUS, WMA | Media |  |
| WMA | AIFF, FLAC, M4A, MP3, OGG, OPUS, WAV | Media |  |

## Document

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| DOCX | PDF, ODT [+], RTF, TXT, MD, HTML, EPUB | Office |  |
| RTF | PDF, DOCX, ODT [+], TXT, MD, HTML, EPUB | Office |  |
| RTFD | PDF, DOCX, ODT [+], RTF, TXT, MD, HTML, EPUB | Office | best effort |
| TXT | MD, HTML | Core |  |
| TXT | PDF, DOCX, ODT [+], RTF, EPUB | Office |  |
| MD | TXT, HTML | Core |  |
| MD | PDF, DOCX, ODT [+], RTF, EPUB | Office |  |
| HTML | TXT, MD | Core |  |
| HTML | PDF, DOCX, ODT [+], RTF, EPUB | Office |  |
| EPUB | PDF, DOCX, ODT [+], RTF, TXT, MD, HTML | Office |  |
| PAGES | PDF, DOCX, ODT [+], RTF, TXT, MD, HTML, EPUB | Office |  |
| TEXTCLIPPING | TXT | Core | best effort |
| TEXTCLIPPING | PDF, DOCX, ODT [+], RTF, MD, HTML, EPUB | Office | best effort |
| ODT [+] | PDF, DOCX, RTF, TXT, MD, HTML, EPUB | Office |  |
| DOC [+] | PDF, DOCX, ODT, RTF, TXT, MD, HTML, EPUB | Office |  |

## Spreadsheet

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| CSV | TSV | Core |  |
| CSV | XLSX, ODS, PDF, HTML | Office |  |
| TSV | CSV | Core |  |
| TSV | XLSX, ODS, PDF, HTML | Office |  |
| XLS | XLSX, ODS, CSV, TSV, PDF, HTML | Office |  |
| XLSX | ODS, CSV, TSV, PDF, HTML | Office |  |
| ODS | XLSX, CSV, TSV, PDF, HTML | Office |  |
| NUMBERS [+] | XLSX, ODS, CSV, TSV, PDF, HTML | Office |  |

## Presentation

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| PPT | PDF, PPTX, ODP [+], PNG, JPG | Office | PNG, JPG: one image per slide |
| PPTX | PDF, ODP [+], PNG, JPG | Office | PNG, JPG: one image per slide |
| ODP [+] | PDF, PPTX, PNG, JPG | Office | PNG, JPG: one image per slide |
| KEY [+] | PDF, PPTX, ODP, PNG, JPG | Office | PNG, JPG: one image per slide |

## Subtitles

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| SRT | VTT, TXT | Core |  |
| VTT | SRT, TXT | Core |  |

## PDF

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| PDF | JPG, PNG, TXT, MD | Core | JPG, PNG: one image per page; TXT, MD: text only |
| PDF | PPTX, XLSX, DOCX, EPUB, HTML | Office | PPTX: with page images; XLSX: best effort |

## Archive

| From | To | Needs | Notes |
| --- | --- | --- | --- |
| ZIP | TAR, TAR.GZ, 7Z [+] | Core |  |
| TAR | ZIP, TAR.GZ, 7Z [+] | Core |  |
| GZ | ZIP, TAR, 7Z [+] | Core |  |
| RAR | ZIP, TAR, TAR.GZ, 7Z [+] | Core | extract only (UnRAR licence) |
| 7Z [+] | ZIP, TAR, TAR.GZ | Core |  |

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
| Read QR codes | Image, PDF | Core | planned |  |
| Make a QR code [+] | text or a link | Core | planned | from text or a link |
| Split PDF | PDF | Core | planned |  |
| Edit PDF | PDF | Core | planned |  |
| Merge PDFs | PDF | Core | planned |  |
| PDF from images | Image | Core | planned |  |
| Extract archive | Archive | Core | planned |  |
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
