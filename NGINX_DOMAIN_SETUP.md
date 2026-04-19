# Nginx Domain Setup

Panduan ini untuk mengekspos `app-api` dari proyek ini ke domain atau subdomain tanpa mengganggu aplikasi lain yang sudah berjalan di VPS.

Setup saat ini dari `docker-compose.yml`:

- `app-api` hanya listen di host lokal: `127.0.0.1:4010`
- `consumet` hanya listen di host lokal: `127.0.0.1:3010`

Itu bagus untuk produksi karena:

- hanya `Nginx` yang perlu dibuka ke publik
- `consumet` tetap internal
- aplikasi lain di VPS tidak perlu disentuh

## Domain yang dipakai

Panduan ini sudah disesuaikan untuk domain:

- `api.buffers.site`

Jangan edit file site lain yang sudah ada seperti:

- `/etc/nginx/sites-available/anime.buffers.site`
- `/etc/nginx/sites-available/drakor-api`
- `/etc/nginx/sites-available/layardrama.id`
- `/etc/nginx/sites-available/movie`

Buat **file site baru terpisah** untuk proyek ini.

## 1. Pastikan API lokal hidup

Di VPS:

```bash
cd ~/moviescraper
docker compose ps
curl http://127.0.0.1:4010/health
```

Respons sehat:

```json
{"ok":true,"service":"app-api"}
```

## 2. Buat file config Nginx baru

Buat file:

```bash
nano /etc/nginx/sites-available/api.buffers.site
```

Isi dengan ini:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.buffers.site;

    access_log /var/log/nginx/api.buffers.site.access.log;
    error_log /var/log/nginx/api.buffers.site.error.log;

    location / {
        proxy_pass http://127.0.0.1:4010;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

Config ini aman karena:

- hanya membuat `server` baru
- hanya mem-proxy ke `127.0.0.1:4010`
- tidak mengubah config aplikasi lain

## 3. Aktifkan site baru

```bash
ln -s /etc/nginx/sites-available/api.buffers.site /etc/nginx/sites-enabled/api.buffers.site
```

Jika symlink sudah ada, jangan buat ulang.

## 4. Test config sebelum reload

```bash
nginx -t
```

Kalau valid, baru reload:

```bash
systemctl reload nginx
```

Jangan reload sebelum `nginx -t` sukses.

## 5. Arahkan DNS

Di panel DNS domain Anda, buat record:

- type: `A`
- host: `api`
- value: `IP_VPS`

Kalau pakai Cloudflare:

- boleh mulai dari `DNS only`
- setelah normal, bisa pindah ke proxy Cloudflare

## 6. Verifikasi dari publik

Karena Anda sudah mengarahkan domain ini untuk API, tinggal verifikasi:

```bash
curl http://api.buffers.site/health
curl "http://api.buffers.site/api/media?q=breaking%20bad&lang=id&page=1&limit=10"
```

## 7. Pasang SSL

Jika domain sudah mengarah ke VPS:

```bash
apt update
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.buffers.site
```

Setelah itu tes:

```bash
curl https://api.buffers.site/health
```

## Endpoint yang dipakai frontend

Contoh request dari frontend:

```txt
GET https://api.buffers.site/api/media?q=breaking%20bad&lang=id&page=1&limit=20
GET https://api.buffers.site/api/media/:publicId?lang=id
GET https://api.buffers.site/api/media/:publicId/seasons
GET https://api.buffers.site/api/media/:publicId/episodes?seasonNumber=1
GET https://api.buffers.site/api/media/:publicId/subtitles?lang=id
GET https://api.buffers.site/api/media/:publicId/episodes/:seasonNumber/:episodeNumber/subtitles?lang=id
```

## Catatan penting tentang CORS

`app-api` sekarang mendukung CORS, jadi frontend beda domain dapat memanggil API ini langsung dari browser.

Env yang dipakai:

```env
APP_API_CORS_ALLOWED_ORIGINS=*
```

Artinya semua origin diizinkan. Ini cocok untuk API publik read-only seperti proyek ini.

Kalau nanti ingin dibatasi hanya ke domain frontend tertentu, ubah menjadi daftar origin dipisahkan koma:

```env
APP_API_CORS_ALLOWED_ORIGINS=https://frontend1.com,https://app.frontend2.com
```

Setelah ubah env, rebuild dan restart `app-api`:

```bash
cd ~/moviescraper
docker compose build app-api
docker compose up -d app-api
```

## Contoh env frontend

Contoh untuk Next.js / Nuxt / Vite:

```env
NEXT_PUBLIC_API_BASE_URL=https://api.buffers.site
```

Contoh pemakaian:

```ts
const res = await fetch(
  `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/media?q=breaking%20bad&lang=id&page=1&limit=20`
);
const data = await res.json();
```

## Checklist aman

- buat file site baru, jangan edit site lama
- proxy hanya ke `127.0.0.1:4010`
- jangan expose `127.0.0.1:3010` ke publik
- jalankan `nginx -t` sebelum reload
- verifikasi `curl http://127.0.0.1:4010/health`
- verifikasi `curl https://api.buffers.site/health`

## Verifikasi CORS

Tes dari VPS:

```bash
curl -i -X OPTIONS https://api.buffers.site/api/media \
  -H "Origin: https://frontend-contoh.com" \
  -H "Access-Control-Request-Method: GET"
```

Kalau benar, respons akan mengandung header seperti:

```txt
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
```
