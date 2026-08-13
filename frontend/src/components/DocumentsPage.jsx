import { useState, useEffect, useRef } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || 'https://researchforge-ai-production.up.railway.app'

export default function DocumentsPage() {
  const [papers,    setPapers]    = useState([])
  const [chunks,    setChunks]    = useState(0)
  const [uploading, setUploading] = useState(false)
  const [ingesting, setIngesting] = useState(false)
  const [dragging,  setDragging]  = useState(false)
  const [log,       setLog]       = useState([])
  const fileRef = useRef()

  function addLog(msg, type = 'info') {
    setLog(prev => [...prev, { msg, type, ts: Date.now() }])
  }

  async function fetchPapers() {
    try {
      const r = await fetch(`${API_BASE}/health`)
      const d = await r.json()
      setPapers(d.papers ?? [])
      setChunks(d.chunks_in_db ?? 0)
    } catch { addLog('ERROR :: Cannot reach FastAPI backend', 'error') }
  }

  useEffect(() => { fetchPapers() }, [])

  async function uploadFile(file) {
    if (!file || !file.name.endsWith('.pdf')) {
      addLog('ERROR :: Only PDF files allowed', 'error'); return
    }
    setUploading(true)
    addLog(`UPLOADING :: ${file.name}`)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch(`${API_BASE}/ingest/upload`, { method: 'POST', body: fd })
      const d = await r.json()
      if (r.ok) {
        addLog(`SUCCESS :: ${d.message}`, 'success')
        fetchPapers()
      } else {
        addLog(`ERROR :: ${d.detail}`, 'error')
      }
    } catch (e) { addLog(`ERROR :: ${e.message}`, 'error') }
    setUploading(false)
  }

  async function ingestAll() {
    setIngesting(true)
    addLog('INGESTING :: Scanning data/papers/ folder...')
    try {
      const r = await fetch(`${API_BASE}/ingest`, { method: 'POST' })
      const d = await r.json()
      if (r.ok) {
        addLog(`SUCCESS :: ${d.message}`, 'success')
        fetchPapers()
      } else {
        addLog(`ERROR :: ${d.detail}`, 'error')
      }
    } catch (e) { addLog(`ERROR :: ${e.message}`, 'error') }
    setIngesting(false)
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={S.title}>DOCUMENT_MANAGER</div>
          <div style={S.sub}>Manage your knowledge base // {chunks.toLocaleString()} CHUNKS_INDEXED</div>
        </div>
        <button onClick={ingestAll} disabled={ingesting} style={S.btnPrimary}>
          {ingesting ? '⟳  INGESTING...' : '⚡  INGEST_ALL'}
        </button>
        <div style={S.headerGlow} />
      </div>

      <div style={S.body}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <div
            style={{ ...S.dropZone, ...(dragging ? S.dropZoneActive : {}) }}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current.click()}
          >
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              onChange={e => uploadFile(e.target.files[0])} />
            <div style={{ fontSize: 36, color: dragging ? 'var(--accent)' : 'var(--muted)' }}>◫</div>
            <div style={{ fontFamily: 'var(--font-hud)', fontSize: 13, color: dragging ? 'var(--accent)' : 'var(--muted)', letterSpacing: 2 }}>
              {uploading ? 'UPLOADING...' : 'DROP_PDF_HERE'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
              Click to browse or drag & drop
            </div>
          </div>

          <div style={S.statsRow}>
            <StatCard label="PAPERS" value={papers.length} color="var(--accent)" />
            <StatCard label="CHUNKS" value={chunks.toLocaleString()} color="var(--success)" />
            <StatCard label="STATUS" value={chunks > 0 ? 'READY' : 'EMPTY'} color={chunks > 0 ? 'var(--success)' : 'var(--warning)'} />
          </div>

          <div style={S.papersBox}>
            <div style={S.papersTitle}>/// INDEXED_DOCUMENTS</div>
            {papers.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>
                NO_DOCUMENTS_INDEXED<br/>
                <span style={{ fontSize: 10, opacity: 0.6 }}>Upload a PDF or click INGEST_ALL</span>
              </div>
            ) : papers.map((p, i) => (
              <div key={i} style={S.paperRow}>
                <div style={S.paperIcon}>◫</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{p}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>INDEXED // READY</div>
                </div>
                <div style={{ width: 8, height: 8, borderRadius: 1, background: 'var(--success)', boxShadow: '0 0 6px var(--success)' }} />
              </div>
            ))}
          </div>
        </div>

        <div style={S.logBox}>
          <div style={S.papersTitle}>/// ACTIVITY_LOG</div>
          {log.length === 0 && (
            <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10, padding: '12px 0' }}>
              AWAITING_OPERATIONS...
            </div>
          )}
          {log.map((l, i) => (
            <div key={i} style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, padding: '6px 0',
              borderBottom: '1px solid rgba(0,240,255,0.05)',
              color: l.type === 'success' ? 'var(--success)' : l.type === 'error' ? 'var(--danger)' : 'var(--muted)',
            }}>
              <span style={{ opacity: 0.4, marginRight: 8, fontSize: 9 }}>{'>'}</span>
              {l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }) {
  return (
    <div style={{
      flex: 1, background: 'rgba(0,240,255,0.02)', border: '1px solid var(--glass-border)',
      borderRadius: 3, padding: '14px 16px', textAlign: 'center',
    }}>
      <div style={{ fontFamily: 'var(--font-hud)', fontSize: 22, fontWeight: 700, color, textShadow: `0 0 10px ${color}` }}>
        {value}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: 2, marginTop: 4 }}>
        {label}
      </div>
    </div>
  )
}

