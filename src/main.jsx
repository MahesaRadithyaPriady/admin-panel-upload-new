import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import LoginPage from './login/page.jsx'
import WatchPage from './watch/[id]/page.jsx'

if (typeof window !== 'undefined') {
  try {
    const url = new URL(window.location.href)
    const match = url.pathname.match(/^\/api\/drive\/stream\/([^/]+)$/)
    if (match) {
      const id = match[1]
      const base = (import.meta.env.VITE_STREAM_BASE || import.meta.env.VITE_BACKEND_API_BASE || 'http://localhost:4000').replace(/\/$/, '')
      const target = `${base}/drive/stream/${encodeURIComponent(id)}${url.search}`
      window.location.replace(target)
    }
  } catch (e) {
    // ignore redirect errors
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/watch/:id" element={<WatchPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
