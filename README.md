# Timay

Avukat onaylı yapay zekâ hukuk asistanı. Windows masaüstü uygulaması (Electron) ve büroların ortak kullandığı küçük bir sunucudan oluşur.

Temel kural: bir dilekçe, onu yazan dışında bir avukat onaylamadan **Onaylı** olamaz. Arşivde karşılığı olmayan bir karar atıfı varsa dilekçe incelemeye gönderilemez.

## Klasörler

| Klasör | İçerik |
| --- | --- |
| `server/` | Express + SQLite sunucusu: büro, kullanıcı, dava dosyası, dilekçe, onay akışı, karar arşivi |
| `desktop/` | Electron + React Windows uygulaması |
| `.github/workflows/` | Testler ve Windows kurulum dosyasının (.exe) otomatik üretimi |

## Geliştirme

```bash
npm install
npm run server    # http://localhost:4000
npm run desktop   # Electron penceresini açar
npm test          # onay akışı testleri
```

Masaüstü uygulaması varsayılan olarak `http://localhost:4000` sunucusuna bağlanır. Adres giriş ekranındaki "Sunucu: … Değiştir" bağlantısından değiştirilebilir.

## Sunucuyu internete kurma (Render)

1. [render.com](https://render.com) üzerinde GitHub hesabıyla oturum açın.
2. **New → Blueprint** seçin ve `timay-ai` deposunu gösterin. Render, depodaki `render.yaml` dosyasına göre sunucuyu ve 1 GB'lık veri diskini kurar.
3. Kurulum bitince verilen adresi (ör. `https://timay-sunucu.onrender.com`) GitHub'da depo **Settings → Secrets and variables → Actions → Variables** bölümüne `TIMAY_SERVER_URL` adıyla ekleyin. Bundan sonra üretilen Windows kurulum dosyaları bu adrese otomatik bağlanır.

Sunucu `Dockerfile` ile her yerde çalışır; Türkiye'deki bir sunucuya taşımak için aynı imaj kullanılabilir. Veriler `DB_FILE` (varsayılan `/data/timay.db`) dosyasında tutulur.

## Windows kurulum dosyası

`main` dalına her gönderimde GitHub Actions Windows makinesinde `Timay Setup x.y.z.exe` üretir. Dosya, ilgili çalıştırmanın **Artifacts** bölümünde `Timay-Windows-Kurulum` adıyla indirilebilir. Kod imzalama sertifikası eklenene kadar Windows ilk açılışta "bilinmeyen yayıncı" uyarısı gösterir.

## Onay akışı

```
Taslak → (atıf kontrolü) → İncelemede → Onaylı
                               ↓
                       Düzeltme istendi → yeni sürüm → Taslak
```

- Stajyerler dilekçe yazabilir, onaylayamaz.
- Dilekçenin herhangi bir sürümünü yazan avukat o dilekçeyi onaylayamaz.
- İncelemedeki ve onaylı dilekçe değiştirilemez; her değişiklik yeni sürüm olarak saklanır.

## Sıradaki adımlar

- Yargıtay ve UYAP Emsal kararlarından içtihat arşivinin doldurulması
- Dava dosyasından yapay zekâ ile dilekçe taslağı (Claude API)
- Word (.docx) çıktısı
- Dilekçe şablon kütüphanesi