const S = {
  page: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'transparent' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(5,5,8,0.85)', position: 'relative', flexShrink: 0 },
  title: { fontSize: 16, fontFamily: 'var(--font-hud)', fontWeight: 700, color: 'var(--accent)', textShadow: '0 0 10px var(--accent-glow)' },
  sub: { fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 2 },
  headerGlow: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, var(--accent), transparent)', boxShadow: '0 0 8px var(--accent-glow)' },
  btnPrimary: { marginLeft: 'auto', padding: '8px 18px', borderRadius: 2, background: 'rgba(0,240,255,0.08)', border: '1px solid var(--accent)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-hud)', letterSpacing: 1, boxShadow: '0 0 12px rgba(0,240,255,0.12)', transition: 'all 0.2s' },
  body: { flex: 1, display: 'flex', gap: 16, padding: 22, overflow: 'hidden', minHeight: 0 },
  dropZone: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '30px 20px', border: '2px dashed rgba(0,240,255,0.15)', borderRadius: 4, cursor: 'pointer', transition: 'all 0.3s', background: 'rgba(0,240,255,0.01)' },
  dropZoneActive: { border: '2px dashed var(--accent)', background: 'rgba(0,240,255,0.06)', boxShadow: '0 0 20px rgba(0,240,255,0.1), inset 0 0 20px rgba(0,240,255,0.03)' },
  statsRow: { display: 'flex', gap: 12 },
  papersBox: { flex: 1, background: 'rgba(0,240,255,0.015)', border: '1px solid var(--glass-border)', borderRadius: 3, padding: '14px', overflowY: 'auto' },
  papersTitle: { fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-hud)', letterSpacing: 2, marginBottom: 12 },
  paperRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 10px', borderBottom: '1px solid rgba(0,240,255,0.05)', transition: 'background 0.2s' },
  paperIcon: { width: 32, height: 32, borderRadius: 2, flexShrink: 0, border: '1px solid var(--glass-border)', display: 'grid', placeItems: 'center', color: 'var(--accent)', fontSize: 14 },
  logBox: { width: 280, flexShrink: 0, background: 'rgba(0,240,255,0.015)', border: '1px solid var(--glass-border)', borderRadius: 3, padding: '14px', overflowY: 'auto' },
}
