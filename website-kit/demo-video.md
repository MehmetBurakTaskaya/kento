# Demo video, stills and the README GIF

A plan for the material that has to be recorded on a real desktop: a demo video of 60–90 seconds,
the stills for Kento's page on mehmetburaktaskaya.com and the demo GIF at the top of the README.
Kento itself can do most of the editing: trim, crop, compress, burn in the captions, convert to WEBM
and GIF, and pull the poster frame.

## The video at a glance

| | |
| --- | --- |
| Length | about 85 seconds (60–90) |
| Recording | Windows 11, 1920 × 1080 at 100 % scale, 60 fps; the light theme |
| Language | two takes: Kento in English with English file names, and Kento in Turkish with Turkish file names |
| Sound | Kento's sounds on at a low level for the social versions; the site's version is silent |
| Captions | burned in for the social versions (EN, TR); none in the site's version, which has a text label instead |
| Recorder | OBS Studio or the Xbox Game Bar (Win+Alt+R); a pointer one size larger (Settings › Accessibility › Mouse pointer) |

## Before recording

- [ ] A separate Windows account named "Demo", or at least: no personal folders, recent files,
      account pictures or e-mail in view; OneDrive and other sync icons hidden.
- [ ] Do not disturb on (no notifications), desktop icons hidden, a plain wallpaper (a calm grey),
      only File Explorer, Kento, Windows Terminal and a browser pinned to the taskbar.
- [ ] Kento: the newest release; the Media, Office and Extras tools installed, so no slice is dimmed;
      sound effects on and low; Settings › Language English (Turkish for the second take).
- [ ] Kento's Library cleared, the shelf empty, no folder rules except the one for scene 9, window
      layouts off.
- [ ] A folder `Demo` (Turkish take: `Demo` too) in Documents, open in File Explorer with large icons,
      sorted by name, one tab, the preview pane off. The sample files below in it.
- [ ] The browser on a page with a video you published yourself (scene 8). Copy its link only when
      the scene starts.
- [ ] A dry run of every scene; delete the results (photo.jpg and the rest) before the real take.

## Sample files

Make every file yourself, with nothing personal in it: no faces, names, addresses, number plates,
screens of other apps or location data. Clear each photo with Remove location (the Metadata slice of
the Tools wheel), then look through the rest in the Metadata tool, for example the camera owner's name.

| English take | Turkish take | What it is |
| --- | --- | --- |
| `photo.heic` | `foto.heic` | an iPhone photo of an object on a desk (a cup, a plant), location off |
| `beach.jpg`, `forest.jpg`, `city.jpg` | `sahil.jpg`, `orman.jpg`, `sehir.jpg` | three landscape photos of your own, for one PDF |
| `report.docx` | `rapor.docx` | two pages of text you wrote, a small table and one of the photos |
| `clip.mp4` | `klip.mp4` | 15 seconds of your own 1080p footage (sky, sea, a street without people) |
| `mug.jpg` | `kupa.jpg` | a mug or a plant on a plain background, for Remove background |
| `screenshot.png` | `ekran.png` | a screenshot of Kento's own About window, for the folder rule |

## Shot list

Times are for the edited video. The captions are short enough to read in the time they stand.

