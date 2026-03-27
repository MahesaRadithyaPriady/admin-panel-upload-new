import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Clock, PlugZap, RefreshCcw, Trash2 } from "lucide-react";

export default function StatusPage() {
  const backendBase = (import.meta.env.VITE_BACKEND_API_BASE || "http://localhost:4000").replace(/\/$/, "");
  const [jobId, setJobId] = useState("");
  const [jobsById, setJobsById] = useState({});
  const [connStatus, setConnStatus] = useState("idle"); // idle | connecting | connected | ended | error
  const [error, setError] = useState("");
  const [globalStatus, setGlobalStatus] = useState("idle"); // idle | connecting | connected | ended | error
  const esRef = useRef(new Map());
  const globalEsRef = useRef(null);

  async function onDeleteJob(id) {
    const key = String(id || "").trim();
    if (!key) return;
    if (!confirm(`Batalkan/hapus job ini?\n\n${key}`)) return;

    setError("");
    try {
      const res = await fetch(`${backendBase}/b2/upload-job/${encodeURIComponent(key)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Gagal menghapus job");

      disconnect(key);
      setJobsById((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (e) {
      setError(e?.message || "Gagal menghapus job");
    }
  }

  const items = useMemo(() => {
    const list = Object.values(jobsById || {});
    return list.sort((a, b) => Number(b?.updated_at_ms ?? 0) - Number(a?.updated_at_ms ?? 0));
  }, [jobsById]);

  function mergeJob(job) {
    if (!job?.id) return;
    setJobsById((prev) => ({ ...prev, [job.id]: job }));
  }

  function replaceJobs(jobs) {
    const next = {};
    for (const j of jobs || []) {
      if (j?.id) next[j.id] = j;
    }
    setJobsById(next);
  }

  function disconnect(id) {
    const key = String(id || "").trim();
    if (!key) return;
    const prev = esRef.current.get(key);
    if (prev) {
      try {
        prev.close();
      } catch {
        // ignore
      }
      esRef.current.delete(key);
    }
  }

  function connectSse(toJobId) {
    const id = String(toJobId || "").trim();
    if (!id) return;
    if (esRef.current.has(id)) return;

    setError("");
    setConnStatus("connecting");
    const url = `${backendBase}/b2/upload-job-sse/${encodeURIComponent(id)}`;
    const es = new EventSource(url);
    esRef.current.set(id, es);

    es.addEventListener("hello", () => {
      setConnStatus("connected");
    });

    es.addEventListener("update", (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        mergeJob(parsed);
        setConnStatus("connected");
      } catch {
        // ignore
      }
    });

    es.addEventListener("not_found", () => {
      setConnStatus("error");
      disconnect(id);
    });

    es.addEventListener("end", () => {
      setConnStatus("ended");
      disconnect(id);
    });

    es.addEventListener("error", () => {
      setConnStatus("error");
      setError("Koneksi SSE error (akan coba reconnect) ");
    });
  }

  function connectGlobalSse() {
    try {
      globalEsRef.current?.close?.();
    } catch {
      // ignore
    }

    setGlobalStatus("connecting");
    const url = `${backendBase}/b2/upload-jobs-sse?active=1&limit=100`;
    const es = new EventSource(url);
    globalEsRef.current = es;

    es.addEventListener("hello", () => {
      setGlobalStatus("connected");
    });

    es.addEventListener("update", (ev) => {
      try {
        const parsed = JSON.parse(ev.data || "{}");
        const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
        replaceJobs(jobs);
        for (const j of jobs) connectSse(j?.id);
        setGlobalStatus("connected");
      } catch {
        // ignore
      }
    });

    es.addEventListener("end", () => {
      setGlobalStatus("ended");
      try {
        es.close();
      } catch {
        // ignore
      }
    });

    es.addEventListener("error", () => {
      setGlobalStatus("error");
      setError("Koneksi SSE error");
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = window.localStorage.getItem("last_upload_job_id");
        if (v) setJobId(v);
      } catch {
        // ignore
      }

      if (!cancelled) connectGlobalSse();
    })();

    return () => {
      cancelled = true;
      try {
        globalEsRef.current?.close?.();
      } catch {
        // ignore
      }

      try {
        for (const [id, es] of esRef.current.entries()) {
          try {
            es.close();
          } catch {
            // ignore
          }
          esRef.current.delete(id);
        }
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Status</h1>
          <div className="mt-1 text-sm opacity-70">Status encode HLS untuk video yang diunggah.</div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <Clock className="h-4 w-4" />
          <span>
            {globalStatus === "connected" ? "Online" : globalStatus === "connecting" ? "Connecting…" : "Offline"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1">
          <label className="text-xs opacity-70">Job ID</label>
          <input
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder="tempel jobId di sini"
            className="w-full rounded border px-3 py-2 text-sm bg-white dark:bg-zinc-950"
          />
        </div>
        <div className="flex gap-2 items-end">
          <button
            type="button"
            onClick={() => connectSse(jobId)}
            className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black disabled:opacity-50"
            disabled={!jobId}
          >
            <PlugZap className="h-4 w-4" />
            Connect
          </button>
          <button
            type="button"
            onClick={async () => {
              setError("");
              connectGlobalSse();
              connectSse(jobId);
            }}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            disabled={!jobId}
          >
            <RefreshCcw className="h-4 w-4" />
            Reconnect
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>
      ) : null}

      {items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed p-6">
          <div className="flex items-center gap-3">
            <Clapperboard className="h-5 w-5 opacity-70" />
            <div>
              <div className="text-sm font-medium">Belum ada job encode</div>
              <div className="text-xs opacity-70 mt-1">Nanti di sini akan tampil progress encode HLS (queue, processing, done, error).</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-3">
          {items.map((j) => (
            <div key={j.id} className="rounded-lg border p-4 overflow-hidden">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium break-all">{j.current || j.prefix || j.id}</div>
                  <div className="text-xs opacity-70 mt-1 break-all">Status: {j.status || "-"}</div>
                  <div className="text-xs opacity-70 mt-1 break-all">Job: {j.id}</div>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => onDeleteJob(j.id)}
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    title="Cancel / hapus job"
                  >
                    <Trash2 className="h-4 w-4" />
                    Hapus
                  </button>
                  <div className="text-sm font-semibold">{Number(j.percent ?? 0)}%</div>
                </div>
              </div>
              <div className="mt-3 h-2 rounded bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-2 rounded bg-blue-600"
                  style={{ width: `${Math.max(0, Math.min(100, Number(j.percent ?? 0)))}%` }}
                />
              </div>
              <div className="mt-3 grid gap-1 text-xs opacity-80 min-w-0">
                <div className="break-all">Prefix: {j.prefix || "-"}</div>
                <div>Done: {j.done ?? 0} / {j.total ?? 0}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
