<p align="center">
  <img src="design/icons/app.svg" width="96" height="96" alt="Kento simgesi: çelik bir kasa kadranı">
</p>

<h1 align="center">Kento</h1>

<p align="center">
  <strong>Dosyayı sürükle, bir tuşa bas, kadrana bırak.</strong><br>
  Windows ve macOS için, işini tamamen kendi bilgisayarında yapan ücretsiz ve açık kaynak dosya dönüştürme ve araçlar.
</p>

<p align="center">
  <a href="https://github.com/MehmetBurakTaskaya/kento/releases/latest"><img src="https://img.shields.io/github/v/release/MehmetBurakTaskaya/kento?label=s%C3%BCr%C3%BCm&color=2a4ea6" alt="En yeni sürüm"></a>
  <a href="https://github.com/MehmetBurakTaskaya/kento/releases"><img src="https://img.shields.io/github/downloads/MehmetBurakTaskaya/kento/total?label=indirme&color=2a4ea6" alt="İndirme sayısı"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/lisans-MIT-2a4ea6" alt="Lisans: MIT"></a>
  <a href="#kentoyu-indir"><img src="https://img.shields.io/badge/platformlar-Windows%20%7C%20macOS-555c67" alt="Platformlar: Windows ve macOS"></a>
</p>

<p align="center">
  <img src="docs/images/kento-demo-tr.gif" width="960" alt="Kento kullanımda. Bir klasörden sürüklenen fotoğraf, Shift'e basılınca imlecin altında çelik Dönüştür çarkını açıyor; JPG'de beklemek görsel kalitelerini açıyor, bırakınca kadranın sürgüleri dışarı çıkıyor ve orijinalin yanına balon.jpg yazılıyor. Ctrl Araçlar çarkını ve Kırp düzenleyicisini, Alt dosya işlemlerini ve rafı açıyor. Ardından karışık bir seçim, bir belge ve bir sunum, yapıştırılan bir video bağlantısı, klasör kuralları ve tarifler, Kütüphane, açık ve koyu görünüm ve sekiz dilde çark geliyor.">
</p>

<p align="center">
  <a href="https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-Windows-x64-Setup.exe"><img src="https://img.shields.io/badge/Windows-Kurulum%20dosyas%C4%B1-2a4ea6?style=for-the-badge" alt="Windows için indir: kurulum dosyası"></a>
  <a href="https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-Windows-x64-Portable.zip"><img src="https://img.shields.io/badge/Windows-Ta%C5%9F%C4%B1nabilir%20ZIP-2a4ea6?style=for-the-badge" alt="Windows için indir: taşınabilir ZIP"></a>
  <a href="https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-macOS-Universal.dmg"><img src="https://img.shields.io/badge/macOS-Disk%20g%C3%B6r%C3%BCnt%C3%BCs%C3%BC-2a4ea6?style=for-the-badge" alt="macOS için indir: disk görüntüsü"></a>
</p>

<p align="center">
  Windows 10 (1809 ya da sonrası) ve 11, x64 · macOS 12 ya da sonrası, Apple silicon ve Intel<br>
  <a href="README.md">English</a> · <a href="CHANGELOG.md">Değişiklikler</a> ·
  Yazan: <a href="https://mehmetburaktaskaya.com">Mehmet Burak Taşkaya</a>
</p>