| # | Time | Scene | On screen | Caption (EN) | Caption (TR) |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:09 | The gesture | Drag `photo.heic` in File Explorer; press Shift half-way: the Convert wheel opens under the pointer. Point at JPG (the dial clicks round) and drop: the handle turns, the bolts are thrown, the "Ready" card shows `photo.heic → photo.jpg`, and `photo.jpg` appears beside the original. | Drag a file and press Shift: the Convert wheel opens. Drop it on JPG. | Bir dosyayı sürükleyin ve Shift’e basın: Dönüştür çarkı açılır. JPG’ye bırakın. |
| 2 | 0:09–0:16 | A ring of choices | Drag `photo.heic` again, Shift, rest on WEBP: its ring opens (High quality, Balanced, Small file) and the hub shows "Convert ›" over "WEBP". Drop on Balanced. | Rest on a slice for its choices. The original is never touched. | Seçenekleri için bir dilimde bekleyin. Özgün dosyaya hiç dokunulmaz. |
| 3 | 0:16–0:25 | Many files, one PDF | Select the three photos, drag, Shift, rest on PDF and drop on "One PDF". Open the PDF for a second. | Several pictures, one PDF. | Birkaç görsel, tek PDF. |
| 4 | 0:25–0:33 | Office documents | Drag `report.docx`, Shift, drop on PDF. | Documents, spreadsheets and slides, converted on your computer. | Belgeler, tablolar ve sunumlar, bilgisayarınızda dönüştürülür. |
| 5 | 0:33–0:42 | The Tools wheel | Drag `clip.mp4`, press Ctrl: the Tools wheel. Rest on Compress and drop on "Under 25 MB"; the progress scale runs, the card says Ready. | Ctrl opens the Tools: compress, trim, crop, merge… | Ctrl, Araçlar’ı açar: sıkıştırın, kesin, kırpın, birleştirin… |
| 6 | 0:42–0:49 | Remove background | Drag `mug.jpg`, Ctrl, drop on Remove background; show the transparent PNG in the Library. | Remove a background, right on your computer. | Arka planı doğrudan bilgisayarınızda kaldırın. |
| 7 | 0:49–0:57 | File actions and the shelf | Drag `photo.jpg`, press Alt: the File actions wheel; drop on Put on shelf. Open another folder and drag the file out of the shelf into it. | Alt: share, copy, move, or keep it on the shelf. | Alt: paylaşın, kopyalayın, taşıyın ya da rafta tutun. |
| 8 | 0:57–1:05 | Web download | In the browser, copy the link of your own video and press Ctrl+Shift+D; choose Video; the file lands in the folder shown. | Ctrl+Shift+D downloads the link you copied. Only download what you have the right to. | Ctrl+Shift+D kopyaladığınız bağlantıyı indirir. Yalnızca hakkınız olanı indirin. |
| 9 | 1:05–1:13 | A folder rule | Kento's Automation page with the rule "PNG in Screenshots → WEBP in Optimized"; copy `screenshot.png` into Screenshots; the WEBP appears in Optimized. | Folder rules handle new files by themselves. | Klasör kuralları yeni dosyaları kendiliğinden işler. |
| 10 | 1:13–1:19 | The command line | Windows Terminal in `Demo`: `kento convert photo.heic --to png` (Turkish take: `foto.heic`), then `dir *.png`. | And a command line for scripts. | Betikler için bir komut satırı da var. |
| 11 | 1:19–1:27 | Closing card | The social card's layout (`social/kento-card-en.png` or `-tr.png`) or the hero of `index.html`, still. | Kento. Free and open source, fully local, for Windows and macOS. | Kento. Ücretsiz ve açık kaynak, tamamen yerel; Windows ve macOS için. |

### Captions as subtitles

Write the captions into an SRT file per language with the final times, then burn each into its take
with Kento's Burn in subtitles (Tools wheel of the video). Example, English:

```srt
1
00:00:00,300 --> 00:00:08,700
Drag a file and press Shift: the Convert wheel opens.
Drop it on JPG.

2
00:00:09,000 --> 00:00:15,700
Rest on a slice for its choices.
The original is never touched.
```

and Turkish:

```srt
1
00:00:00,300 --> 00:00:08,700
Bir dosyayı sürükleyin ve Shift’e basın: Dönüştür çarkı açılır.
JPG’ye bırakın.

2
00:00:09,000 --> 00:00:15,700
Seçenekleri için bir dilimde bekleyin.
Özgün dosyaya hiç dokunulmaz.
```

## Exports

| For | Size | How |
| --- | --- | --- |
| Social posts (EN, TR) | 1920 × 1080, 30 fps, H.264 MP4, captions burned in, sound on | export from the editor; Kento's Compress if a platform has a size limit |
| A vertical cut (optional) | 1080 × 1920 | Kento's Crop video area on the master, scenes 1–3 only |
| Kento's page on the site | 1280 × 720, 30 fps, silent, no captions, 2–4 MB each: `demo.webm` (VP9) and `demo.mp4` (H.264), plus `demo-poster.webp` | the English take; Kento's Remove audio, then Convert to WEBM; Extract frames for a frame of scene 1 with the wheel open, converted to WEBP |

