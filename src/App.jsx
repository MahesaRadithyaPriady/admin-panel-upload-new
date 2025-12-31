
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

function bytesToSize(bytes) {
  if (!bytes && bytes !== 0) return "-";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function normalizePrefix(prefix) {
  return (prefix || "").replace(/^\/+|\/+$/g, "");
}

function buildFilePath({ prefix, fileName }) {
  const p = normalizePrefix(prefix);
  return p ? `${p}/${fileName}` : fileName;
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [linkJobs, setLinkJobs] = useState([]); // {url, status: 'pending'|'processing'|'done'|'error', error?: string}
  const [linkText, setLinkText] = useState("");
  const [showDestModal, setShowDestModal] = useState(false);
  const [bulkAction, setBulkAction] = useState(null); // 'copy' | 'move'
  const [destStack, setDestStack] = useState([]); // [{id,name}]
  const [destFolders, setDestFolders] = useState([]); // list of folders in current dest
  const [destLoading, setDestLoading] = useState(false);
  const [destPageToken, setDestPageToken] = useState(undefined);
  const [destNextToken, setDestNextToken] = useState(null);
  const [destPrevTokens, setDestPrevTokens] = useState([]);
  const [destQuery, setDestQuery] = useState("");
  const [destNewName, setDestNewName] = useState("");
  const START_FOLDER = "1hm9nX8C-mvS4sKgtuvsg6cmUlZhIcQ9F";
  const [folderStack, setFolderStack] = useState([{ id: START_FOLDER, name: "NanimeID" }]);
  const currentFolderId = folderStack[folderStack.length - 1].id;
  const [uploads, setUploads] = useState([]);
  const [selectedNames, setSelectedNames] = useState([]);
  const [selectedTotal, setSelectedTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState("");
  const [pageToken, setPageToken] = useState(undefined);
  const [nextToken, setNextToken] = useState(null);
  const [prevTokens, setPrevTokens] = useState([]);
  const [order, setOrder] = useState('name_asc'); // name_asc | name_desc
  const [typeFilter, setTypeFilter] = useState('all'); // all | folder | file
  const [encode, setEncode] = useState(true); // whether to encode videos after upload
  const [hasRestored, setHasRestored] = useState(false);
  const [wantRestorePath, setWantRestorePath] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const fileInputRef = useRef(null);
  const uploadsRef = useRef([]);
  const backendBase = (import.meta.env.VITE_BACKEND_API_BASE || 'http://localhost:4000').replace(/\/$/, '');

  // Guard: jika token tidak ada di localStorage, paksa kembali ke halaman login
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const token = window.localStorage.getItem('admin_token');
      if (!token) {
        navigate('/login', { replace: true });
      }
    } catch (_) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  const hasPixeldrain = useMemo(() => {
    return /(?:https?:\/\/)?(?:www\.)?pixeldrain\.com\/u\/[A-Za-z0-9_-]+/i.test(linkText || "");
  }, [linkText]);

  function transformPixeldrainLinks(text) {
    if (!text) return text;
    const re = /https?:\/\/(?:www\.)?pixeldrain\.com\/u\/([A-Za-z0-9_-]+)/gi;
    return text.replace(re, (m, id) => `https://pixeldrain.com/api/file/${id}`);
  }

  // Try to restore folderStack from URL ?path=... on first load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === 'undefined') return;
      try {
        const url = new URL(window.location.href);
        const pathParam = url.searchParams.get('path');
        setWantRestorePath(!!pathParam);
        if (!pathParam) return;
        const decoded = decodeURIComponent(pathParam);
        const segments = decoded.split('/').filter(Boolean);
        if (segments.length === 0) return;
        // Gunakan segmen pertama dari path sebagai nama root agar konsisten dengan URL
        const rootName = segments[0];
        const stack = [{ id: START_FOLDER, name: rootName }];
        // Segmen setelah root dianggap prefix B2
        const startIndex = 1;
        // Bangun virtual folder id berbasis prefix B2, misal:
        // NanimeID/Kira/Anime ->
        //   seg[1] = Kira   -> id: "b2:Kira"
        //   seg[2] = Anime  -> id: "b2:Kira/Anime"
        for (let i = startIndex; i < segments.length; i++) {
          const seg = (segments[i] || '').trim();
          if (!seg) continue;
          const prefixParts = segments.slice(startIndex, i + 1).map(s => (s || '').trim()).filter(Boolean);
          const virtualId = `b2:${prefixParts.join('/')}`;
          stack.push({ id: virtualId, name: seg });
        }
        if (!cancelled && stack.length > 1) {
          setFolderStack(stack);
          setPageToken(undefined);
          setPrevTokens([]);
          setNextToken(null);
        }
      } catch (_) {
        // ignore restore errors
      } finally {
        if (!cancelled) {
          setHasRestored(true);
          setHasInitialized(true);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll backend encoding progress and update UI
  async function pollEncoding(jobId, globalIndex, folderId) {
    let lastPercent = 0;
    while (true) {
      let prog = null;
      try {
        const res = await fetch(`${backendBase}/drive/upload/progress?id=${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
        });
        prog = await res.json();
      } catch (_) {
        // network blip, retry shortly
      }
      if (!prog || prog.status === 'unknown') {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }

      const percent = Math.max(0, Math.min(100, Number(prog.percent || 0)));
      lastPercent = Math.max(lastPercent, percent);
      try { console.log('[ClientUpload] poll', { jobId, status: prog.status, current: prog.current, percent: lastPercent }); } catch {}

      if (prog.status === 'error') {
        setUploads(u => u.map((it, i) => i === globalIndex ? { ...it, status: 'error', error: prog.error || 'Encoding failed' } : it));
        try { console.log('[ClientUpload] error', { jobId, error: prog.error }); } catch {}
        break;
      }

      if (prog.status === 'done') {
        setUploads(u => u.map((it, i) => i === globalIndex ? { ...it, encodeProgress: 100, progress: 100, status: 'done' } : it));
        await loadFiles(folderId);
        try { console.log('[ClientUpload] done', { jobId }); } catch {}
        break;
      }

      if (prog.status === 'encoding') {
        const label = prog.current ? `encoding ${prog.current}` : 'encoding';
        setUploads(u => u.map((it, i) => i === globalIndex ? { ...it, encodeProgress: lastPercent, status: label } : it));
        try { console.log('[ClientUpload] encoding', { jobId, label, percent: lastPercent }); } catch {}
      } else if (prog.status === 'uploading') {
        const label = prog.current ? `uploading ${prog.current}` : 'uploading';
        setUploads(u => u.map((it, i) => i === globalIndex ? { ...it, encodeProgress: lastPercent, status: label } : it));
        try { console.log('[ClientUpload] uploading', { jobId, label, percent: lastPercent }); } catch {}
      } else if (prog.status === 'preparing' || prog.status === 'progress') {
        setUploads(u => u.map((it, i) => i === globalIndex ? { ...it, encodeProgress: lastPercent, status: 'processing' } : it));
        try { console.log('[ClientUpload] processing', { jobId, percent: lastPercent }); } catch {}
      }

      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const handleRestorePath = async () => {
    const url = new URL(window.location.href);
    const pathParam = url.searchParams.get('path');
    if (!pathParam) return;
    const decoded = decodeURIComponent(pathParam);
    const segments = decoded.split('/').filter(Boolean);
    if (segments.length === 0) return;
    // Build initial stack with START_FOLDER root
    const rootName = folderStack[0]?.name || 'NanimeID Pusat Video';
    const stack = [{ id: START_FOLDER, name: rootName }];
    // If first segment equals root name, skip it
    const startIndex = segments[0] === rootName ? 1 : 0;
    let parentId = START_FOLDER;
    for (let i = startIndex; i < segments.length; i++) {
      const seg = segments[i];
      // Paginate through folders under current parent to find exact name match
      let pageToken; let found = null;
      while (!found) {
        const sp = new URLSearchParams();
        sp.set('folderId', parentId);
        sp.set('type', 'folder');
        sp.set('order', 'name_asc');
        if (pageToken) sp.set('pageToken', pageToken);
        const res = await fetch(`${backendBase}/drive/list?${sp.toString()}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to resolve path');
        const segNorm = (seg || '').trim();
        found = (data.files || []).find(f => (f.name || '').trim() === segNorm) || null;
        if (found) break;
        pageToken = data.nextPageToken || null;
        if (!pageToken) break;
      }
  
      if (!found) break; // stop at deepest resolvable segment
      stack.push({ id: found.id, name: found.name });
      parentId = found.id;
    }
    if (stack.length > 1) {
      setFolderStack(stack);
      setPageToken(undefined);
      setPrevTokens([]);
      setNextToken(null);
    }
  };

  async function onRename(f) {
    const current = (f && f.name) || '';
    const name = prompt('Rename to:', current);
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${backendBase}/b2/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: f.id, newName: name.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Rename failed');
      await loadFiles(currentFolderId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openCopyModal() {
    if (selectedIds.length === 0) return;
    setBulkAction('copy');
    startDestBrowser();
  }

  function openMoveModal() {
    if (selectedIds.length === 0) return;
    setBulkAction('move');
    startDestBrowser();
  }

  async function onConfirmBulkDestination() {
    if (!bulkAction || destStack.length === 0) return;
    const destId = destStack[destStack.length - 1].id;
    setLoading(true);
    setError('');
    try {
      const endpoint = bulkAction === 'copy' ? `${backendBase}/drive/copy` : `${backendBase}/drive/move`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, destinationId: destId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Operation failed');
      const failures = (data?.results || []).filter(r => r.error);
      await loadFiles(currentFolderId);
      if (failures.length) {
        setError(`${failures.length} dari ${selectedIds.length} item gagal diproses`);
      } else {
        setNotice(bulkAction === 'copy' ? 'Berhasil menyalin semua item' : 'Berhasil memindahkan semua item');
        setTimeout(() => setNotice(''), 2000);
      }
      setSelectedIds([]);
      setShowDestModal(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function startDestBrowser() {
    const rootName = folderStack[0]?.name || 'NanimeID Pusat Video';
    setDestStack([{ id: START_FOLDER, name: rootName }]);
    setDestPageToken(undefined);
    setDestNextToken(null);
    setDestPrevTokens([]);
    if (destQuery) setDestQuery("");
    setShowDestModal(true);
    // initial load
    loadDestFolders(START_FOLDER, undefined, "");
  }

  async function loadDestFolders(folderId, token, searchOverride) {
    setDestLoading(true);
    try {
      const sp = new URLSearchParams();
      sp.set('folderId', folderId);
      sp.set('type', 'folder');
      sp.set('order', 'name_asc');
      const search = searchOverride !== undefined ? searchOverride : destQuery;
      if (search) sp.set('search', search);
      if (token) sp.set('pageToken', token);
      const res = await fetch(`${backendBase}/drive/list?${sp.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load folders');
      setDestFolders(data.files || []);
      setDestNextToken(data.nextPageToken || null);
    } catch (e) {
      setError(e.message || 'Gagal memuat folder tujuan');
    } finally {
      setDestLoading(false);
    }
  }

  function openDestFolder(f) {
    setDestStack(prev => [...prev, { id: f.id, name: f.name }]);
    setDestPageToken(undefined);
    setDestNextToken(null);
    setDestPrevTokens([]);
    if (destQuery) setDestQuery("");
    loadDestFolders(f.id, undefined, "");
  }

  function destGoBackTo(index) {
    setDestStack(prev => prev.slice(0, index + 1));
    const id = destStack[index].id;
    setDestPageToken(undefined);
    setDestNextToken(null);
    setDestPrevTokens([]);
    if (destQuery) setDestQuery("");
    loadDestFolders(id, undefined, "");
  }

  function destPaginatePrev() {
    if (destPrevTokens.length === 0) return;
    const prev = [...destPrevTokens];
    const token = prev.pop();
    setDestPrevTokens(prev);
    setDestPageToken(token || undefined);
    const id = destStack[destStack.length - 1].id;
    loadDestFolders(id, token || undefined, destQuery);
  }

  function destPaginateNext() {
    if (!destNextToken) return;
    setDestPrevTokens(p => [...p, destPageToken || null]);
    setDestPageToken(destNextToken);
    const id = destStack[destStack.length - 1].id;
    loadDestFolders(id, destNextToken, destQuery);
  }

  function onDestSearchSubmit(e) {
    e.preventDefault();
    const id = destStack[destStack.length - 1].id;
    setDestPageToken(undefined);
    setDestNextToken(null);
    setDestPrevTokens([]);
    loadDestFolders(id, undefined, destQuery);
  }

  async function onDestCreateFolder(e) {
    e.preventDefault();
    const name = (destNewName || '').trim();
    if (!name) return;
    const parentId = destStack[destStack.length - 1].id;
    setDestLoading(true);
    try {
      const res = await fetch(`${backendBase}/drive/create-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Create folder failed');
      setDestNewName('');
      await loadDestFolders(parentId, undefined);
    } catch (e) {
      setError(e.message);
    } finally {
      setDestLoading(false);
    }
  }

  async function onDestDelete(f) {
    if (!f?.id) return;
    const allowed = f.capabilities?.canTrash || f.capabilities?.canDelete;
    if (!allowed) {
      setError('Tidak punya izin untuk menghapus folder ini');
      return;
    }
    if (!confirm('Hapus folder ini?')) return;
    setDestLoading(true);
    try {
      const res = await fetch(`${backendBase}/drive/delete?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Delete failed');
      const id = destStack[destStack.length - 1].id;
      await loadDestFolders(id, undefined, destQuery);
    } catch (e) {
      setError(e.message);
    } finally {
      setDestLoading(false);
    }
  }

  async function loadFiles(folderId, token) {
    setLoading(true);
    setError("");
    try {
      // Bangun prefix dari breadcrumb (lewati root NanimeID)
      const pathSegments = folderStack
        .slice(1)
        .map((f) => (f.name || "").trim())
        .filter(Boolean);
      const prefix = pathSegments.join("/");

      // 1. ROOT: hanya ambil daftar folder level pertama via /b2/folders
      if (!prefix) {
        const sp = new URLSearchParams();
        if (token) sp.set("pageToken", token);
        sp.set("pageSize", "50");

        const res = await fetch(`${backendBase}/b2/folders?${sp.toString()}`);
        const data = await res.json();
        if (res.status === 403) {
          navigate("/login", { replace: true });
          return;
        }
        if (!res.ok) throw new Error(data.error || "Failed to load folders");

        const folders = (data.folders || []).map((f) => ({
          ...f,
          size: f.size ?? 0,
          modifiedTime: f.modifiedTime || new Date().toISOString(),
        }));

        setFiles(folders);
        setNextToken(data.nextPageToken || null);
        return;
      }

      // 2. DI DALAM FOLDER: ambil subfolder via /b2/folders dan file via /b2/list?type=file

      // a) Query untuk folders
      const spFolders = new URLSearchParams();
      spFolders.set("prefix", prefix);
      if (token) spFolders.set("pageToken", token);
      spFolders.set("pageSize", "50");

      // b) Query untuk files (hanya file langsung di prefix ini)
      const spFiles = new URLSearchParams();
      spFiles.set("prefix", prefix);
      spFiles.set("type", "file");
      spFiles.set("pageSize", "1000");

      const [resFolders, resFiles] = await Promise.all([
        fetch(`${backendBase}/b2/folders?${spFolders.toString()}`),
        fetch(`${backendBase}/b2/list?${spFiles.toString()}`),
      ]);

      if (resFolders.status === 403 || resFiles.status === 403) {
        navigate("/login", { replace: true });
        return;
      }

      const dataFolders = await resFolders.json();
      const dataFiles = await resFiles.json();

      if (!resFolders.ok) throw new Error(dataFolders.error || "Failed to load folders");
      if (!resFiles.ok) throw new Error(dataFiles.error || "Failed to load files");

      const folders = (dataFolders.folders || []).map((f) => ({
        ...f,
        size: f.size ?? 0,
        modifiedTime: f.modifiedTime || new Date().toISOString(),
      }));

      const filesOnly = (dataFiles.files || []).map((f) => ({
        ...f,
        modifiedTime: f.modifiedTime || new Date().toISOString(),
      }));

      // Gabungkan: folder dulu, lalu file langsung
      setFiles([...folders, ...filesOnly]);

      // Pagination mengikuti token dari /b2/folders (navigasi struktur)
      setNextToken(dataFolders.nextPageToken || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function onSelectFiles(e) {
    const input = e.currentTarget;
    const selected = Array.from(input.files || []);
    setSelectedTotal(selected.length);
    setSelectedNames(selected.slice(0, 3).map(f => f.name));
  }

  useEffect(() => {
    // Jangan loadFiles sebelum proses restore path awal selesai,
    // supaya tidak ada fetch /b2/list tanpa prefix ketika URL sudah punya ?path=...
    if (!hasInitialized) return;
    if (wantRestorePath && !hasRestored) return; // wait until path restoration completes
    loadFiles(currentFolderId, pageToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId, pageToken, query, order, typeFilter, wantRestorePath, hasRestored, hasInitialized]);

  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  async function getS3PresignedPutUrl({ filePath, contentType, expiresInSeconds = 600 }) {
    const sp = new URLSearchParams();
    sp.set("filePath", filePath);
    sp.set("contentType", contentType || "application/octet-stream");
    sp.set("expiresInSeconds", String(expiresInSeconds));
    const res = await fetch(`${backendBase}/b2/s3-presign?${sp.toString()}`, { method: "GET" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to get presigned URL");
    if (!data?.url) throw new Error("Invalid presigned URL response");
    return data;
  }

  async function commitB2Upload({ filePath, file }) {
    const res = await fetch(`${backendBase}/b2/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filePath,
        size: file.size,
        contentType: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || data?.details || "Commit failed");
    return data;
  }

  function uploadFileViaPresignedPut({ url, contentType, file, onProgress }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");

      xhr.upload.onprogress = (ev) => {
        if (!onProgress) return;
        if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(true);
          return;
        }

        let msg = "Upload failed";
        try {
          const parsed = JSON.parse(xhr.responseText);
          msg = parsed?.message || parsed?.error || msg;
        } catch {}
        reject(new Error(msg));
      };

      xhr.onerror = () => reject(new Error("Network error while uploading"));
      xhr.send(file);
    });
  }

  async function onUpload(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.querySelector('input[name="file"]');
    const selected = Array.from(input.files || []);
    if (selected.length === 0) {
      setError("Pilih minimal 1 file");
      return;
    }
    if (selected.length > 10) {
      setError("Maksimum 10 file per unggahan");
      return;
    }
    setError("");

    // Bangun prefix B2 dari breadcrumb (lewati root NanimeID)
    const pathSegments = folderStack
      .slice(1)
      .map((f) => (f.name || "").trim())
      .filter(Boolean);
    const basePrefix = pathSegments.join("/");

    const initial = selected.map((f) => ({
      name: f.name,
      progress: 0,
      uploadProgress: 0,
      encodeProgress: 0,
      status: "uploading",
      error: "",
    }));
    const baseIndex = uploadsRef.current.length;
    setUploads((prev) => [...prev, ...initial]);

    // Proses upload satu per satu langsung ke B2
    for (let idx = 0; idx < selected.length; idx++) {
      const file = selected[idx];
      const globalIndex = baseIndex + idx;
      const filePath = buildFilePath({ prefix: basePrefix, fileName: file.name });
      // eslint-disable-next-line no-await-in-loop
      await (async () => {
        try {
          const contentType = file.type || "application/octet-stream";
          const presign = await getS3PresignedPutUrl({ filePath, contentType });
          await uploadFileViaPresignedPut({
            url: presign.url,
            contentType,
            file,
            onProgress: (loaded, total) => {
              const pct = total ? Math.round((loaded / total) * 100) : 0;
              setUploads((u) =>
                u.map((it, i) =>
                  i === globalIndex ? { ...it, uploadProgress: pct, status: "uploading" } : it,
                ),
              );
            },
          });
          await commitB2Upload({ filePath, file });
          setUploads((u) =>
            u.map((it, i) =>
              i === globalIndex
                ? { ...it, uploadProgress: 100, encodeProgress: 100, progress: 100, status: "done" }
                : it,
            ),
          );
          await loadFiles(currentFolderId);
        } catch (err) {
          setUploads((u) =>
            u.map((it, i) =>
              i === globalIndex ? { ...it, status: "error", error: err?.message || "Upload failed" } : it,
            ),
          );
        }
      })();
    }

    formEl.reset();
    setSelectedNames([]);
    setSelectedTotal(0);
  }

  async function onUploadFolder(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const input = formEl.querySelector('input[name="folder"]');
    const selected = Array.from(input.files || []);
    if (selected.length === 0) {
      setError("Pilih folder dengan berkas di dalamnya");
      return;
    }
    setError("");

    // Bangun prefix dasar dari breadcrumb saat ini (B2)
    const pathSegments = folderStack
      .slice(1)
      .map((f) => (f.name || "").trim())
      .filter(Boolean);
    const basePrefix = pathSegments.join("/");

    const initial = selected.map((f) => ({
      name: f.webkitRelativePath || f.name,
      progress: 0,
      uploadProgress: 0,
      encodeProgress: 0,
      status: "uploading",
      error: "",
    }));
    const baseIndex = uploadsRef.current.length;
    setUploads((prev) => [...prev, ...initial]);

    // Proses upload folder satu per satu langsung ke B2
    for (let idx = 0; idx < selected.length; idx++) {
      const file = selected[idx];
      const globalIndex = baseIndex + idx;
      // eslint-disable-next-line no-await-in-loop
      await (async () => {
        const rel = file.webkitRelativePath || file.name;
        const parts = (rel || "").split("/");
        const sub = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
        const fullPrefix = [basePrefix, sub].filter(Boolean).join("/");
        const filePath = buildFilePath({ prefix: fullPrefix, fileName: file.name });
        try {
          const contentType = file.type || "application/octet-stream";
          const presign = await getS3PresignedPutUrl({ filePath, contentType });
          await uploadFileViaPresignedPut({
            url: presign.url,
            contentType,
            file,
            onProgress: (loaded, total) => {
              const pct = total ? Math.round((loaded / total) * 100) : 0;
              setUploads((u) =>
                u.map((it, i) =>
                  i === globalIndex ? { ...it, uploadProgress: pct, status: "uploading" } : it,
                ),
              );
            },
          });
          await commitB2Upload({ filePath, file });
          setUploads((u) =>
            u.map((it, i) =>
              i === globalIndex
                ? { ...it, uploadProgress: 100, encodeProgress: 100, progress: 100, status: "done" }
                : it,
            ),
          );
          await loadFiles(currentFolderId);
        } catch (err) {
          setUploads((u) =>
            u.map((it, i) =>
              i === globalIndex ? { ...it, status: "error", error: err?.message || "Upload failed" } : it,
            ),
          );
        }
      })();
    }

    formEl.reset();
  }

  async function onUploadLinks(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const lines = (linkText || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      setError('Masukkan minimal satu URL');
      return;
    }
    setError('');
    setNotice('');
    // Initialize jobs
    const jobs = lines.map(u => ({ url: u, status: 'pending', error: '' }));
    setLinkJobs(jobs);
    setLoading(true);
    try {
      // Process one-by-one to keep UI responsive and simple
      let failCount = 0;
      for (let i = 0; i < jobs.length; i++) {
        setLinkJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: 'processing', error: '' } : j));
        try {
          const res = await fetch(`${backendBase}/drive/upload-from-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: jobs[i].url, folderId: currentFolderId }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || 'Gagal upload via link');
          const hadError = Array.isArray(data?.results) && data.results[0]?.error;
          if (hadError) throw new Error(data.results[0].error);
          setLinkJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: 'done', error: '' } : j));
          await loadFiles(currentFolderId);
        } catch (err) {
          setLinkJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: 'error', error: err?.message || 'Gagal' } : j));
          failCount += 1;
        }
      }
      if (failCount === 0) {
        setNotice('Semua link berhasil diunggah');
        setTimeout(() => setNotice(''), 2000);
        setLinkText('');
      } else {
        setError(`${failCount} dari ${jobs.length} link gagal diunggah`);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id) {
    if (!confirm("Delete this item?")) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${backendBase}/b2/file?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await loadFiles(currentFolderId);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onCreateFolder(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const name = formEl.folderName.value.trim();
    if (!name) return;
    setLoading(true);
    setError("");
    try {
      // Bangun full prefix dari breadcrumb saat ini + nama folder baru
      // Contoh: breadcrumb "Kira/Anime" + name "Season 1" -> prefix "Kira/Anime/Season 1"
      const pathSegments = folderStack
        .slice(1)
        .map((f) => (f.name || "").trim())
        .filter(Boolean);
      const basePrefix = pathSegments.join("/");
      const fullPrefix = [basePrefix, name].filter(Boolean).join("/");

      const res = await fetch(`${backendBase}/b2/folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: fullPrefix }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Create folder failed");
      await loadFiles(currentFolderId);
      formEl.reset();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function openFolder(f) {
    setFolderStack((prev) => [...prev, { id: f.id, name: f.name }]);
    if (query) setQuery("");
    setPageToken(undefined);
    setPrevTokens([]);
    setNextToken(null);
    setSelectedIds([]);
  }

  function openWatch(f) {
    // Ambil hanya nilai query `path` sebagai konteks asal, supaya tidak double-encode
    let fromPath = '';
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        fromPath = url.searchParams.get('path') || '';
      } catch (_) {
        fromPath = '';
      }
    }

    const base = `/watch/${encodeURIComponent(f.id)}`;
    const params = new URLSearchParams();
    if (f.name) params.set('name', f.name);
    if (fromPath) params.set('fromPath', fromPath);
    navigate(`${base}?${params.toString()}`);
  }

  function goBackTo(index) {
    setFolderStack((prev) => prev.slice(0, index + 1));
    setSelectedIds([]);
  }

  const breadcrumb = useMemo(
    () => (
      <div className="text-sm text-zinc-600 dark:text-zinc-300 flex flex-wrap gap-1">
        {folderStack.map((f, idx) => (
          <span key={f.id} className="flex items-center gap-1">
            <button
              className="underline hover:no-underline"
              onClick={() => goBackTo(idx)}
            >
              {f.name}
            </button>
            {idx < folderStack.length - 1 ? <span className="opacity-70">/</span> : null}
          </span>
        ))}
      </div>
    ),
    [folderStack]
  );

  useEffect(() => {
    // Keep selection only for currently visible files
    setSelectedIds((prev) => prev.filter((id) => files.some((f) => f.id === id)));
  }, [files]);

  useEffect(() => {
    // Reflect human-readable path in the URL query without navigation
    if (typeof window === 'undefined') return;
    if (!hasRestored) return; // avoid overwriting incoming path before restoration
    const names = folderStack.map((f) => f.name).join('/');
    const url = new URL(window.location.href);
    const current = url.searchParams.get('path') || '';
    if (current !== names) {
      // Encode path namun biarkan '/' tampil apa adanya di URL (bukan %2F)
      const encoded = encodeURIComponent(names).replace(/%2F/g, '/');
      url.search = `?path=${encoded}`;
      window.history.replaceState(null, '', url.toString());
    }
  }, [folderStack, hasRestored]);

  function toggleSelect(id, checked) {
    setSelectedIds((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  }

  function toggleSelectAll(checked) {
    const selectable = files.map((f) => f.id);
    if (checked) {
      setSelectedIds(selectable);
    } else {
      setSelectedIds([]);
    }
  }

  async function onBulkDelete() {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} items?`)) return;
    setLoading(true);
    setError("");
    try {
      const allowedIds = files
        .filter((f) => selectedIds.includes(f.id))
        .map((f) => f.id);
      const results = await Promise.allSettled(
        selectedIds.map((id) =>
          fetch(`${backendBase}/b2/file?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
        ),
      );
      const failures = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const res = r.value;
          if (!res.ok) {
            try {
              const data = await res.json();
              failures.push(data.error || 'Delete failed');
            } catch {
              failures.push('Delete failed');
            }
          }
        } else {
          failures.push('Delete failed');
        }
      }
      await loadFiles(currentFolderId);
      setSelectedIds([]);
      if (failures.length > 0) {
        setError(`${failures.length} gagal dihapus`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onCopyLink(f) {
    try {
      // Gunakan langsung backend/stream base agar hasil copy sudah berupa URL CDN/backend,
      // bukan origin Next.js panel.
      const base = import.meta.env.VITE_STREAM_BASE || 'http://localhost:4000';
      const normalizedBase = String(base).replace(/\/+$/, '');
      const rawPath = String(f?.id || '').replace(/^\/+/, '');
      const encodedPath = rawPath
        .split('/')
        .filter(Boolean)
        .map((seg) => encodeURIComponent(seg))
        .join('/');
      const url = `${normalizedBase}/${encodedPath}`;
      await navigator.clipboard.writeText(url);
      setNotice('Link copied');
      setTimeout(() => setNotice(''), 1500);
    } catch (e) {
      setError('Gagal menyalin link');
    }
  }

  if (wantRestorePath && !hasRestored) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-black text-black dark:text-zinc-50">
        <main className="mx-auto max-w-4xl p-6 flex items-center justify-center h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-zinc-300 border-t-black dark:border-zinc-700 dark:border-t-white animate-spin" />
            <div className="text-sm opacity-70">Memuat folder…</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-black dark:text-zinc-50">
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">{folderStack[folderStack.length - 1].name}</h1>
        <div className="mt-2">{breadcrumb}</div>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-200">{notice}</div>
        ) : null}

        <section className="mt-4">
          <form
            onSubmit={(e) => { e.preventDefault(); setPageToken(undefined); setPrevTokens([]); setNextToken(null); loadFiles(currentFolderId, undefined); }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPageToken(undefined); setPrevTokens([]); setNextToken(null); }}
              placeholder="Cari nama file..."
              className="w-full rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900"
            />
            <select
              value={order}
              onChange={(e) => { setOrder(e.target.value); setPageToken(undefined); setPrevTokens([]); setNextToken(null); }}
              className="rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900"
            >
              <option value="name_asc">A–Z</option>
              <option value="name_desc">Z–A</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPageToken(undefined); setPrevTokens([]); setNextToken(null); }}
              className="rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900"
            >
              <option value="all">Semua</option>
              <option value="folder">Folder</option>
              <option value="file">File</option>
            </select>
            <button className="rounded-md border px-4 py-2 text-sm">Search</button>
          </form>
        </section>
        {showDestModal ? (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-zinc-900 rounded-lg border p-4 w-[90%] max-w-2xl">
              <h3 className="font-medium mb-2">{bulkAction === 'copy' ? 'Copy' : 'Move'} {selectedIds.length} item ke…</h3>
              <div className="text-xs text-zinc-600 dark:text-zinc-300 mb-2 flex flex-wrap gap-1">
                {destStack.map((f, idx) => (
                  <span key={f.id} className="flex items-center gap-1">
                    <button className="underline" onClick={() => destGoBackTo(idx)}>{f.name}</button>
                    {idx < destStack.length - 1 ? <span className="opacity-70">/</span> : null}
                  </span>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 mb-2">
                <form onSubmit={onDestSearchSubmit} className="flex gap-2">
                  <input
                    value={destQuery}
                    onChange={(e) => setDestQuery(e.target.value)}
                    placeholder="Cari folder..."
                    className="w-full rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900"
                  />
                  <button className="rounded-md border px-3 py-2 text-sm">Search</button>
                </form>
                <form onSubmit={onDestCreateFolder} className="flex gap-2">
                  <input
                    value={destNewName}
                    onChange={(e) => setDestNewName(e.target.value)}
                    placeholder="Nama folder baru"
                    className="w-full rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900"
                  />
                  <button className="rounded-md bg-black px-3 py-2 text-sm text-white dark:bg-white dark:text-black disabled:opacity-50" disabled={destLoading}>Create</button>
                </form>
              </div>
              <div className="rounded border max-h-64 overflow-auto">
                {destLoading ? (
                  <div className="p-3 text-sm">Loading…</div>
                ) : destFolders.length === 0 ? (
                  <div className="p-3 text-sm">No folders</div>
                ) : (
                  <ul className="divide-y">
                    {destFolders.map(df => (
                      <li key={df.id} className="p-2 flex items-center justify-between">
                        <button className="underline" onClick={() => openDestFolder(df)}>{df.name}</button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs opacity-70">Folder</span>
                          <button
                            onClick={() => onDestDelete(df)}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                            disabled={destLoading || !(df.capabilities?.canTrash || df.capabilities?.canDelete)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button
                  className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                  onClick={destPaginatePrev}
                  disabled={destPrevTokens.length === 0 || destLoading}
                >
                  Prev
                </button>
                <button
                  className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                  onClick={destPaginateNext}
                  disabled={!destNextToken || destLoading}
                >
                  Next
                </button>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  className="rounded-md border px-3 py-1 text-sm"
                  onClick={() => setShowDestModal(false)}
                  disabled={loading}
                >
                  Batal
                </button>
                <button
                  className="rounded-md bg-black px-3 py-1 text-sm text-white dark:bg-white dark:text-black disabled:opacity-50"
                  onClick={onConfirmBulkDestination}
                  disabled={loading || destStack.length === 0}
                >
                  Konfirmasi di sini
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <form onSubmit={onUploadFolder} className="rounded-lg border p-4">
            <h2 className="font-medium mb-2">Upload Folder</h2>
            <div className="mt-1 mb-2 text-sm flex items-center gap-2">
              <input id="encodeToggleFolder" type="checkbox" checked={encode} onChange={(e) => setEncode(e.target.checked)} />
              <label htmlFor="encodeToggleFolder">Encode setelah upload</label>
            </div>
            <input name="folder" type="file" className="block w-full text-sm" webkitdirectory="" directory="" />
            <button
              type="submit"
              className="mt-3 rounded-md bg-black px-4 py-2 text-white dark:bg-white dark:text-black disabled:opacity-50"
              disabled={loading}
            >
              Upload Folder
            </button>
          </form>

          <form onSubmit={onUploadLinks} className="rounded-lg border p-4">
            <h2 className="font-medium mb-2">Upload via Link</h2>
            <textarea name="links" value={linkText} onChange={(e) => setLinkText(e.target.value)} className="w-full rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900" rows="5" placeholder="Tempel beberapa URL, satu per baris" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-md bg-black px-4 py-2 text-white dark:bg-white dark:text-black disabled:opacity-50"
                disabled={loading}
              >
                Upload Links
              </button>
              {hasPixeldrain ? (
                <button
                  type="button"
                  onClick={() => setLinkText(transformPixeldrainLinks(linkText))}
                  className="rounded-md border px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  disabled={loading}
                >
                  Sync Pixeldrain
                </button>
              ) : null}
            </div>
            {linkJobs.length > 0 ? (
              <div className="mt-3 space-y-2 text-xs">
                <div className="opacity-70">Progress: {linkJobs.filter(j => j.status === 'done').length}/{linkJobs.length} selesai</div>
                <ul className="space-y-1">
                  {linkJobs.slice(-20).map((j, i) => (
                    <li key={`${j.url}-${i}`} className="truncate">
                      <span className="font-mono">{j.url}</span>
                      <span className="ml-2">
                        {j.status === 'pending' && 'Menunggu…'}
                        {j.status === 'processing' && 'Mengunggah…'}
                        {j.status === 'done' && 'Selesai'}
                        {j.status === 'error' && `Gagal (${j.error})`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </form>
        </section>

        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          <form onSubmit={onUpload} className="rounded-lg border p-4">
            <h2 className="font-medium mb-2">Upload File</h2>
            <div className="mt-1 mb-2 text-sm flex items-center gap-2">
              <input id="encodeToggleFile" type="checkbox" checked={encode} onChange={(e) => setEncode(e.target.checked)} />
              <label htmlFor="encodeToggleFile">Encode setelah upload</label>
            </div>
            <input
              ref={fileInputRef}
              name="file"
              type="file"
              className="sr-only"
              multiple
              accept="video/*"
              onChange={onSelectFiles}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className="rounded-md border px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              Pilih Video
            </button>
            {selectedTotal > 0 ? (
              <div className="mt-2 text-xs">
                <div className="opacity-70">File terpilih (maks 3):</div>
                <ul className="list-disc ml-5 space-y-1">
                  {selectedNames.map((n, i) => (
                    <li key={`${n}-${i}`} className="truncate">{n}</li>
                  ))}
                </ul>
                {selectedTotal > 3 ? (
                  <div className="opacity-70 mt-1">+{selectedTotal - 3} lainnya</div>
                ) : null}
              </div>
            ) : null}
            <button
              type="submit"
              className="mt-3 rounded-md bg-black px-4 py-2 text-white dark:bg-white dark:text-black disabled:opacity-50"
              disabled={loading}
            >
              Upload
            </button>
            {uploads.length > 0 ? (
              <div className="mt-4 space-y-3">
                {uploads.slice(-10).map((u, i) => (
                  <div key={`${u.name}-${i}`} className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="truncate max-w-[70%]">{u.name}</span>
                      <span>{Math.max(u.uploadProgress || 0, u.encodeProgress || 0)}%</span>
                    </div>
                    <div className="text-xs opacity-70">Upload</div>
                    <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded">
                      <div className="h-2 bg-blue-600 rounded" style={{ width: `${u.uploadProgress || 0}%` }} />
                    </div>
                    <div className="text-xs opacity-70 mt-1">Encode</div>
                    <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded">
                      <div className="h-2 bg-purple-600 rounded" style={{ width: `${u.encodeProgress || 0}%` }} />
                    </div>
                    {u.status !== 'error' ? (
                      <div className="mt-1 text-xs opacity-70">
                        {u.status === 'uploading' && 'Mengunggah…'}
                        {u.status && u.status.startsWith('encoding') && `Mengenkode (${u.status.split(' ')[1] || ''})…`}
                        {u.status && u.status.startsWith('uploading') && `Mengunggah (${u.status.split(' ')[1] || ''})…`}
                        {u.status === 'processing' && 'Memproses di server…'}
                        {u.status === 'done' && 'Selesai'}
                      </div>
                    ) : null}
                    {u.status === 'error' ? (
                      <div className="text-red-600 mt-1">{u.error || 'Gagal mengunggah'}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </form>

          <form onSubmit={onCreateFolder} className="rounded-lg border p-4">
            <h2 className="font-medium mb-2">Create Folder</h2>
            <input
              type="text"
              name="folderName"
              placeholder="Folder name"
              className="w-full rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-900"
            />
            <button
              type="submit"
              className="mt-3 rounded-md bg-black px-4 py-2 text-white dark:bg-white dark:text-black disabled:opacity-50"
              disabled={loading}
            >
              Create
            </button>
          </form>
        </section>

        <section className="mt-6">
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={onBulkDelete}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={selectedIds.length === 0 || loading}
            >
              Delete Selected ({selectedIds.length})
            </button>
            <button
              onClick={openCopyModal}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={selectedIds.length === 0 || loading}
            >
              Copy Selected
            </button>
            <button
              onClick={openMoveModal}
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={selectedIds.length === 0 || loading}
            >
              Move Selected
            </button>
          </div>
          <div className="rounded-lg border overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-100 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={files.length > 0 && selectedIds.length === files.length}
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Size</th>
                  <th className="px-3 py-2 text-left">Modified</th>
                  <th className="px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td className="px-3 py-4" colSpan={6}>Loading…</td></tr>
                ) : files.length === 0 ? (
                  <tr><td className="px-3 py-4" colSpan={6}>No items</td></tr>
                ) : (
                  files.map((f) => {
                    const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
                    return (
                      <tr key={f.id} className="border-t">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(f.id)}
                            onChange={(e) => toggleSelect(f.id, e.target.checked)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          {isFolder ? (
                            <button className="underline" onClick={() => openFolder(f)}>
                              {f.name}
                            </button>
                          ) : (f.mimeType === 'video/mp4' || f.mimeType === 'application/octet-stream') ? (
                            <button
                              className="underline"
                              onClick={() => openWatch(f)}
                            >
                              {f.name}
                            </button>
                          ) : (
                            <a className="underline" href={f.webViewLink || '#'} target="_blank" rel="noreferrer">
                              {f.name}
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-2">{isFolder ? 'Folder' : (f.mimeType || 'File')}</td>
                        <td className="px-3 py-2">{isFolder ? '-' : bytesToSize(Number(f.size || 0))}</td>
                        <td className="px-3 py-2">{new Date(f.modifiedTime).toLocaleString()}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-2">
                            {!isFolder && (
                              <>
                                <button
                                  onClick={() => onRename(f)}
                                  className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                  disabled={loading}
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => onCopyLink(f)}
                                  className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                  disabled={loading}
                                >
                                  Copy link
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => onDelete(f.id)}
                              className="rounded-md border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-50"
                              disabled={loading}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={prevTokens.length === 0 || loading}
              onClick={() => {
                const prev = [...prevTokens];
                const token = prev.pop();
                setPrevTokens(prev);
                setPageToken(token);
              }}
            >
              Prev
            </button>
            <button
              className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              disabled={!nextToken || loading}
              onClick={() => {
                if (!nextToken) return;
                setPrevTokens(p => [...p, pageToken || null]);
                setPageToken(nextToken);
              }}
            >
              Next
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
