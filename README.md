# Lab Grafik Aracı

PHYS111 (Genel Fizik Laboratuvarı I, İYTE) deneyleri için tarayıcıda çalışan grafik aracı.
Ham ölçümleri girin; araç föydeki hesapları yapar, grafiği çizer, doğrusal fiti hesaplar ve
grafiği rapora konacak PNG olarak indirir.

- Deneyler: 2 (v_avg – D), 3a (a – Fₐ), 3b (a – m), 4 (F_g – m), 5 (F – x) ve serbest grafik
- Excel/Word'den yapıştırma, nokta veya virgül ondalık, hatalı hücre işaretleme
- Doğrusal fit: eğim ± belirsizlik, kesişim ± belirsizlik, R², n
- PNG indirme (2000 × 1240, beyaz arka plan) ve hesap tablosunu Word/Excel'e kopyalama
- Veriler yalnızca tarayıcının `localStorage`'ında saklanır

## Çalıştırma

Build adımı yok. `index.html` dosyasını bir statik sunucuyla açın ya da GitHub Pages'te yayınlayın.
Grafik için Plotly.js CDN'den yüklenir.

## Dosyalar

| Dosya | İçerik |
|---|---|
| `index.html` | Sayfa iskeleti |
| `style.css` | Arayüz stili |
| `experiments.js` | Deney tanımları, hesaplar, fit ve biçimlendirme yardımcıları |
| `app.js` | Tablo, yapıştırma, grafik, sonuçlar, PNG ve kopyalama |