The site's entry (`site/kento.yaml`) then takes:

```yaml
video:
  webm: "kento/demo.webm"
  mp4: "kento/demo.mp4"
  poster: "kento/demo-poster.webp"
  label: {en: "A short tour of Kento. A photo dragged in File Explorer opens the steel Convert wheel when Shift is pressed, and dropping it on JPG writes a JPG beside the original. A ring of choices offers picture qualities, three photos become one PDF, and a Word document becomes a PDF. Ctrl opens the Tools wheel to compress a video and remove a picture's background, and Alt puts a file on the shelf. A copied link is downloaded with Ctrl+Shift+D, a folder rule turns new screenshots into WEBP files, and the command line converts a photo. The tour ends with its closing card: free and open source, fully local, for Windows and macOS.", tr: "Kento’yu kısaca tanıtan bir tur. Dosya Gezgini’nde sürüklenen bir fotoğraf, Shift’e basılınca çelik Dönüştür çarkını açıyor; JPG’ye bırakılınca özgün dosyanın yanına bir JPG yazılıyor. Bir seçenek halkası görsel kalitelerini sunuyor, üç fotoğraf tek PDF oluyor, bir Word belgesi PDF’ye dönüşüyor. Ctrl, bir videoyu sıkıştırmak ve bir görselin arka planını kaldırmak için Araçlar çarkını açıyor; Alt bir dosyayı rafa koyuyor. Kopyalanan bir bağlantı Ctrl+Shift+D ile indiriliyor, bir klasör kuralı yeni ekran görüntülerini WEBP’ye çeviriyor ve komut satırı bir fotoğrafı dönüştürüyor. Tur, kapanış kartıyla bitiyor: ücretsiz ve açık kaynak, tamamen yerel, Windows ve macOS için."}
```

## Stills for the site

The site shows a card picture on its Software page and a screenshot on Kento's page, one per language
(`card` and `screenshot` in `site/kento.yaml`, files in the site's `src/assets/projects/kento/`):

- `card.webp`, `card-tr.webp`: 1600 × 1000 (16:10); the Convert wheel open over the `Demo` folder,
  the pointer on JPG, from the English and the Turkish take.
- `wheel-light.webp`, `wheel-light-tr.webp`: the same moment at its natural size, cut around the
  window and the wheel; alt text "The Convert wheel open over a photo in File Explorer, with JPG under
  the pointer" / "Dosya Gezgini’ndeki bir fotoğrafın üzerinde açılmış Dönüştür çarkı; imleç JPG’nin
  üzerinde".

## The README demo GIF

| | |
| --- | --- |
| What | scene 1, then scene 2: the drag, Shift, the wheel, the drop on JPG with the bolts thrown and the Ready card, then the WEBP quality ring |
| Length | 10–12 seconds, looping; it ends on the folder as it began, so the loop does not jump |
| Size | 960 × 540, cut around the Explorer window and the wheel rather than the whole screen; 15 fps; under 4 MB |
| Theme and language | light, English UI for `README.md`; a Turkish take (`demo-tr.gif`) for `README.tr.md` if wanted |
| How | record at 1920 × 1080; Kento's Crop video area and Trim video on the recording, then Convert to GIF (its palette is computed for the clip), choosing Small or Medium in the GIF ring, whichever keeps the labels readable |
| Where | `website-kit/assets/demo.gif` (and `demo-tr.gif`), shown under the README's tagline |

Alt text for the README:

- English: "Kento in use: a HEIC photo is dragged in File Explorer, Shift opens the steel Convert wheel
  under the pointer, and dropping the photo on JPG throws the dial's bolts and writes photo.jpg beside
  the original. Resting on WEBP then opens its ring of picture qualities."
- Turkish: "Kento kullanımda: Dosya Gezgini’nde bir HEIC fotoğraf sürükleniyor, Shift imlecin altında
  çelik Dönüştür çarkını açıyor ve fotoğraf JPG’ye bırakılınca kadranın sürgüleri dışarı çıkıyor,
  özgün dosyanın yanına foto.jpg yazılıyor. Ardından WEBP’de beklemek görsel kalitesi halkasını
  açıyor."
