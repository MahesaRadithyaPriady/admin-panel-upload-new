import { useState, useEffect, useCallback } from 'react';
import { Cpu, Play, Square, RotateCw, Trash2, AlertCircle, CheckCircle, XCircle, Clock } from 'lucide-react';

const STATUS_COLOR = {
  queued: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  preparing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  downloading: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  downloaded: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  encoding: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  uploading: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  done: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

function StatusBadge({ status }) {
  const color = STATUS_COLOR[status] || STATUS_COLOR.queued;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {status === 'done' && <CheckCircle className="h-3 w-3" />}
      {status === 'error' && <XCircle className="h-3 w-3" />}
      {status === 'cancelled' && <AlertCircle className="h-3 w-3" />}
      {status === 'encoding' && <Clock className="h-3 w-3" />}
      {status?.toUpperCase()}
    </span>
  );
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

export default function ConvertJobPage() {
  const encodeBase = (import.meta.env.VITE_BACKEND_API_BASE || 'http://localhost:4000').replace(/\/$/, '');
  const token = (() => { try { return window.localStorage.getItem('admin_token') || ''; } catch { return ''; } })();

  const [popularStatus, setPopularStatus] = useState(null);
  const [popularLoading, setPopularLoading] = useState(false);
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('popular');

  const fetchPopularStatus = useCallback(async () => {
    try {
      const res = await fetch(`${encodeBase}/encode/anime/popular/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setPopularStatus(data.status);
    } catch (e) { console.error('[ConvertJob] fetchPopularStatus error:', e); }
  }, [encodeBase, token]);

  const fetchRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await fetch(`${encodeBase}/encode/anime/records?page=1&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRecords(data.rows || data.data?.items || data.records || []);
    } catch (e) { console.error('[ConvertJob] fetchRecords error:', e); }
    finally { setRecordsLoading(false); }
  }, [encodeBase, token]);

  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const res = await fetch(`${encodeBase}/encode/jobs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setJobs(data.jobs || data.data || []);
    } catch (e) { console.error('[ConvertJob] fetchJobs error:', e); }
    finally { setJobsLoading(false); }
  }, [encodeBase, token]);

  useEffect(() => {
    fetchPopularStatus();
    const interval = setInterval(fetchPopularStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchPopularStatus]);

  useEffect(() => {
    if (activeTab === 'records') fetchRecords();
    if (activeTab === 'jobs') fetchJobs();
  }, [activeTab, fetchRecords, fetchJobs]);

  async function handleStartPopular() {
    setPopularLoading(true); setError('');
    try {
      const res = await fetch(`${encodeBase}/encode/anime/popular/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Error ${res.status}`);
      setPopularStatus(data.status);
    } catch (e) { setError(e.message); }
    finally { setPopularLoading(false); }
  }

  async function handleStopPopular() {
    setPopularLoading(true); setError('');
    try {
      const res = await fetch(`${encodeBase}/encode/anime/popular/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || `Error ${res.status}`);
      setPopularStatus(data.status);
    } catch (e) { setError(e.message); }
    finally { setPopularLoading(false); }
  }

  async function handleCancelJob(jobId) {
    if (!window.confirm(`Cancel job ${jobId}?`)) return;
    try {
      const res = await fetch(`${encodeBase}/encode/anime/job/${jobId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) fetchJobs();
    } catch (e) { console.error('[ConvertJob] cancel job error:', e); }
  }

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Convert Job
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Manage encode jobs, auto-encode, and monitor progress.</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 border-b">
        {[
          { id: 'popular', label: 'Auto Encode' },
          { id: 'jobs', label: 'Active Jobs' },
          { id: 'records', label: 'Records' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              activeTab === tab.id
                ? 'border-black text-black dark:border-white dark:text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'popular' && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-4 grid gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-medium">Popular Anime Auto-Encode</h2>
              <p className="text-xs text-zinc-500">Background job yang otomatis encode anime populer setiap 5 menit.</p>
            </div>
            <div className="flex items-center gap-2">
              {popularStatus?.running ? (
                <button
                  onClick={handleStopPopular}
                  disabled={popularLoading}
                  className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                  <Square className="h-4 w-4" />
                  {popularLoading ? 'Stopping…' : 'Stop Job'}
                </button>
              ) : (
                <button
                  onClick={handleStartPopular}
                  disabled={popularLoading}
                  className="flex items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {popularLoading ? 'Starting…' : 'Start Job'}
                </button>
              )}
              <button
                onClick={fetchPopularStatus}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <RotateCw className="h-4 w-4" />
              </button>
            </div>
          </div>

          {popularStatus && (
            <div className="grid gap-3 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-md bg-zinc-50 dark:bg-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">Status</div>
                  <div className={`font-medium ${popularStatus.running ? 'text-green-600' : 'text-zinc-600'}`}>
                    {popularStatus.running ? 'RUNNING' : 'STOPPED'}
                  </div>
                </div>
                <div className="rounded-md bg-zinc-50 dark:bg-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">Enabled</div>
                  <div className="font-medium">{popularStatus.enabled ? 'Yes' : 'No'}</div>
                </div>
                <div className="rounded-md bg-zinc-50 dark:bg-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">Interval</div>
                  <div className="font-medium">{Math.round((popularStatus.intervalMs || 300000) / 60000)} min</div>
                </div>
                <div className="rounded-md bg-zinc-50 dark:bg-zinc-800 p-3">
                  <div className="text-xs text-zinc-500">Daily Limit</div>
                  <div className="font-medium">{popularStatus.dailyLimit || 20}</div>
                </div>
              </div>

              {popularStatus.dailyProgress && (
                <div className="rounded-md bg-zinc-50 dark:bg-zinc-800 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-zinc-500">Daily Progress</span>
                    <span className="text-xs font-medium">
                      {popularStatus.dailyProgress.encodedToday || 0} / {popularStatus.dailyLimit || 20}
                    </span>
                  </div>
                  <div className="bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, ((popularStatus.dailyProgress.encodedToday || 0) / (popularStatus.dailyLimit || 20)) * 100)}%`,
                      }}
                    />
                  </div>
                  {popularStatus.dailyProgress.completed && (
                    <div className="mt-1 text-xs text-green-600">Daily limit reached</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'jobs' && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Active Encode Jobs</h2>
            <button onClick={fetchJobs} className="rounded-md border px-3 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <RotateCw className="h-4 w-4" />
            </button>
          </div>
          {jobsLoading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : jobs.length === 0 ? (
            <div className="text-sm text-zinc-400">No active jobs.</div>
          ) : (
            <div className="grid gap-2">
              {jobs.map(job => (
                <div key={job.id || job.jobId} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusBadge status={job.status} />
                    <span className="font-mono text-xs text-zinc-500 truncate">{job.id || job.jobId}</span>
                    <span className="text-zinc-600 dark:text-zinc-300 truncate">{job.current || job.episodeId}</span>
                    {job.percent != null && (
                      <span className="text-xs text-zinc-400">{job.percent}%</span>
                    )}
                  </div>
                  {['queued', 'preparing', 'downloading', 'encoding', 'uploading'].includes(job.status) && (
                    <button
                      onClick={() => handleCancelJob(job.id || job.jobId)}
                      className="flex items-center gap-1 rounded border border-red-300 px-2 py-0.5 text-xs text-red-500 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
                    >
                      <Trash2 className="h-3 w-3" />
                      Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'records' && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium">Encode Records</h2>
            <button onClick={fetchRecords} className="rounded-md border px-3 py-1 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800">
              <RotateCw className="h-4 w-4" />
            </button>
          </div>
          {recordsLoading ? (
            <div className="text-sm text-zinc-500">Loading…</div>
          ) : records.length === 0 ? (
            <div className="text-sm text-zinc-400">No records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-zinc-500">
                    <th className="py-2 pr-4">Episode</th>
                    <th className="py-2 pr-4">Quality</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Size</th>
                    <th className="py-2 pr-4">Resolution</th>
                    <th className="py-2 pr-4">Bitrate</th>
                    <th className="py-2">Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{rec.episodeId}</td>
                      <td className="py-2 pr-4 font-medium">{rec.namaQuality}</td>
                      <td className="py-2 pr-4"><StatusBadge status={rec.status} /></td>
                      <td className="py-2 pr-4 text-zinc-500">{rec.masterSizeFormatted || formatBytes(rec.masterSize)}</td>
                      <td className="py-2 pr-4 text-zinc-500">{rec.resolution || '-'}</td>
                      <td className="py-2 pr-4 text-zinc-500">{rec.bitrate || '-'}</td>
                      <td className="py-2 text-zinc-500 text-xs">
                        {rec.syncedAt ? new Date(rec.syncedAt).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
