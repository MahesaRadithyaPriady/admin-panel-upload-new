# B2 Upload & File API

Dokumen ini menjelaskan API upload video ke Backblaze B2 **serta operasi dasar file/folder** yang digunakan oleh panel admin:

- Upload file video ke B2.
- Membuat folder virtual.
- Rename file/folder.
- Delete file/folder.

---

## Endpoint Upload

- **Method**: `POST`
- **Path**: `/b2/upload`
- **Content-Type**: `multipart/form-data`

Endpoint ini digunakan untuk **upload file video** ke B2 tanpa proses encoding/transcoding. File dikirim apa adanya, lalu disimpan ke bucket B2 dan dicatat metadatanya di katalog lokal (SQLite).

Endpoint ini **hanya menerima file video**. File non-video (misalnya PDF, DOCX, ZIP) akan ditolak dengan status **400**.

---

## Request

### Field `file` (wajib)

- Tipe: `file` (multipart)
- Deskripsi: File video yang akan di-upload.
- Validasi:
  - `mimetype` harus `video/*`, **atau**
  - Ekstensi file termasuk salah satu:
    - `.mp4`
    - `.mkv`
    - `.webm`
    - `.avi`
    - `.mov`
    - `.m4v`

Jika file tidak memenuhi kriteria di atas, server akan mengembalikan:

```json
{
  "error": "Only video files are allowed for this endpoint"
}
```

### Field `prefix` (opsional)

- Tipe: `string`
- Deskripsi: Prefix/folder tempat file akan disimpan di B2.
- Contoh nilai:
  - `"videos"`
  - `"courses/kelas-a"`

Server akan menormalisasi prefix (menghapus spasi dan `/` berlebih), lalu membentuk `objectKey`:

```text
<prefix>/<original_filename>
```

Contoh:

- `prefix = "videos"`, file `intro.mp4` → `videos/intro.mp4`
- `prefix = "courses/kelas-a"`, file `intro.mp4` → `courses/kelas-a/intro.mp4`

Jika `prefix` tidak diisi, file disimpan langsung di root bucket dengan nama asli file.

---

## Response

### Sukses (200)

```json
{
  "files": [
    {
      "id": "courses/kelas-a/intro.mp4",
      "name": "intro.mp4",
      "mimeType": "video/mp4",
      "size": 123456,
      "modifiedTime": "2025-12-17T05:00:00.000Z"
    }
  ]
}
```

Keterangan:

- `id`: Path lengkap file di B2 (juga disimpan sebagai `file_path` di katalog lokal). Nilai ini bisa dipakai langsung untuk streaming melalui `/b2/stream/:id`.
- `name`: Nama file (basename tanpa folder), sama dengan nama asli file saat upload.
- `mimeType`: MIME type file (contoh: `video/mp4`).
- `size`: Ukuran file dalam byte.
- `modifiedTime`: Waktu upload (ISO string). Bisa `null` jika tidak tersedia.

### Error (contoh)

- Tidak ada file:

  ```json
  {
    "error": "No file provided"
  }
  ```

- Tidak ada `filename`:

  ```json
  {
    "error": "Missing filename"
  }
  ```

- File bukan video:

  ```json
  {
    "error": "Only video files are allowed for this endpoint"
  }
  ```

- Error internal server:

  ```json
  {
    "error": "Failed to upload file to B2",
    "details": "<pesan error>"
  }
  ```

---

## Alur Backend Upload (ringkas)

1. Backend membaca `file` dan `prefix` dari `multipart/form-data`.
2. Validasi nama file (`filename`) dan tipe file (hanya video).
3. Menentukan `objectKey` berdasarkan `prefix` dan nama file.
4. Membaca stream file dan mengupload ke B2 **tanpa encoding** menggunakan `uploadFromStream`.
5. Menyimpan metadata file ke SQLite melalui `upsertFile` (folder, nama file, path, ukuran, `content_type`, waktu upload).
6. Mengembalikan response JSON berisi array `files` seperti di atas.

---

## Endpoint Folder & File (CRUD Ringan)

Bagian ini mendeskripsikan endpoint yang dipakai oleh frontend untuk operasi dasar di "file manager" B2:

- Membuat folder virtual baru.
- Rename file/folder yang sudah ada.
- Menghapus file atau folder (rekursif pada level prefix).

Semua operasi **wajib konsisten dengan katalog lokal (SQLite)** yang menyimpan metadata file.

### 1. Membuat Folder

- **Method**: `POST`
- **Path**: `/b2/folder`
- **Content-Type**: `application/json`

#### Request Body

```json
{
  "name": "Anime Baru",
  "parentPrefix": "Kira/Anime"
}
```

- `name` (wajib, string)
  - Nama folder baru (satu segmen, tanpa `/`).
- `parentPrefix` (opsional, string)
  - Prefix parent tempat folder dibuat.
  - Jika kosong → folder dibuat di root bucket.

Backend menyusun `folderPath`:

