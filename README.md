# Antigravity Web (`agy-web`)

Antigravity Web UI & Pairing Server — hasil ekstraksi penuh dan modifikasi kustom dari arsitektur Web UI OpenCode v2 yang disesuaikan khusus untuk **Google DeepMind Antigravity (`agy`)**.

## Fitur Utama
- **Full Custom Web UI (`AGY-CODE`)**: Seluruh 2.870 aset Web UI diekstrak ke [`dist/`](file:///root/projects/agy-web/dist) dan dimodifikasi dengan logo/wordmark interaktif **AGY-CODE**, ikon pixel **A**, serta *branding* **Antigravity Web**.
- **Native Antigravity AI Bridge (`/v1/chat/completions`)**: Terintegrasi langsung dengan CLI `agy` (mendukung **Gemini 4 Argon**, **Gemini 3.8 Flash**, **Claude Opus 5.5**, **Claude Sonnet 5.5**, dan **GPT-OSS 120B**) lengkap dengan *Zero-Interruption Auto-Rotation* (`agy-switcher --rotate`) saat kuota terkena limit (HTTP 429).
- **One-Time Pairing & QR Code**: Mendukung *pairing* instan ke browser lokal maupun perangkat lain di jaringan LAN menggunakan tautan sekali pakai dan QR Code di terminal.
- **Persistent Web Terminal (PTY)**: Mendukung terminal interaktif langsung di dalam browser melalui WebSocket proxy.

## Cara Penggunaan

Kamu bisa menjalankannya menggunakan perintah **`agy web`** (atau **`agy-web`** / **`agy pair`**):

```bash
# Buat one-time pairing link + QR code (otomatis menyalakan server di background)
agy web

# Langsung buka Web UI di browser
agy web open

# Cek status server dan daftar URL (localhost & LAN)
agy web status

# Lihat password autentikasi manual
agy web password

# Restart atau hentikan server background
agy web restart
agy web stop
```

## Struktur Proyek
- [`bin/agy-web`](file:///root/projects/agy-web/bin/agy-web) — CLI Launcher & Pairing generator (`agy web` / `agy-web`).
- [`server.js`](file:///root/projects/agy-web/server.js) — Server HTTP/WebSocket, Brotli static asset server, & Antigravity AI Bridge.
- [`qr.js`](file:///root/projects/agy-web/qr.js) — Generator QR Code Unicode terminal murni (tanpa dependensi eksternal).
- [`dist/`](file:///root/projects/agy-web/dist) — Full kode frontend Web UI yang sudah dimodifikasi untuk Antigravity.
