"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useParams, useNavigate, useLocation } from "react-router-dom";

export default function WatchPage() {
  const [searchParams] = useSearchParams();
  const { id: encodedRouteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const backendBase = (import.meta.env.VITE_BACKEND_API_BASE || 'http://localhost:4000').replace(/\/$/, '');
  const decodedRouteId = encodedRouteId ? decodeURIComponent(encodedRouteId) : '';
  const initialId = decodedRouteId || searchParams.get('id') || '';
  const [id, setId] = useState(initialId);
  const nameParam = searchParams.get('name');
  const fromPathParam = searchParams.get('fromPath') || '';
  const resourceKey = searchParams.get('resourceKey') || searchParams.get('resourcekey') || '';
  const title = nameParam ? nameParam : (id ? `Video ${id}` : 'Missing file id');
  const src = id ? `${backendBase}/b2/stream/${encodeURIComponent(id)}${resourceKey ? `?resourceKey=${encodeURIComponent(resourceKey)}` : ''}` : '';
  const [meta, setMeta] = useState(null);
  const metaUrl = id ? `${backendBase}/drive/meta/${encodeURIComponent(id)}${resourceKey ? `?resourceKey=${encodeURIComponent(resourceKey)}` : ''}` : '';

  useEffect(() => {
    try {
      console.log('[WatchPage] debug stream', { id, src, backendBase });
    } catch (_) {
      // ignore logging errors
    }
  }, [id, src, backendBase]);

  useEffect(() => {
    if (!id) {
      const fromRoute = encodedRouteId ? decodeURIComponent(encodedRouteId) : '';
      const fromSearch = searchParams.get('id') || '';
      const resolved = fromRoute || fromSearch || '';
      if (resolved) setId(resolved);
    }
    // react hooks deps: update if route or search params change
  }, [id, encodedRouteId, searchParams]);

  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        if (!metaUrl) return;
        const res = await fetch(metaUrl, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to fetch metadata');
        if (!abort) setMeta(data.file);
      } catch (e) {
        if (!abort) setMeta({ error: e.message });
      }
    })();
    return () => { abort = true; };
  }, [metaUrl]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-black text-black dark:text-zinc-50">
      <main className="mx-auto max-w-4xl p-6">
        <button
          type="button"
          className="text-sm underline"
          onClick={() => {
            // Jika ada fromPathParam, bangun kembali URL /?path=... persis seperti di App.jsx
            if (fromPathParam) {
              const encodedPath = encodeURIComponent(fromPathParam).replace(/%2F/g, '/');
              navigate(`/?path=${encodedPath}`);
              return;
            }
            if (typeof window !== 'undefined' && window.history.length > 1) {
              navigate(-1);
              return;
            }
            navigate('/');
          }}
        >
          ← Back
        </button>
        <h1 className="mt-2 text-xl font-semibold">{title}</h1>
        {id ? (
          <div className="mt-4">
            <div className="mb-4 rounded-md border p-3 text-sm">
              <div className="font-medium">Direct proxy URL</div>
              <div className="mt-1 break-all text-blue-600 underline">{src}</div>
              {meta ? (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div><span className="opacity-70">Name:</span> {meta.name || '-'}</div>
                  <div><span className="opacity-70">Mime:</span> {meta.mimeType || '-'}</div>
                  <div><span className="opacity-70">Size:</span> {meta.size || '-'}</div>
                  <div><span className="opacity-70">Modified:</span> {meta.modifiedTime ? new Date(meta.modifiedTime).toLocaleString() : '-'}</div>
                </div>
              ) : (
                <div className="mt-2 opacity-70">Loading metadata…</div>
              )}
            </div>
            <video
              key={id}
              controls
              className="w-full max-h-[70vh] bg-black"
            >
              <source src={src} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>
        ) : (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            Missing file id. Open via /watch/[id] or add ?id=FILE_ID to the URL.
          </div>
        )}
      </main>
    </div>
  );
}
