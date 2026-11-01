# Kento

**Yazan: [Mehmet Burak Taşkaya](https://mehmetburaktaskaya.com)** · [English](README.md)

Bir dosyayı sürükle, bir değiştirici tuşa bas ve çarkın bir dilimine bırak: Kento dosyayı kendi bilgisayarında dönüştürür, sıkıştırır ve düzenler. Önce Windows, ardından macOS.

> Kento erken geliştirme aşamasında: 10 fazın ilki olan uygulama iskeleti. Henüz bir sürüm yok. İlerleme [docs/ROADMAP.md](docs/ROADMAP.md) dosyasında.

## Neler yapacak

- Görsel, video, ses, belge, tablo, sunum, altyazı, PDF ve arşivleri dönüştürür. Tam liste uygulamanın kataloğundan üretilir: [docs/FORMATS.md](docs/FORMATS.md).
- Aynı çarkta araçlar: sıkıştırma (hedef boyuta da), kırpma, kesme, birleştirme, işaretleme, gizleme, meta veri düzenleme, QR okuma, PDF araçları ve dahası.
- Dosya eylemleri: paylaş, kopyala, taşı, yolu kopyala, orada terminal aç ya da rafa koy.
- Orijinale dokunmaz: her iş kendi adı olan yeni bir kopya yazar.

## Gizlilik

Her şey bilgisayarında olur. Dosyalar hiçbir yere yüklenmez; hesap, analiz ya da telemetri yoktur. Kento yalnızca senin başlattığın araç ve medya indirmeleri için ve güncellemeleri denetlemek için internete bağlanır.

## Kaynaktan derleme

Node.js 24, kararlı Rust araç zinciri (Windows'ta MSVC derleme araçlarıyla) ve WebView2 gerekir; Windows 10 ve 11'de WebView2 zaten vardır.

```sh
npm ci
npm run tauri dev        # Kento'yu canlı yenilemeyle çalıştır
npm test                 # sayfa testleri
cargo test --manifest-path src-tauri/Cargo.toml
```

Varsayılan temanın tasarımı [design/DESIGN.md](design/DESIGN.md), şartname [docs/SPEC.md](docs/SPEC.md), kodun yapısı [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) dosyasında.

## Lisans

[MIT](LICENSE), telif hakkı (c) 2026 Mehmet Burak Taşkaya. Üçüncü taraf bildirimleri ilk sürümle gelecek.