```text
<parentPrefix>/<name>
```

Tanpa benar-benar membuat "folder" di B2 (karena B2 berbasis prefix). Disarankan:

- Menyimpan satu row di tabel folder/file lokal (`files` atau tabel khusus folder) dengan:
  - `file_path = folderPath + '/'` (konvensi),
  - `content_type = 'application/vnd.google-apps.folder'`.

#### Response (200)

```json
{
  "folder": {
    "id": "Kira/Anime/Anime Baru",
    "name": "Anime Baru",
    "mimeType": "application/vnd.google-apps.folder"
  }
}
```

#### Catatan Backend

1. Validasi bahwa `name` tidak kosong dan tidak mengandung `/` berlebih.
2. Normalisasi `parentPrefix` (hilangkan `/` di awal/akhir).
3. Pastikan tidak ada folder dengan path yang sama di katalog lokal.
4. Insert row baru ke SQLite.

### 2. Rename File / Folder

Frontend memanggil endpoint ini lewat `onRename` di `App.jsx`.

- **Method**: `POST`
- **Path**: `/b2/rename`
- **Content-Type**: `application/json`

#### Request Body

```json
{
  "id": "Kira/Anime/Lama/Eps1.mp4",
  "name": "Eps01.mp4"
}
```

- `id` (wajib, string)
  - Path penuh lama di B2 / katalog lokal (misal `file_path`).
- `name` (wajib, string)
  - Nama baru (segmen terakhir).

Backend perlu membedakan dua kasus:

- **Rename file** (`mimeType` bukan folder):
  1. Hitung `newId` dengan mengganti segmen terakhir dari `id` dengan `name`.
  2. Opsional: rename object di B2 (`copy` ke `newId` lalu hapus `id` lama).
  3. Update row di SQLite: `file_path = newId`, `name = name`.

- **Rename folder** (`mimeType = 'application/vnd.google-apps.folder'`):
  1. Semua file yang `file_path`-nya diawali `id + '/'` harus di-update prefix-nya ke `newId + '/'`.
  2. Jika menyimpan entitas folder tersendiri, update row tersebut.
  3. Di B2 biasanya tidak perlu operasi khusus (kecuali ingin benar-benar memindahkan object di bucket).

#### Response (200)

```json
{
  "id": "Kira/Anime/Lama/Eps01.mp4",
  "name": "Eps01.mp4"
}
```

#### Response Error (contoh)

```json
{
  "error": "Item not found"
}
```

atau

```json
{
  "error": "Rename failed",
  "details": "<alasan teknis>"
}
```

### 3. Delete File / Folder

Frontend memanggil endpoint ini untuk tombol delete tunggal dan delete massal.

- **Method**: `DELETE`
- **Path**: `/b2/file`

#### Query String

```bash
DELETE /b2/file?id=<encodedId>
```

- `id` (wajib) = path penuh file/folder di B2 / katalog lokal.

#### Perilaku Backend

1. Cari metadata item di SQLite berdasarkan `id`.
2. Jika item adalah **file**:
   - Hapus object di B2 (`fileName = id`).
   - Hapus row terkait di SQLite.
3. Jika item adalah **folder**:
   - Ambil semua row yang `file_path` diawali `id + '/'`.
   - Hapus seluruh object tersebut di B2.
   - Hapus seluruh row di SQLite.

Return JSON singkat:

```json
{
  "ok": true
}
```

Atau jika sebagian gagal (misal saat bulk delete):

```json
{
  "ok": false,
  "error": "Failed to delete some files"
}
```

---

## Contoh Penggunaan di Frontend

### Upload Video dengan `fetch` (JavaScript)

```js
async function uploadVideo({ file, prefix }) {
  const formData = new FormData();
  formData.append('file', file); // file: objek File dari input[type=file]

  if (prefix) {
    formData.append('prefix', prefix); // contoh: 'courses/kelas-a'
  }

  const res = await fetch('/b2/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }

  const data = await res.json();
  return data.files[0]; // { id, name, mimeType, size, modifiedTime }
}
```

### Menggunakan ID untuk Streaming Video

ID yang dikembalikan oleh `/b2/upload` bisa dipakai untuk streaming lewat endpoint `/b2/stream/:id`.

```jsx
// Misal "file" adalah hasil dari uploadVideo()
<video
  src={`/b2/stream/${encodeURIComponent(file.id)}`}
  controls
/>
```

---

## Integrasi dengan Endpoint Lain

Untuk menampilkan daftar video atau file di B2:

- **List semua file/folder**:
  - `GET /b2/list?prefix=...&type=all|file&page=...`
- **List khusus video**:
  - `GET /b2/videos?prefix=...&pageToken=...`

Untuk streaming / download file (termasuk video yang baru diupload):

- **Stream / redirect ke signed URL**:
  - `GET /b2/stream/:id`
  - `id` = nilai `id` dari response `/b2/upload` atau `/b2/list` / `/b2/videos`.
