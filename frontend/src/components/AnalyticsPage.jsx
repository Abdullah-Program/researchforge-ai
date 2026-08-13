const API_BASE = import.meta.env.VITE_API_URL || 'https://researchforge-ai-production.up.railway.app'

import { useEffect, useRef, useState, useCallback } from 'react'

export default function AnalyticsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadAnalytics = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/analytics`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(() => { loadAnalytics() }, [loadAnalytics])

  if (loading) return (
    <div style={{ flex:1, display:'grid', placeItems:'center', color:'var(--accent)', fontFamily:'var(--font-hud)', letterSpacing:3 }}>
      LOADING_ANALYTICS...
    </div>
  )

  if (error) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12 }}>
      <div style={{ color:'var(--danger)', fontFamily:'var(--font-mono)', fontSize:12 }}>
        ANALYTICS_ERROR // {error}
      </div>
      <div style={{ color:'var(--muted)', fontFamily:'var(--font-mono)', fontSize:10, textAlign:'center', maxWidth:360 }}>
        Make sure FastAPI is running on port 8000 and vite proxy includes /analytics
      </div>
      <button type="button" onClick={loadAnalytics} style={S.refreshBtn}>↻ RETRY</button>
    </div>
  )

  const total = data?.total_queries ?? 0
  const daily = data?.daily_queries?.length ? data.daily_queries : buildEmptyDaily()

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.headerLeft}>
          <div style={S.headerTitle}>ANALYTICS_DASHBOARD</div>
          <div style={S.headerSub}>System Performance Metrics // {total} QUERIES LOGGED</div>
        </div>
        <button type="button" onClick={loadAnalytics} style={S.refreshBtn}>↻ REFRESH</button>
        <div style={S.headerGlow} />
      </div>

      <div style={S.body}>
        <div style={S.kpiRow}>
          <KpiCard label="TOTAL QUERIES"    value={total}                         color="var(--accent)" icon="⊡" />
          <KpiCard label="RETRIEVAL RATE"   value={`${data.retrieval_rate ?? 0}%`}        color="var(--success)" icon="◈" />
          <KpiCard label="AVG CONFIDENCE"   value={`${data.avg_confidence ?? 0}%`}        color="var(--warning)" icon="◉" />
          <KpiCard label="HALLUCINATION"    value={`${data.hallucination_rate ?? 0}%`}    color="var(--danger)" icon="⚠" />
          <KpiCard label="AVG DOCS FOUND"   value={data.avg_docs ?? 0}                    color="var(--purple)" icon="◫" />
        </div>

        <div style={S.row}>
          <div style={{ ...S.card, flex:1.5 }} className="panel-3d">
            <div style={S.cardTitle}>⬡ QUERY VOLUME (7 DAYS)</div>
            <BarChart data={daily} />
          </div>

          <div style={{ ...S.card, minWidth:200, flex:0.7 }} className="panel-3d">
            <div style={S.cardTitle}>◉ ROUTING SPLIT</div>
            <DonutChart ragCount={data.rag_count || 0} directCount={data.direct_count || 0} />
          </div>
        </div>

        <div style={S.row}>
          <div style={{ ...S.card, flex:1 }} className="panel-3d">
            <div style={S.cardTitle}>◈ TOP KEYWORDS</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:10 }}>
              {(data.top_keywords || []).map((kw, i) => {
                const max = (data.top_keywords[0]?.count || 1)
                const pct = Math.round((kw.count / max) * 100)
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ width:110, fontSize:10, fontFamily:'var(--font-mono)', color:'var(--accent)', flexShrink:0 }}>
                      {kw.keyword}
                    </span>
                    <div style={{ flex:1, height:6, background:'rgba(255,255,255,0.05)', borderRadius:1 }}>
                      <div style={{ width:`${pct}%`, height:'100%', background:'var(--accent)', borderRadius:1, boxShadow:'0 0 6px var(--accent-glow)', transition:'width 1s ease' }} />
                    </div>
                    <span style={{ width:24, fontSize:9, fontFamily:'var(--font-mono)', color:'var(--muted)', textAlign:'right' }}>
                      {kw.count}
                    </span>
                  </div>
                )
              })}
              {(data.top_keywords || []).length === 0 && (
                <div style={{ color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)' }}>
                  No data yet — ask questions in Chat to populate analytics
                </div>
              )}
            </div>
          </div>

          <div style={{ ...S.card, flex:1.4 }} className="panel-3d">
            <div style={S.cardTitle}>◫ RECENT QUERIES</div>
            <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
              {(data.recent_queries || []).map((q, i) => (
                <div key={i} style={S.recentRow}>
                  <span style={S.recentIdx}>{String(i+1).padStart(2,'0')}</span>
                  <span style={S.recentText}>{q.query?.slice(0,48)}{q.query?.length>48?'...':''}</span>
                  <span style={{
                    ...S.recentBadge,
                    background: q.grade==='relevant' ? 'rgba(0,255,136,0.1)' : 'rgba(255,60,60,0.1)',
                    color:       q.grade==='relevant' ? 'var(--success)' : 'var(--danger)',
                    borderColor: q.grade==='relevant' ? 'rgba(0,255,136,0.25)' : 'rgba(255,60,60,0.25)',
                  }}>
                    {q.grade || 'direct'}
                  </span>
                  {q.confidence_score != null && (
                    <span style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--muted)' }}>
                      {Math.round(q.confidence_score*100)}%
                    </span>
                  )}
                </div>
              ))}
              {(data.recent_queries||[]).length===0 && (
                <div style={{ color:'var(--muted)', fontSize:11, fontFamily:'var(--font-mono)' }}>No queries yet. Ask something!</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function buildEmptyDaily() {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push({ date: d.toISOString().slice(0, 10), count: 0 })
  }
  return days
}

function KpiCard({ label, value, color, icon }) {
  return (
    <div style={{ ...S.kpiCard, borderColor: color+'33' }} className="panel-3d">
      <div style={{ fontSize:18, color }}>{icon}</div>
      <div style={{ fontSize:22, fontFamily:'var(--font-hud)', color, fontWeight:700, textShadow:`0 0 20px ${color}` }}>{value}</div>
      <div style={{ fontSize:8, fontFamily:'var(--font-hud)', color:'var(--muted)', letterSpacing:2 }}>{label}</div>
    </div>
  )
}

function BarChart({ data }) {
  const max = Math.max(...(data || []).map(d => d.count), 1)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:6, height:100, marginTop:16, paddingBottom:4 }}>
      {(data || []).map((d, i) => {
        const h = Math.max(4, Math.round((d.count / max) * 90))
        const label = (d.date || '').slice(5)
        return (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:8, fontFamily:'var(--font-mono)', color:'var(--accent)' }}>
              {d.count > 0 ? d.count : ''}
            </span>
            <div style={{ width:'100%', height:h, background:'linear-gradient(180deg, var(--accent), rgba(0,240,255,0.3))', borderRadius:'2px 2px 0 0', boxShadow:'0 0 8px var(--accent-glow)', transition:'height 0.8s ease' }} />
            <span style={{ fontSize:8, fontFamily:'var(--font-mono)', color:'var(--muted)' }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function DonutChart({ ragCount, directCount }) {
  const canvasRef = useRef(null)
  const total = ragCount + directCount || 1
  const ragPct = Math.round((ragCount/total)*100)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const cx = canvas.width/2, cy = canvas.height/2, r = 55, inner = 35

    ctx.clearRect(0,0,canvas.width,canvas.height)

    const ragEnd = (ragCount/total) * Math.PI * 2 - Math.PI/2
    ctx.beginPath()
    ctx.arc(cx, cy, r, -Math.PI/2, ragEnd)
    ctx.arc(cx, cy, inner, ragEnd, -Math.PI/2, true)
    ctx.closePath()
    ctx.fillStyle = 'rgba(0,240,255,0.7)'
    ctx.shadowColor = '#00f0ff'
    ctx.shadowBlur = 10
    ctx.fill()

    ctx.beginPath()
    ctx.arc(cx, cy, r, ragEnd, 3*Math.PI/2)
    ctx.arc(cx, cy, inner, 3*Math.PI/2, ragEnd, true)
    ctx.closePath()
    ctx.fillStyle = 'rgba(255,0,255,0.4)'
    ctx.shadowColor = '#ff00ff'
    ctx.shadowBlur = 8
    ctx.fill()

    ctx.shadowBlur = 0
    ctx.fillStyle = '#00f0ff'
    ctx.font = 'bold 16px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${ragPct}%`, cx, cy)
  }, [ragCount, directCount, ragPct])

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:12, marginTop:10 }}>
      <canvas ref={canvasRef} width={140} height={140} />
      <div style={{ display:'flex', gap:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:8, height:8, borderRadius:1, background:'var(--accent)' }} />
          <span style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--muted)' }}>RAG ({ragCount})</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:8, height:8, borderRadius:1, background:'var(--purple)' }} />
          <span style={{ fontSize:9, fontFamily:'var(--font-mono)', color:'var(--muted)' }}>Direct ({directCount})</span>
        </div>
      </div>
    </div>
  )
}