Explorer'da, Finder'da ya da herhangi bir uygulamada bir dosyayı sürüklerken **Shift**'e bas:
imlecin altında çelik bir kasa kadranı açılır. Dosyayı bir dilime bırak; Kento onu orada,
orijinalin yanına yeni bir kopya olarak dönüştürür. **Ctrl** (Mac'te ⌘) bunun yerine araçları,
**Alt** (⌃) ise dosya işlemlerini açar. Hiçbir şey bir yere yüklenmez, orijinal olduğu gibi kalır.

## Üç tuş, üç çark

| Sürüklerken bas | Çark | Neler sunar |
| --- | --- | --- |
| **Shift** | Dönüştür | sürüklenen her dosyanın dönüşebileceği biçimler: HEIC'ten JPG'ye, DOCX'ten PDF'ye, MOV'dan MP4'e, sunumdan slayt başına bir PNG'ye… |
| **Ctrl** (⌘) | Araçlar | sıkıştırma, kırpma, kesme, birleştirme, işaretleme, gizleme, meta veri, arka planı kaldırma, metni çıkarma, QR kodlar… |
| **Alt** (⌃) | Dosya işlemleri | paylaş, rafa koy, kopyala, taşı, yolu kopyala, terminalde aç, Explorer'da ya da Finder'da göster, arşivle |

- **Seçenek halkaları.** Bir dilimin üzerinde yarım saniye bekle, seçenekleri etrafında açılsın:
  resim kalitesi, tek PDF ya da ayrı PDF'ler, sayfa çözünürlüğü, sıkıştırma ayarları, son
  kullanılan klasörler. Dilime doğrudan bırakmak varsayılanı uygular.
- **Karışık seçimler.** Fotoğrafları, PDF'leri ve videoları birlikte sürükle: Dönüştür çarkı önce
  türlerini, sonra her birinin biçimlerini gösterir.
- **Hiçbir dosyanın üzerine yazmaz.** Her iş orijinalin yanına yeni bir dosya yazar; orijinali
  yalnızca onayladığın Taşı işlemi taşır.
- **Sürüklemeden de olur.** Ctrl+Shift+Space, Explorer'da ya da Finder'da seçili dosyalar için
  çarkı açar; ana pencere de bırakılan, seçilen ya da yapıştırılan dosyaları alır.

## Çarktan fazlası

| | |
| --- | --- |
| **Web'den indirme** | Bir bağlantı yapıştır, Ctrl+Shift+D'ye bas ya da tarayıcıdan bir bağlantı sürükle: Kento neyi, hangi kalitede ve nereye indireceğini sorar. |
| **Klasör kuralları** | Bir kural bir klasörü izler ve her yeni dosyayı işler: dönüştürür, bir araç ya da tarif çalıştırır veya taşır. |
| **Tarifler** | Bir ad altında adımlar; örneğin 4:5 kırp, 1080 px'e boyutlandır ve 2 MB'ın altına sıkıştır. Çarkta, kurallarda ve komut satırında. |
| **Kütüphane** | Kento'nun yaptığı son 50 dosya; arama, türe göre süzme, önizleme ve dışarı sürükleme. |
| **Raf** | Ekranın kenarında küçük bir tepsi: dosyaları orada beklet, sonra gitmeleri gereken yere sürükle. |
| **Komut satırı** | Betikler için aynı motorlar ve tarifler: `kento convert photo.heic --to jpg`. |
| **Pencere yerleşimi** | Öndeki pencereyi bir yarıya, bir köşeye, ortaya ya da tam ekrana yerleştiren isteğe bağlı kısayollar. |
| **Diller** | On iki dil, aralarında sağdan sola Arapça; her birinde açık ve koyu görünüm. |

## Ekran görüntüleri

<table>
  <tr>
    <td align="center"><img src="docs/images/kento-wheel-tr.webp" alt="Bir klasördeki fotoğrafın üzerinde açılmış Dönüştür çarkı; imleç PNG'nin üzerinde, açıklaması kadranın altında"><br><sub>Dönüştür çarkı</sub></td>
    <td align="center"><img src="docs/images/kento-tools-dark-tr.webp" alt="Koyu görünümde Araçlar çarkı; Sıkıştır'ın hazır ayarları açık: Yüksek kalite, Dengeli, En küçük, 25 MB altı ve Diğer"><br><sub>Araçlar çarkında bir seçenek halkası, koyu</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/kento-home-tr.webp" alt="Kento'nun Ana Sayfa'sı: listede dört dosya, altında son yapılanlar"><br><sub>Ana Sayfa</sub></td>
    <td align="center"><img src="docs/images/kento-library-dark-tr.webp" alt="Koyu görünümde Kütüphane: dönüştürülmüş, kırpılmış ve indirilmiş dosyalar"><br><sub>Kütüphane, koyu</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/kento-compress-tr.webp" alt="Bir fotoğraf ve bir video için Sıkıştır paneli, kalite 75"><br><sub>Araç panellerinden biri: Sıkıştır</sub></td>
    <td align="center"><img src="docs/images/kento-automation-tr.webp" alt="Üç klasör kuralı ve klasörleriyle Otomasyon sayfası"><br><sub>Klasör kuralları</sub></td>
  </tr>
</table>

## Neleri dönüştürür

Uygulamanın kataloğundan üretilen tam liste [docs/FORMATS.md](docs/FORMATS.md) dosyasında: 54 biçim
ve 355 dönüşüm yolu. Kısaca:

| Tür | Kaynak | Hedef |
| --- | --- | --- |
| Görseller | AVIF, BMP, GIF, HEIC, JPG, PNG, SVG, TIFF, WEBP | JPG, PNG, WEBP, AVIF, BMP, TIFF, GIF, PDF, ICO; sistem yazabiliyorsa HEIC; hareketli GIF'ten MP4, WEBM, MOV |
| Video | AVI, MKV, MOV, MP4, WEBM, WMV | birbirine, GIF, MP3, M4A, WAV |
| Ses | AIFF, FLAC, M4A, MP3, OGG, OPUS, WAV, WMA | birbirine |
| Belgeler | DOCX, DOC, ODT, RTF, RTFD, PAGES, TXT, MD, HTML, EPUB, TEXTCLIPPING | PDF, DOCX, ODT, RTF, TXT, MD, HTML, EPUB |
| Tablolar | CSV, TSV, XLS, XLSX, ODS, NUMBERS | XLSX, ODS, CSV, TSV, PDF, HTML |
| Sunumlar | PPT, PPTX, ODP, KEY | PDF, PPTX, ODP, her slayt için bir PNG ya da JPG |
| PDF | PDF | her sayfa için bir JPG ya da PNG, TXT, MD, XLSX (tablolar), DOCX, PPTX, EPUB, HTML |
| Altyazılar | SRT, VTT | SRT, VTT, TXT |
| Arşivler | ZIP, TAR, GZ, 7Z, RAR (yalnızca okuma) | ZIP, TAR, TAR.GZ, 7Z |

Hiçbir şey indirmeden Kento görselleri, arşivleri, altyazıları, düz metni, Markdown'ı ve HTML'yi,
tabloları CSV, TSV, XLSX ve HTML'ye, PDF sayfalarını da görsele, metne ve tabloya dönüştürür. Video
ve ses için Medya araçları; ofis belgeleri, sunumlar ve kalan tablo ve PDF dönüşümleri için Ofis
araçları gerekir ([aşağıya](#kentonun-istek-üzerine-indirdiği-araçlar) bak). Karmaşık belgeler, yeni
biçimin taşıyamadığı özellikleri kaybedebilir. Windows'ta HEIC fotoğraflar için Microsoft'un HEIF
Görüntü Uzantıları ya da Medya araçları gerekir.

## Araçlar

31 araç, çoğu Araçlar çarkında:

| Ne için | Araçlar |
| --- | --- |
| Görseller | Görseli düzenle (boyut, döndürme, parlaklık, kontrast, doygunluk), İşaretle, Çerçeve ekle, Görseli kırp, Kolaj oluştur, Görselde gizle, Arka planı kaldır |
| PDF | PDF'yi böl, PDF'yi düzenle (sayfaları sırala, döndür, çıkar), PDF'leri birleştir, Görsellerden PDF |
| Video | Videonun sesini kaldır, Videoyu kes, Video alanını kırp, Video hızını değiştir, Videoları birleştir, Video karelerini çıkar, Videoyu böl, Videoda gizle, Altyazı göm |
| Ses | Ses seviyesini normalize et, Sesi kes, Ses kanalları, Seste gizle, Sesten video |
| Birçok tür | Sıkıştır, Meta veri, Metni çıkar, QR kod oku, Arşivi aç, QR kod oluştur |

- **Sıkıştır** görselleri, videoyu, sesi ve PDF'yi kaliteye, orana ya da "25 MB'ın altı" gibi bir
  hedef boyuta göre sıkıştırır ve daha küçük olmayan bir dosyayı hiç yazmaz.
- **Meta veri** görüntüler, düzenler ve kaldırır; **Metni çıkar** görsellerdeki ve PDF
  sayfalarındaki metni Windows'un ve macOS'un kendi yazı tanımasıyla okur; **QR kod oku** TXT, CSV
  ya da JSON rapor yazar; **Arşivi aç** zararlı yollara, bağlantılara ve arşiv bombalarına karşı
  denetler; **QR kod oluştur** Ana Sayfa'da metinden ya da bağlantıdan PNG veya SVG yapar.
- **Dosya işlemleri:** Paylaş, Rafa koy, Kopyala…, Taşı…, Yolu kopyala, Terminalde aç, Explorer'da
  ya da Finder'da göster ve Arşivle (ZIP; halkasından 7Z ve TAR.GZ).

## Kento'nun istek üzerine indirdiği araçlar

Kento'nun kendisi küçüktür. Video, ses, ofis dosyaları ve birkaç ek özellik için gereken ücretsiz
araçlar, sen istediğinde bir kez indirilir: Ana Sayfa'da (**Kurulumu tamamla**), Ayarlar →
Araçlar'da ya da soluk görünen bir dilimi seçince. Her grup önce boyutunu gösterir ve yalnızca eksik
olanı kurar.

| Grup | Ne için | Araçlar | Lisanslar |
| --- | --- | --- | --- |
| Medya | video, ses ve web'den indirme | FFmpeg, yt-dlp, Deno | GPL-3.0-or-later (FFmpeg derlemeleri ve yt-dlp programı), MIT (Deno) |
| Ofis | belgeler, tablolar, sunumlar | LibreOffice | MPL-2.0 |
| Ekstra | görsellerin meta verisi, arka plan kaldırma | ExifTool, ONNX Runtime, BEN2 Base modeli | Artistic ya da GPL (ExifTool, Perl gibi), MIT, MIT |

<details>
<summary><strong>Araçlar nasıl denetlenir</strong></summary>

- Her dosya adresi, boyutu ve SHA-256 değeriyle
  [src-tauri/toolchain.lock.json](src-tauri/toolchain.lock.json) içinde sabitlenmiştir ve
  yayıncısının kendi sürümünden gelir. Denetimi geçemeyen bir dosya asla çalıştırılmaz. Yarıda kalan
  indirmeler kaldığı yerden sürer.
- Bilgisayarında zaten olan araçlar yeterince yeniyse onlar kullanılır (FFmpeg 6, LibreOffice 7,
  ExifTool 12, yt-dlp 2025.11.12, Deno 2.3 ya da daha yenisi). Ayarlar → Araçlar'dan kendi seçtiğin
  bir programı da gösterebilirsin.
- Araçlar ayrı programlar olarak çalışır; hiçbiri Kento'nun koduna bağlanmaz. Siteler Kento'nun
  sürümlerinden hızlı değiştiği için yt-dlp'nin Ayarlar → Araçlar'da kendi **yt-dlp'yi güncelle**
  düğmesi vardır.
- Sürümleri, kaynakları ve sağlama değerleri [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md), lisansları
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) dosyasında.

</details>

## Kento'yu indir

| | |
| --- | --- |
| Windows 10 (1809 ya da sonrası) ve Windows 11, x64: kurulum dosyası | [Kento-Windows-x64-Setup.exe](https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-Windows-x64-Setup.exe) |
| Windows, taşınabilir | [Kento-Windows-x64-Portable.zip](https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-Windows-x64-Portable.zip) |
| macOS 13 ya da sonrası, Apple silicon ve Intel | [Kento-macOS-Universal.dmg](https://github.com/MehmetBurakTaskaya/kento/releases/latest/download/Kento-macOS-Universal.dmg) |

Bu bağlantılar her zaman en yeni sürüme gider. Her sürüm, dosyalarının SHA-256 değerlerini
`SHA256SUMS.txt` içinde listeler; indirdiğin dosyayı karşılaştırmak için PowerShell'de
`Get-FileHash .\Kento-Windows-x64-Setup.exe`, Terminal'de `shasum -a 256 Kento-macOS-Universal.dmg`
komutunu çalıştır.

- **Kurulum dosyası.** Kento yalnızca senin kullanıcın için kurulur, yönetici izni istemez.
  Windows'ta Microsoft Edge WebView2 yoksa kurulum dosyası onu indirir (Windows 11'de zaten vardır)
  ve komut satırını PATH'ine ekler.
- **Taşınabilir.** İstediğin yere aç ve `kento.exe`'yi çalıştır. Verilerin yine
  `%LOCALAPPDATA%\Kento` altında durur; taşınabilir kopya da kurulu olan gibi kendini güncel tutar.
- **macOS.** Disk görüntüsünü aç ve Kento'yu Uygulamalar klasörüne sürükle; orada kendini güncel
  tutabilir.

### İlk açılış

<details>
<summary><strong>Windows: "Windows kişisel bilgisayarınızı korudu"</strong></summary>

Kento kod imzalı değil (sertifikalar ücretli; bkz. [docs/SIGNING.md](docs/SIGNING.md)). Bu yüzden
SmartScreen "Windows kişisel bilgisayarınızı korudu" diyebilir: **Ek bilgi → Yine de çalıştır**'ı
seç.

</details>

<details>
<summary><strong>macOS: Yine de Aç</strong></summary>

Her Mac derlemesi projenin kendi sertifikasıyla imzalanır ama Apple tarafından değil; bu yüzden
Kento Apple onaylı (notarised) değildir ve macOS ilk açılışı engeller:

1. Kento'yu aç. macOS onu doğrulayamadığını söyleyince uyarıyı macOS'unda hangisi varsa **Bitti**
   ya da **Vazgeç** ile kapat (Çöp Sepeti'ne Taşı ile değil).
2. **Sistem Ayarları → Gizlilik ve Güvenlik**'i aç, aşağı kaydır ve Kento'nun yanındaki **Yine de
   Aç**'ı seç. Düğme, açmayı denedikten sonra yaklaşık bir saat orada kalır.
3. Yine **Yine de Aç**'ı seç ve parolanı gir. Bundan sonra Kento her uygulama gibi açılır.

Ya da Terminal'de: `xattr -dr com.apple.quarantine /Applications/Kento.app`

Kento sürüklemeleri hiçbir klavye ya da giriş izleme izni olmadan görür. ⌃⇧Space için Finder'daki
seçimi okumadan önce macOS bir kez izin ister (Otomasyon); Erişilebilirlik iznini ise Kento yalnızca
pencere yerleşimini açarsan ister. Her sürüm aynı sertifikayla imzalandığı için güncellemeler bu
izinleri korur. Apple silicon'da Kento'nun indirdiği FFmpeg Rosetta 2 ile çalışır; macOS ilk seferde
onu kurmayı önerir.

</details>

## Gizlilik

Dönüştürme ve düzenleme bilgisayarında olur: hiçbir dosya yüklenmez; hesap, analiz, telemetri ya da
çökme raporu yoktur. Kento internete yalnızca güncellemeleri denetleyip indirmek, kurmayı kabul
ettiğin bir aracı indirmek ve senin istediğin bir bağlantıyı indirmek için çıkar. Tarayıcından asla
çerez almaz; panoyu yalnızca sen yapıştırdığında ya da Ctrl+Shift+D'ye bastığında okur.

<details>
<summary><strong>Gizlilik üzerine daha fazlası</strong></summary>

- Sen istediğinde daha yeni bir yt-dlp de indirilir. Bir bağlantı için Kento, bağlantının ne
  içerdiğini okur; pencerede gösterilen resimleri ve dosyaların kendisini indirir.
- Ofis belgeleri makrolar kapalıyken dönüştürülür ve bağlantı verdikleri hiçbir şey internetten
  yüklenmez.
- Günlükler bilgisayarında kalır, döndürülür ve dosyalarının içeriğini asla içermez.
- Veriler Windows'ta `%LOCALAPPDATA%\Kento`, Mac'te `~/Library/Application Support/Kento` altında
  durur: ayarlar, Kütüphane listesi, raf, tarifler, kurallar, indirilen araçlar ve günlükler.
  Güncellemeler bunları asla silmez.
- Geliştiricinin gördüğü tek sayılar, GitHub'ın her sürüm dosyası için tuttuğu indirme sayılarıdır.

</details>

## Güncellemeler

Kento kendini güncel tutar ve güncellemeler isteğe bağlı değildir: Atla ya da Sonra yoktur. Her
güncelleme, projenin Kento'ya gömülü güncelleme anahtarıyla yapılmış bir imza taşımak zorundadır ve
ancak çalışan ve sırada bekleyen işler bitince kurulur. Ayarların, Kütüphane, raf, tarifler,
kurallar ve araçlar yerinde kalır.

<details>
<summary><strong>Güncellemeler üzerine daha fazlası</strong></summary>

- Kento açılışta, 6 saatte bir ve sen istediğinde (Ayarlar → Güncellemeler → **Şimdi denetle** ya
  da Ctrl+U, Mac'te ⌘U) yeni sürüm arar.
- Yeni sürüm arka planda iner ve imzası tam olarak duyurulan sürüm için olmalıdır. Başka hiçbir şey
  kabul edilmez. Anahtarın nasıl saklandığı [docs/SIGNING.md](docs/SIGNING.md) dosyasında.
- İndirme bitince yeni iş başlamaz. Çalışan ve sırada bekleyen işler biter, ardından Kento bunu
  söyler, yeniden başlar ve yeni sürümü kurar.
- Bağlantı yokken Kento çalışmaya devam eder ve bağlantı dönünce ilk denetimde güncellenir.
- Denetim, GitHub'da bu deponun en yeni sürümünden küçük bir dosya (`latest.json`) okur. Senin,
  bilgisayarın ya da dosyaların hakkında hiçbir şey göndermez; GitHub bu isteği her indirme gibi
  görür.
- Yeni sürümün notları ilk açılışında görünür.

</details>

## Nasıl kullanılır

<details>
<summary><strong>Çark</strong></summary>

Bir ya da birkaç dosyayı sürükle ve sürüklerken bir tuşa bas:

| Çark | Windows | macOS |
| --- | --- | --- |
| Dönüştür | Shift | Shift |
| Araçlar | Ctrl | ⌘ |
| Dosya işlemleri | Alt | ⌃ |

- Tuşu bıraktığında çark açık kalır: sürüklemeye devam et ve dosyaları bir dilime bırak. Esc ya da
  dosyaları çarkın dışına bırakmak işi iptal eder. Başka bir tuş, o tuşun çarkına geçer.
- Dönüştür çarkı yalnızca seçili dosyaların hepsinin dönüşebileceği biçimleri gösterir. Karışık bir
  seçimde önce dosya türleri gelir: birini açmak için üzerinde bekle.
- **Seçenek halkaları.** Bir dilimin üzerinde yarım saniye bekle, seçenekleri etrafında açılsın:
  resim kalitesi, tek PDF ya da ayrı PDF'ler, çözünürlük, hazır ayarlar, son kullanılan klasörler ve
  dahası. Dilime doğrudan bırakmak varsayılanı uygular; göbekte beklemek geri götürür.
- Klavyeyle: Yukarı ve Aşağı dilimler arasında gezer, Sağ ya da Enter dilimin seçeneklerini açar ya
  da onu uygular, Sol, Esc ya da Backspace geri gider, Boşluk uygular, Tab kapatır.
- Her iş orijinalin yanına yeni bir dosya yazar: `photo.heic`, `photo.jpg` olur; o ad doluysa
  `photo (2).jpg`. Araçlar ada bir sözcük ekler: `video - kesilmiş.mp4`. Kento hiçbir dosyanın
  üzerine yazmaz; orijinali yalnızca onayladığın Taşı işlemi taşır. Ayarlar → Çıktı her şeyi tek
  bir klasöre gönderebilir.
- Tuşlar Ayarlar → Çark'tan değiştirilebilir.

Windows'ta yönetici olarak çalışan bir programda başlayan sürüklemeyi Kento göremez, çünkü Windows
ikisini birbirinden ayırır. Bunu aşmak için lütfen Kento'yu yönetici olarak çalıştırma.

</details>

<details>
<summary><strong>Sürüklemeden: kısayollar, Ana Sayfa, Kütüphane ve Ayarlar</strong></summary>

- **Ctrl+Shift+Space** (Mac'te ⌃⇧Space), Explorer'da ya da Finder'da seçili dosyalar için çarkı
  imlecin olduğu yerde açar. Seçilenlerin hiçbiri dönüştürülemiyorsa dosya işlemleri açılır.
- **Ctrl+Shift+D** (⌃⇧D) panodaki bağlantıyı indirir. Açıkken tarayıcının kendi Ctrl+Shift+D
  kısayolu tarayıcıya ulaşmaz; Ayarlar'dan kapatılabilir.
- **Ana Sayfa** (Ctrl+1): dosyaları bırak, seç (Ctrl+O) ya da yapıştır (Ctrl+V). Yapıştırılan metin
  bir `.txt` dosyası, yapıştırılan resim bir `.png` olur, yapıştırılan bağlantı ise indirmeyi başlatır.
  Dosya listesinde Enter Dönüştür çarkını, Ctrl+Space araçları, Alt+Enter dosya işlemlerini açar;
  Delete dosyayı diskten değil, yalnızca listeden çıkarır. Ana Sayfa son yapılanları, araçların
  durumunu ve çalışan işleri de gösterir.
- **Kütüphane** (Ctrl+2): Kento'nun yaptığı son 50 dosya; arama (Ctrl+F), türe göre süzme,
  önizleme, Explorer'da ya da Finder'da gösterme, dışarı sürükleme ve çarka gönderme.
- **Otomasyon** (Ctrl+3): klasör kuralları ve tarifler.
- **Ayarlar** (Ctrl+,).
- **Explorer** (Windows): Kento kendini Gönder menüsüne ve sağ tık menüsüne ekleyebilir. İkisi de
  sen Ayarlar → Explorer'dan açana kadar kapalı kalır.

Mac'te pencere kısayolları Ctrl yerine ⌘ ile çalışır. Pencereyi kapatınca Kento bildirim alanında
(Mac'te menü çubuğunda) kalır; menüsünden Ana Sayfa'yı ve Ayarlar'ı açabilir, işleri
duraklatabilir ve Kento'dan çıkabilirsin.

</details>

<details>
<summary><strong>Raf</strong></summary>

Dosya işlemlerindeki **Rafa koy**, dosyaları Kento'nun rafına koyar: ekranın kenarında küçük bir
pencere. Başka bir klasöre geç ve dosyaları raftan gitmeleri gereken yere sürükle. Raf her dosyanın
kopyasını değil, kendisine giden bir referansı tutar (Ayarlar → Raf istersen kopya da tutar) ve bir
dosya taşındığında ya da silindiğinde bunu gösterir. Geçmişinde arama yapılabilir, dosyaları çarka
gönderilebilir ya da Explorer'da veya Finder'da gösterilebilir.

</details>

<details>
<summary><strong>Web'den indirme</strong></summary>

Ana Sayfa'ya bir bağlantı yapıştır, bir bağlantıyı kopyalayıp Ctrl+Shift+D'ye bas ya da tarayıcıdan
bir bağlantıyı veya videoyu bir tuşa basılıyken sürükle (ya da Ana Sayfa'ya bırak): Kento neyi
indireceğini (videoyu, yalnızca sesini, orijinalini, bir YouTube küçük resmini, bir fotoğraf
gönderisinden seçtiğin resimleri), hangi kalitede ve hangi klasöre indireceğini sorar. DRM ya da
oturum açma arkasındaki içerik, canlı yayınlar, profillerin ve oynatma listelerinin tamamı
desteklenmez; Kento tarayıcından asla çerez almaz. Yalnızca indirme hakkın olan içerikleri indir.

</details>

<details>
<summary><strong>Otomasyon ve tarifler</strong></summary>

Bir **kural** bir klasörü izler ve oraya düşen her yeni dosyayı işler: dosyayı dönüştürür, üzerinde
bir araç ya da tarif çalıştırır veya onu taşır, sonucu da seçtiğin yere koyar. Örneğin Ekran
Görüntüleri'ne düşen PNG'ler Optimize klasöründe WEBP olur. Kento bir dosyanın yazılması bitene kadar
bekler, kendi sonuçlarını asla yeniden işlemez ve bir etkinlik günlüğü tutar.

Bir **tarif**, adımları bir ad altında birbirine bağlar; örneğin "Instagram": 4:5 kırp, 1080 px'e
boyutlandır ve 2 MB'ın altına sıkıştır. Tarifler çarkın Favoriler diliminde, kurallarda ve komut
satırında çıkar.

</details>

<details>
<summary><strong>Pencere yerleşimi</strong></summary>

Ayarlar → Pencere yerleşimi'nden açana kadar kapalıdır. Açınca kısayollar öndeki pencereyi yerleştirir,
hiçbir şey seçili değilken Ctrl+Shift+Space de bir Pencere halkası açar. Hiçbir kısayol Windows
tuşunu kullanmaz; Windows Snap olduğu gibi kalır.

| Yerleşim | Windows | macOS |
| --- | --- | --- |
| Sol ya da sağ yarı | Ctrl+Alt+← / → | ⌃⌥⌘← / → |
| Tam ekran | Ctrl+Alt+↑ | ⌃⌥⌘↑ |
| Orta | Ctrl+Alt+↓ | ⌃⌥⌘↓ |
| Sol üst ya da sağ üst | Ctrl+Alt+Home / Page Up | ⌃⌥⌘U / I |
| Sol alt ya da sağ alt | Ctrl+Alt+End / Page Down | ⌃⌥⌘J / K |

</details>

<details>
<summary><strong>Diller</strong></summary>

Kento on iki dil konuşur ve sistemin dilini izler; Ayarlar → Dil onu hemen, bütün pencerelerde
değiştirir: İngilizce, Türkçe, İspanyolca, Basitleştirilmiş Çince, Japonca, Almanca, Fransızca,
Brezilya Portekizcesi, Arapça (sağdan sola), Korece, İtalyanca ve Rusça. İngilizce ve Türkçe elle
denetlendi; diğer on dil yeni ve anadili konuşan birinin gözden geçirmesini bekliyor. Düzeltmeler
memnuniyetle karşılanır: [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bak (İngilizce).

</details>

## Komut satırı

<details>
<summary><strong>Bir terminalden dönüştür, araç ve tarif çalıştır</strong></summary>

```sh
kento convert photo.heic --to jpg
kento convert report.docx notes.md --to pdf --out PDFs
kento tool compress video.mp4 --target-size 25MB
kento tool merge-pdf part1.pdf part2.pdf
kento recipe run Instagram photo.jpg
kento routes heic
```

Komut satırı, uygulamayla aynı motorları, tarifleri ve adlandırma kurallarını bir pencere açmadan
çalıştırır. Sonuçlar her dosyanın yanına ya da gerekirse Kento'nun oluşturduğu `--out` klasörüne
gider.

| Komut | Ne yapar |
| --- | --- |
| `kento convert DOSYALAR… --to BİÇİM` | her dosyayı dönüştürür |
| `kento tool ARAÇ DOSYALAR…` | bir araç çalıştırır: `compress` (`--quality 1–100`, `--ratio 5–95` ya da `--target-size`), `mute`, `normalize`, `merge-video`, `extract`, `merge-pdf`, `images-to-pdf` (`--page fit\|a4\|letter`, `--margin`), `read-qr` (`--format txt\|csv\|json`) |
| `kento recipe list`, `kento recipe run TARİF DOSYALAR…` | tariflerini listeler ya da çalıştırır |
| `kento formats`, `kento routes BİÇİM` | biçimleri listeler ya da bir biçimin neye dönüştüğünü ve nelerden ona dönüşüldüğünü gösterir |
| `kento help KOMUT` | bir komutu anlatır |

Seçenekler: `-o`/`--out KLASÖR`, `--json` (sonuç tek bir JSON belgesi olarak), `-q`/`--quiet`,
`-h`/`--help`, `-V`/`--version`. Çıkış kodları: 0 bitti, 1 bir iş başarısız oldu, 2 yanlış kullanım,
3 mümkün değil, 4 bir araç eksik, 130 iptal edildi (Ctrl+C işi iptal eder ve yarım kalan çıktısını
siler). Bir pencerede seçim yapılması gereken araçlar (örneğin düzenleyiciler) komut satırında
yoktur.

- **Windows:** `kento.com`, `kento.exe`'nin yanında durur ve kurulum dosyası onun klasörünü
  kullanıcının PATH'ine ekler; böylece açtığın her yeni terminalde `kento` çalışır. Taşınabilir
  ZIP'te onu kendi klasöründen çalıştır ya da klasörü PATH'ine kendin ekle.
- **macOS:** komut satırı `Kento.app/Contents/MacOS/kento-cli`'dır. `kento` yazabilmek için onu
  PATH'indeki bir klasöre bağla:

  ```sh
  sudo mkdir -p /usr/local/bin
  sudo ln -sf /Applications/Kento.app/Contents/MacOS/kento-cli /usr/local/bin/kento
  ```

</details>

## Kaynaktan derleme

Node.js 24, kararlı Rust araç zinciri (Windows'ta C++ iş yüküyle Visual Studio Build Tools, macOS'ta
Xcode Command Line Tools ile) ve Windows'ta WebView2 gerekir; WebView2 Windows 10 ve 11'de zaten
vardır.

```sh
npm ci
npm run pdfium                        # Kento ile gelen sabit sürümlü PDFium kütüphanesi
npm run tauri dev                     # Kento'yu canlı yenilemeyle çalıştır
npm run tauri build -- --no-bundle    # src-tauri/target/release içinde kento ve kento-cli sürüm derlemeleri
```

Kurulum dosyası ya da disk görüntüsüyle tam bir derleme güncelleme dosyalarını da imzalar, bu yüzden
`TAURI_SIGNING_PRIVATE_KEY` ister; yerel bir deneme için `npx tauri signer generate` ile üretilen
geçici bir anahtar yeterlidir. Sürüm yayımlama [docs/RELEASING.md](docs/RELEASING.md) dosyasında
anlatılıyor.

<details>
<summary><strong>CI neleri denetler</strong></summary>

CI her push ve pull request'te Windows ve macOS'ta şunları çalıştırır:

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run check:i18n
npm run check:spdx
npm run check:licenses
npm run check:third-party
cargo fmt --all --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace
```

Bunlara ek olarak `src-tauri` içinde `cargo deny check`, [docs/FORMATS.md](docs/FORMATS.md)
dosyasının katalogla uyuştuğunun denetimi (`npm run catalog:export` onu yazar), bir sürüm derlemesi,
`kento --smoke-test` ve komut satırının bir denemesi çalışır. Hangi testlerin FFmpeg, LibreOffice ve
diğer araçlara ihtiyaç duyduğu [CONTRIBUTING.md](CONTRIBUTING.md) dosyasında.

</details>

Tasarım sistemi [design/DESIGN.md](design/DESIGN.md), şartname [docs/SPEC.md](docs/SPEC.md), kodun
yapısı [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) dosyasında. Yukarıdaki tanıtım ve ekran
görüntüleri `npm run demo` ile doğrudan uygulamanın kendisinden kaydedilir.

## Katkı

Issue ve pull request'ler memnuniyetle karşılanır; büyük değişiklikler için lütfen önce bir issue
aç. Nasıl yapılacağı [CONTRIBUTING.md](CONTRIBUTING.md) dosyasında anlatılıyor (İngilizce). Güvenlik
sorunlarını lütfen [SECURITY.md](SECURITY.md)'de anlatıldığı gibi gizlice bildir. Katılan herkes
[Davranış Kuralları](CODE_OF_CONDUCT.md)'na uyar.

## Lisans

[MIT](LICENSE) © 2026 Mehmet Burak Taşkaya. Kento'nun üzerine kurulduğu açık kaynak paketler
lisanslarıyla [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), sürümleri ve sağlama değerleriyle
[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) dosyasında listelenir.

---

<p align="center">Made by Mehmet Burak Taşkaya · <a href="https://mehmetburaktaskaya.com">mehmetburaktaskaya.com</a></p>
