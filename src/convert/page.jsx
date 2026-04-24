import { useState, useCallback, useRef, useEffect } from 'react';

const STATUS_COLOR = {
  PENDING:    'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  PROCESSING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  DONE:       'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  FAILED:     'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  SKIPPED:    'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400',
};

const JOB_COLOR = {
  queued:             'text-zinc-400',
  preparing:          'text-zinc-400',
  downloading:        'text-blue-500',
  encoding:           'text-yellow-500',
  uploading:          'text-purple-500',
  done_encode_only:   'text-green-500',
  partial_encode_only:'text-orange-400',
  done:               'text-green-600',
  partial:            'text-orange-500',
  error:              'text-red-500',
  cancelled:          'text-zinc-400',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status] || STATUS_COLOR.PENDING}`}>
      {status || 'PENDING'}
    </span>
  );
}

function EncodeJobPanel({ jobId, encodeBase, onUploadDone }) {
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const esRef = useRef(null);
  const logsContainerRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    const es = new EventSource(`${encodeBase}/encode/job-sse/${jobId}`);
    esRef.current = es;

    function addLog(text) {
      setLogs(prev => [...prev.slice(-199), text]);
    }

    es.addEventListener('hello', (e) => {
      try { addLog(`[hello] ${JSON.stringify(JSON.parse(e.data))}`); } catch { addLog(`[hello] ${e.data}`); }
    });

    es.addEventListener('update', (e) => {
      try {
        const d = JSON.parse(e.data);
        setJob(d);
        addLog(`[update] ${d.status}${d.current ? ` — ${d.current}` : ''} ${d.percent != null ? `(${d.percent}%)` : ''}`);
      } catch { addLog(`[update] ${e.data}`); }
    });

    es.addEventListener('end', (e) => {
      try {
        const d = JSON.parse(e.data);
        setJob(d);
        addLog(`[end] status=${d.status} upload_b2=${d.upload_b2}`);
        console.log('[Encode] SSE end event:', d);
        if (d.upload_b2 === true) {
          addLog('[end] upload_b2=true → siap callback ke API utama');
          onUploadDone && onUploadDone(d);
        } else {
          addLog('[end] upload_b2=false → encode-only, tidak upload ke B2');
        }
      } catch { addLog(`[end] ${e.data}`); }
      es.close();
    });

    es.addEventListener('error', (e) => {
      addLog(`[error] SSE error`);
      console.error('[Encode] SSE error event:', e);
    });

    es.onerror = () => {
      addLog('[sse] connection closed/error');
      es.close();
    };

    return () => { es.close(); };
  }, [jobId, encodeBase]);

  useEffect(() => {
    const el = logsContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (isNearBottom) logsEndRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [logs]);

  if (!jobId) return null;

  const colorClass = JOB_COLOR[job?.status] || 'text-zinc-400';

  return (
    <div className="mt-2 rounded-md border bg-zinc-950 text-xs font-mono p-3 grid gap-2">
      <div className="flex items-center gap-3">
        <span className="text-zinc-500">Job:</span>
        <span className="text-zinc-300">{jobId}</span>
        {job && (
          <>
            <span className={`font-semibold ${colorClass}`}>{job.status}</span>
            {job.percent != null && (
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1 bg-zinc-800 rounded-full h-1.5 max-w-xs">
                  <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${job.percent}%` }} />
                </div>
                <span className="text-zinc-400">{job.percent}%</span>
              </div>
            )}
            {job.current && <span className="text-zinc-400">{job.current}</span>}
          </>
        )}
      </div>
      <div ref={logsContainerRef} className="max-h-40 overflow-y-auto text-zinc-400 leading-5">
        {logs.map((l, i) => (
          <div key={i} className={l.startsWith('[end]') ? 'text-green-400' : l.startsWith('[error]') ? 'text-red-400' : ''}>{l}</div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

function EpisodeEncodeRow({ episode, backendBase, encodeBase, token, onRefreshEpisode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [jobId, setJobId] = useState(null);
  const [doneStatus, setDoneStatus] = useState(null); // null | 'done' | 'partial' | 'error'
  const [deletingQuality, setDeletingQuality] = useState(null); // namaQuality yang sedang dihapus
  const [deleteErr, setDeleteErr] = useState('');

  async function handleDeleteQuality(namaQuality, hlsUrl) {
    if (!window.confirm(`Hapus HLS ${namaQuality} dari B2? Tindakan ini tidak bisa dibatalkan.`)) return;
    setDeletingQuality(namaQuality); setDeleteErr('');
    try {
      const res = await fetch(`${encodeBase}/encode/anime/hls/prefix`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ url: hlsUrl }),
      });
      const data = await res.json().catch(() => ({}));
      console.log('[Delete] response:', data);
      if (!res.ok) throw new Error(data?.message || data?.error || `Error ${res.status}`);
      await onRefreshEpisode();
    } catch (e) {
      console.error('[Delete] error:', e);
      setDeleteErr(e.message);
    } finally { setDeletingQuality(null); }
  }

  async function handleStartEncode() {
    if (!episode) return;
    setBusy(true); setErr(''); setJobId(null); setDoneStatus(null);
    try {
      const body = { episodeId: episode.id, adminToken: token };
      console.log('[Encode] POST /encode/anime body:', body);
      const res = await fetch(`${encodeBase}/encode/anime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      console.log('[Encode] POST /encode/anime response:', data);
      if (!res.ok) throw new Error(data?.message || data?.error || `Error ${res.status}`);
      setJobId(data.jobId);
    } catch (e) {
      console.error('[Encode] Start error:', e);
      setErr(e.message);
    } finally { setBusy(false); }
  }

  async function handleJobEnd(jobData) {
    console.log('[Encode] Job selesai (server sudah callback ke API utama):', jobData);
    setDoneStatus(jobData.status);
    await onRefreshEpisode();
  }

  const qualities = episode.qualities ?? [];
  const summary = episode.hls_summary || {};
  const hasPending = (summary.pending ?? 0) > 0 || (summary.failed ?? 0) > 0;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        {(hasPending || !jobId) && !doneStatus && (
          <button
            onClick={handleStartEncode}
            disabled={busy || !!jobId}
            className="rounded-md bg-green-700 px-3 py-1.5 text-xs text-white hover:bg-green-800 disabled:opacity-50 font-medium"
          >
            {busy ? 'Memulai…' : jobId ? 'Encoding…' : 'Encode & Upload ke B2'}
          </button>
        )}
        {doneStatus === 'done' && (
          <span className="text-xs text-green-500 font-medium">✓ Selesai — server sudah callback ke API utama</span>
        )}
        {doneStatus === 'partial' && (
          <span className="text-xs text-orange-400 font-medium">⚠ Partial — sebagian quality selesai</span>
        )}
        {doneStatus === 'error' && (
          <span className="text-xs text-red-500 font-medium">✕ Encode gagal</span>
        )}
        {err && <span className="text-xs text-red-500">{err}</span>}
      </div>

      {deleteErr && <div className="text-xs text-red-500">{deleteErr}</div>}

      <div className="grid gap-1.5">
        {qualities.map(q => {
          const status = q.hls_status || 'PENDING';
          const isDeleting = deletingQuality === q.nama_quality;
          return (
            <div key={q.id} className="rounded-md border px-3 py-2 text-sm bg-zinc-50 dark:bg-zinc-800/40 grid gap-1">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-14 font-mono font-semibold shrink-0 text-xs">{q.nama_quality}</span>
                  <StatusBadge status={status} />
                  {q.hls_error && (
                    <span className="truncate text-xs text-red-400" title={q.hls_error}>{q.hls_error}</span>
                  )}
                </div>
                {status === 'DONE' && q.hls_url && (
                  <button
                    onClick={() => handleDeleteQuality(q.nama_quality, q.hls_url)}
                    disabled={isDeleting || !!deletingQuality}
                    className="shrink-0 flex items-center gap-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950 disabled:opacity-50"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    {isDeleting ? 'Menghapus…' : 'Hapus'}
                  </button>
                )}
              </div>
              {q.hls_url && (
                <div className="flex items-center gap-2 pl-[4.25rem]">
                  <span className="text-xs text-zinc-400 shrink-0">CDN:</span>
                  <a href={q.hls_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 underline truncate">
                    {q.hls_url}
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {jobId && (
        <EncodeJobPanel
          jobId={jobId}
          encodeBase={encodeBase}
          onUploadDone={handleJobEnd}
        />
      )}
    </div>
  );
}

function EpisodeCard({ episode, backendBase, encodeBase, token }) {
  const [detail, setDetail] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncErr, setSyncErr] = useState('');
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);
  const [deleteAllErr, setDeleteAllErr] = useState('');

  async function handleDeleteAll(e) {
    e.stopPropagation();
    if (!window.confirm(`Hapus SEMUA HLS episode ini dari B2? Tindakan ini tidak bisa dibatalkan.`)) return;
    setDeleteAllBusy(true); setDeleteAllErr('');
    try {
      const res = await fetch(`${encodeBase}/encode/anime/hls/episode/${episode.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      console.log('[DeleteAll] response:', data);
      if (!res.ok) throw new Error(data?.message || data?.error || `Error ${res.status}`);
      setDetail(null);
      await refreshDetail();
    } catch (err) { setDeleteAllErr(err.message); } finally { setDeleteAllBusy(false); }
  }

  async function fetchDetail() {
    setLoadingDetail(true); setDetailErr('');
    try {
      const res = await fetch(`${backendBase}/2.1.0/admin/hls/episodes/${episode.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Error ${res.status}`);
      setDetail(data.data);
    } catch (e) { setDetailErr(e.message); } finally { setLoadingDetail(false); }
  }

  function toggle() {
    if (!expanded && !detail) fetchDetail();
    setExpanded(v => !v);
  }

  async function refreshDetail() {
    setLoadingDetail(true);
    try {
      const res = await fetch(`${backendBase}/2.1.0/admin/hls/episodes/${episode.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Error ${res.status}`);
      setDetail(data.data);
    } catch (e) { setDetailErr(e.message); } finally { setLoadingDetail(false); }
  }

  async function handleSync(e) {
    e.stopPropagation();
    setSyncBusy(true); setSyncErr('');
    try {
      const syncRes = await fetch(`${encodeBase}/encode/anime/sync/${episode.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ adminToken: token }),
      });
      const syncData = await syncRes.json().catch(() => ({}));
      console.log('[Sync] response:', syncData);
      if (!syncRes.ok) throw new Error(syncData?.message || syncData?.error || `Error ${syncRes.status}`);
      const detailRes = await fetch(`${backendBase}/2.1.0/admin/hls/episodes/${episode.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const detailData = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) throw new Error(detailData?.message || `Error ${detailRes.status}`);
      setDetail(detailData.data);
      if (!expanded) setExpanded(true);
    } catch (err) { setSyncErr(err.message); } finally { setSyncBusy(false); }
  }

  const activeSummary = detail?.hls_summary || episode.hls_summary || {};
  const summary = activeSummary;
  const isDone = (summary.total ?? 0) > 0 && (summary.done ?? 0) >= (summary.total ?? 0);
  const hasDoneQuality = (summary.done ?? 0) > 0;
  const episodeWithDetail = detail ? { ...episode, qualities: detail.qualities, hls_summary: detail.hls_summary } : episode;

  return (
    <div className="rounded-lg border bg-white dark:bg-zinc-900 overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 transition"
        onClick={toggle}
      >
        {episode.anime?.thumbnail_anime && (
          <img src={episode.anime.thumbnail_anime} alt="" className="h-10 w-10 rounded object-cover shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate">{episode.anime?.judul_anime || '—'}</div>
          <div className="text-xs text-zinc-500 truncate">
            Ep {episode.nomor_episode}{episode.judul_episode ? ` · ${episode.judul_episode}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 text-xs text-zinc-500">
            <span className="text-green-600 dark:text-green-400">{summary.done ?? 0} Done</span>
            <span>/</span>
            <span>{summary.total ?? 4}</span>
            {summary.processing > 0 && <span className="text-yellow-500 ml-1">{summary.processing} Processing</span>}
            {summary.failed > 0 && <span className="text-red-500 ml-1">{summary.failed} Failed</span>}
          </div>
          {isDone && (
            <button
              onClick={handleSync}
              disabled={syncBusy || deleteAllBusy}
              className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-blue-500 border-blue-300 hover:bg-blue-50 dark:border-blue-700 dark:hover:bg-blue-950 disabled:opacity-50 shrink-0"
            >
              <svg className={`h-3 w-3 ${syncBusy ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              {syncBusy ? 'Sync…' : 'Sinkronisasi'}
            </button>
          )}
          {hasDoneQuality && (
            <button
              onClick={handleDeleteAll}
              disabled={deleteAllBusy || syncBusy}
              className="flex items-center gap-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950 disabled:opacity-50 shrink-0"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              {deleteAllBusy ? 'Menghapus…' : 'Hapus Semua HLS'}
            </button>
          )}
        </div>
        <svg className={`h-4 w-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 grid gap-2">
          {(detailErr || syncErr || deleteAllErr) && <div className="text-xs text-red-500">{detailErr || syncErr || deleteAllErr}</div>}
          {loadingDetail && <div className="text-xs text-zinc-400">Memuat detail…</div>}
          {!loadingDetail && (
            <EpisodeEncodeRow
              episode={episodeWithDetail}
              backendBase={backendBase}
              encodeBase={encodeBase}
              token={token}
              onRefreshEpisode={refreshDetail}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function ConvertPage() {
  const backendBase = (import.meta.env.VITE_BACKEND_API_UTAMA || 'http://localhost:3000').replace(/\/$/, '');
  const encodeBase = (import.meta.env.VITE_BACKEND_API_BASE || 'http://localhost:4000').replace(/\/$/, '');
  const token = (() => { try { return window.localStorage.getItem('admin_token') || ''; } catch { return ''; } })();

  const [q, setQ] = useState('');
  const [animeId, setAnimeId] = useState('');
  const [hlsStatus, setHlsStatus] = useState('');
  const [episodes, setEpisodes] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [searched, setSearched] = useState(false);
  const abortRef = useRef(null);

  const search = useCallback(async (overridePage) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const p = overridePage ?? page;
    const params = new URLSearchParams({ page: p, limit: 10 });
    if (q.trim()) params.set('q', q.trim());
    if (animeId.trim()) params.set('animeId', animeId.trim());
    if (hlsStatus) params.set('hlsStatus', hlsStatus);

    setLoading(true); setErr('');
    try {
      const res = await fetch(`${backendBase}/2.1.0/admin/hls/episodes?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[Convert] Search error:', { status: res.status, data });
        throw new Error(data?.message || `Error ${res.status}`);
      }
      setEpisodes(data.data?.items || []);
      setTotal(data.data?.total || 0);
      setTotalPages(data.data?.totalPages || 0);
      setSearched(true);
    } catch (e) {
      if (e.name === 'AbortError') return;
      setErr(e.message);
    } finally { setLoading(false); }
  }, [backendBase, token, q, animeId, hlsStatus, page]);

  function handleSearch(e) {
    e.preventDefault();
    setPage(1);
    search(1);
  }

  function goPage(np) {
    setPage(np);
    search(np);
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Convert HLS</h1>
        <p className="mt-1 text-sm text-zinc-500">Cari episode, lihat status encode per quality, lalu tandai mulai processing.</p>
      </div>

      <form onSubmit={handleSearch} className="rounded-xl border bg-white dark:bg-zinc-900 p-4 grid gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <label className="text-xs font-medium opacity-70">Cari Keyword</label>
            <input
              type="text"
              placeholder="Nama anime / judul episode…"
              value={q}
              onChange={e => setQ(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm bg-white dark:bg-zinc-800"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium opacity-70">Anime ID</label>
            <input
              type="number"
              placeholder="ID anime (opsional)"
              value={animeId}
              onChange={e => setAnimeId(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm bg-white dark:bg-zinc-800"
            />
          </div>
          <div className="grid gap-1">
            <label className="text-xs font-medium opacity-70">Filter Status HLS</label>
            <select
              value={hlsStatus}
              onChange={e => setHlsStatus(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm bg-white dark:bg-zinc-800"
            >
              <option value="">Semua Status</option>
              {['PENDING', 'PROCESSING', 'DONE', 'FAILED', 'SKIPPED'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black disabled:opacity-50"
          >
            {loading ? 'Mencari…' : 'Cari Episode'}
          </button>
          {searched && !loading && (
            <span className="text-xs text-zinc-500">{total} episode ditemukan</span>
          )}
        </div>
      </form>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {err}
        </div>
      )}

      {searched && !loading && episodes.length === 0 && !err && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-6 text-center text-sm text-zinc-400">
          Tidak ada episode ditemukan.
        </div>
      )}

      {episodes.length > 0 && (
        <div className="grid gap-3">
          {episodes.map(ep => (
            <EpisodeCard
              key={ep.id}
              episode={ep}
              backendBase={backendBase}
              encodeBase={encodeBase}
              token={token}
            />
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <button
                disabled={page <= 1 || loading}
                onClick={() => goPage(page - 1)}
                className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              >
                Prev
              </button>
              <span className="text-sm text-zinc-500">Halaman {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages || loading}
                onClick={() => goPage(page + 1)}
                className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