const S = {
  page: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden' },
  header: {
    padding:'14px 22px', borderBottom:'1px solid var(--glass-border)',
    background:'rgba(5,5,8,0.85)', position:'relative', flexShrink:0,
    display:'flex', alignItems:'center', justifyContent:'space-between',
  },
  headerLeft: { display:'flex', flexDirection:'column' },
  headerTitle: {
    fontSize:16, fontFamily:'var(--font-hud)', fontWeight:700,
    color:'var(--accent)', textShadow:'0 0 10px var(--accent-glow)',
  },
  headerSub: { fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', marginTop:2 },
  headerGlow: {
    position:'absolute', bottom:0, left:0, right:0, height:1,
    background:'linear-gradient(90deg, transparent, var(--accent), transparent)',
  },
  refreshBtn: {
    padding:'6px 14px', background:'rgba(0,240,255,0.06)', border:'1px solid var(--accent)',
    color:'var(--accent)', cursor:'pointer', fontSize:9, fontFamily:'var(--font-hud)', letterSpacing:1, borderRadius:2,
  },
  body: { flex:1, overflowY:'auto', padding:'20px', display:'flex', flexDirection:'column', gap:16 },
  kpiRow: { display:'flex', gap:12, flexWrap:'wrap' },
  kpiCard: {
    flex:1, minWidth:120, padding:'16px 14px', borderRadius:3,
    background:'rgba(0,0,0,0.3)', border:'1px solid',
    display:'flex', flexDirection:'column', alignItems:'center', gap:6,
    backdropFilter:'blur(8px)',
  },
  row: { display:'flex', gap:16, flexWrap:'wrap' },
  card: {
    padding:'16px', borderRadius:3, border:'1px solid var(--glass-border)',
    background:'rgba(0,240,255,0.015)', backdropFilter:'blur(8px)',
    minWidth:200,
  },
  cardTitle: {
    fontSize:10, fontFamily:'var(--font-hud)', color:'var(--accent)',
    letterSpacing:2, borderBottom:'1px solid rgba(0,240,255,0.08)', paddingBottom:8,
  },
  recentRow: {
    display:'flex', alignItems:'center', gap:8, padding:'4px 0',
    borderBottom:'1px solid rgba(255,255,255,0.03)',
  },
  recentIdx: { fontSize:9, fontFamily:'var(--font-hud)', color:'rgba(0,240,255,0.3)', flexShrink:0, width:20 },
  recentText: { flex:1, fontSize:11, fontFamily:'var(--font-mono)', color:'var(--muted)', overflow:'hidden', whiteSpace:'nowrap' },
  recentBadge: {
    fontSize:8, fontFamily:'var(--font-hud)', padding:'2px 6px',
    borderRadius:2, border:'1px solid', letterSpacing:1, flexShrink:0,
  },
}
