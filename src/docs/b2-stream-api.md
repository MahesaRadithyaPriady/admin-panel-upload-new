# API Stream File (B2)

Endpoint ini digunakan untuk melakukan streaming file langsung dari Backblaze B2, dengan dukungan header `Range` (cocok untuk video).

## Endpoint

- **Method**: `GET`
- **URL**:
  - `/b2/stream/:id`
  - `/b2/stream?id=<encodedId>` (alternatif via query)

`id` adalah `fileName` di B2, misalnya:

```text
Kira/Anime/Akujiki Reijou to Kyouketsu Koushaku/Eps.6/ARKK-06-360p-SAMEHADAKU.CARE.mp4
```

Sebelum memanggil endpoint ini, `id` sebaiknya diambil dari:

- `/b2/list` (general)
- `/b2/videos` (khusus video)

## Header Request

- `Range` (opsional)
  - Contoh: `Range: bytes=0-` atau `Range: bytes=100000-200000`
  - Jika dikirim, server akan mengembalikan status `206 Partial Content` dengan header `Content-Range`.

## Perilaku Response

Endpoint ini akan:

1. Mengambil stream file dari B2 berdasarkan `id` (fileName) menggunakan `downloadByName`.
2. Meneruskan sebagian besar header dari B2 ke client:
   - `Content-Type`
   - `Content-Length`
   - `Accept-Ranges`
   - `Content-Range` (jika ada)
   - `ETag`
   - `Last-Modified`
3. Mengirim stream data (`res.data`) sebagai body response.

### Status Code

- `200 OK`
  - Jika tidak ada header `Range` dan file dikirim penuh.

- `206 Partial Content`
  - Jika ada `Range` atau backend menerima `Content-Range` dari B2.

- `400 Bad Request`
  - Jika `id` tidak dikirim.

- `500 Internal Server Error`
  - Jika terjadi error saat mengambil data dari B2.

## Contoh Penggunaan

### 1. Streaming via path param

```bash
GET /b2/stream/Kira%2FAnime%2FAkujiki%20Reijou%20to%20Kyouketsu%20Koushaku%2FEps.6%2FARKK-06-360p-SAMEHADAKU.CARE.mp4
```

### 2. Streaming via query param

```bash
GET /b2/stream?id=Kira%2FAnime%2FAo%20no%20Orchestra%20Season%202%2FEps.5%2FAoO-S2-5-360p-SAMEHADAKU.CARE.mp4
```

### 3. Integrasi dengan `<video>` tag (HTML)

Misal kamu sudah ambil satu video dari `/b2/videos`, lalu dapat field `id`.

```html
<video
  src="/b2/stream/Kira%2FAnime%2FAkujiki%20Reijou%20to%20Kyouketsu%20Koushaku%2FEps.6%2FARKK-06-360p-SAMEHADAKU.CARE.mp4"
  controls
></video>
```

Atau jika ingin pakai query param:

```html
<video
  src="/b2/stream?id=Kira%2FAnime%2FAo%20no%20Orchestra%20Season%202%2FEps.5%2FAoO-S2-5-360p-SAMEHADAKU.CARE.mp4"
  controls
></video>
```

Browser akan otomatis mengirim header `Range` saat melakukan seek / buffering, dan backend akan meneruskan ke B2.

## Catatan

- Endpoint ini **tidak** lagi bergantung pada Google Drive, seluruh data diambil langsung dari Backblaze B2.
- Pastikan environment B2 sudah dikonfigurasi dengan benar (`B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`/`B2_BUCKET_ID`).
