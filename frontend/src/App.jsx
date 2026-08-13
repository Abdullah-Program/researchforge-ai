import { useState, useRef, useEffect } from 'react'
import Sidebar        from './components/Sidebar.jsx'
import ChatArea       from './components/ChatArea.jsx'
import PipelinePanel  from './components/PipelinePanel.jsx'
import DocumentsPage  from './components/DocumentsPage.jsx'
import PipelineViz    from './components/PipelineViz.jsx'
import AnalyticsPage  from './components/AnalyticsPage.jsx'
const API_BASE = import.meta.env.VITE_API_URL || 'https://researchforge-ai-production.up.railway.app'

export default function App() {
  const [activePage,  setActivePage]  = useState('chat')
  const [messages,    setMessages]    = useState([])
  const [question,    setQuestion]    = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const [firedNodes,  setFiredNodes]  = useState([])
  const [activeNode,  setActiveNode]  = useState(null)
  const [queryCount,  setQueryCount]  = useState(0)
  const [stats, setStats] = useState({ docsFound:null, grade:null, halucheck:null, retries:null })
  const [nodeLogs, setNodeLogs] = useState({})
  const [selectedNode, setSelectedNode] = useState(null)
  const [backendReady, setBackendReady] = useState(false)
  const vizRef = useRef(null)

  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)

  // Poll /health until backend is ready — prevents ECONNREFUSED spam
  useEffect(() => {
    let cancelled = false
    let timer = null
    async function checkHealth() {
      try {
        const r = await fetch(`${API_BASE}/health`)
        if (r.ok && !cancelled) {
          setBackendReady(true)
          return
        }
      } catch (_) {}
      if (!cancelled) timer = setTimeout(checkHealth, 3000)
    }
    checkHealth()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // Fetch all sessions once backend is ready
  useEffect(() => {
    if (!backendReady) return
    fetch(`${API_BASE}/sessions`)
      .then(r => r.json())
      .then(data => {
        setSessions(data)
        if (data.length > 0 && !currentSessionId) {
          selectSession(data[0].id, data)
        }
      })
      .catch(() => {})
  }, [backendReady])

  function selectSession(sessionId, loadedSessions = sessions) {
    setCurrentSessionId(sessionId)
    setSelectedNode(null)
    setFiredNodes([])
    setActiveNode(null)
    vizRef.current?.resetAll()
    
    fetch(`${API_BASE}/sessions/${sessionId}/messages`)
      .then(r => r.json())
      .then(messages => {
        const mapped = messages.map(m => ({
          role: m.role,
          text: m.text,
          sources: m.sources,
          ts: m.timestamp,
          node_logs: m.node_logs
        }))
        setMessages(mapped)
        
        // Find last assistant message to populate node logs
        const aiMsgs = mapped.filter(m => m.role === 'ai')
        if (aiMsgs.length > 0) {
          setNodeLogs(aiMsgs[aiMsgs.length - 1].node_logs || {})
        } else {
          setNodeLogs({})
        }
        setQueryCount(mapped.filter(m => m.role === 'user').length)
      })
      .catch(() => {})
  }

  function handleCreateSession() {
    const title = `Chat_${Date.now().toString().slice(-4)}`
    fetch(`${API_BASE}/sessions?title=${encodeURIComponent(title)}`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        const newSession = { id: data.session_id, title, created_at: new Date().toISOString() }
        setSessions(prev => [newSession, ...prev])
        setCurrentSessionId(data.session_id)
        setMessages([])
        setNodeLogs({})
        setSelectedNode(null)
        setQueryCount(0)
        vizRef.current?.resetAll()
      })
      .catch(() => {})
  }

  function handleDeleteSession(sessionId) {
    fetch(`${API_BASE}/sessions/${sessionId}`, { method: 'DELETE' })
      .then(() => {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null)
          setMessages([])
          setNodeLogs({})
          setSelectedNode(null)
          setQueryCount(0)
          vizRef.current?.resetAll()
        }
      })
      .catch(() => {})
  }

  async function send(overrideQuestion = null) {
    const raw = overrideQuestion ?? question
    const q = (typeof raw === 'string' ? raw : '').trim()
    if (!q || streaming || !backendReady) return

    let activeSession = currentSessionId
    if (!activeSession) {
      try {
        const title = q.slice(0, 26) + (q.length > 26 ? '...' : '')
        const r = await fetch(`${API_BASE}/sessions?title=${encodeURIComponent(title)}`, { method: 'POST' })
        const data = await r.json()
        activeSession = data.session_id
        const newSession = { id: activeSession, title, created_at: new Date().toISOString() }
        setSessions(prev => [newSession, ...prev])
        setCurrentSessionId(activeSession)
      } catch (e) {
        console.error("Failed to auto-create session:", e)
        return
      }
    }

    setFiredNodes([])
    setActiveNode(null)
    setNodeLogs({})
    setSelectedNode(null)
    setStats({ docsFound:null, grade:null, halucheck:null, retries:null })
    vizRef.current?.resetAll()

    setMessages(prev => [...prev, { role:'user', text:q, ts: new Date().toLocaleTimeString() }])
    setQuestion('')
    setStreaming(true)
    setQueryCount(c => c + 1)

    let finalAnswer        = ''
    let finalSources       = []
    let finalLogs          = {}
    let finalFollowUps     = []
    let finalConfidence    = null
    let finalDiagram       = ''
    let finalChunks        = []
    let finalArxivFetched  = false
    let finalArxivStatus   = null

    const es = new EventSource(`${API_BASE}/query/stream?question=${encodeURIComponent(q)}&session_id=${activeSession}`)

    es.onmessage = (e) => {
      if (e.data === '[DONE]') {
        es.close(); setStreaming(false); setActiveNode(null)
        if (finalAnswer) {
          setMessages(prev => [...prev, {
            role:                'ai',
            text:                finalAnswer,
            sources:             finalSources,
            ts:                  new Date().toLocaleTimeString(),
            node_logs:           finalLogs,
            follow_up_questions: finalFollowUps,
            confidence_score:    finalConfidence,
            diagram:             finalDiagram,
            chunks:              finalChunks,
            arxiv_status:        finalArxivStatus,
            originalQuery:       q,
            arxiv_fetched:       finalArxivFetched,
          }])
        }
        return
      }
      try {
        const { node, data } = JSON.parse(e.data)

        // __result__ is our enriched final payload — not a pipeline node
        if (node === '__result__') {
          finalFollowUps  = data.follow_up_questions ?? []
          finalConfidence = data.confidence_score    ?? null
          finalDiagram    = data.diagram             ?? ''
          finalChunks     = data.chunks              ?? []
          // FIX: get sources and arxiv_fetched from result event
          if (data.sources && data.sources.length > 0) {
            finalSources = data.sources
          }
          if (data.arxiv_fetched) {
            finalArxivFetched = true
          }
          return
        }

        setActiveNode(node)
        vizRef.current?.activateNode(node)
        setFiredNodes(prev => [...prev, { node, data, time: Date.now() }])
        if (data.node_log) {
          setNodeLogs(prev => {
            const updated = { ...prev, [node]: data.node_log }
            finalLogs = updated
            return updated
          })
        }
        if (node === 'retriever') {
          setStats(s => ({ ...s, docsFound: data.documents?.count ?? 0 }))
          if (data.arxiv_status) finalArxivStatus = data.arxiv_status
        }
        if (node === 'grader')        setStats(s => ({ ...s, grade: data.grade }))
        if (node === 'rewriter')      setStats(s => ({ ...s, retries: data.retry_count }))
        if (node === 'halucheck')     setStats(s => ({ ...s, halucheck: data.hallucination_check }))
        if (node === 'generate_direct') setStats(s => ({ ...s, halucheck:'not_applicable' }))
        if (data.answer)              finalAnswer = data.answer
        if (data.documents?.sources)  finalSources = data.documents.sources
      } catch (_) {}
    }

    es.onerror = () => {
      es.close(); setStreaming(false); setActiveNode(null)
      setMessages(prev => [...prev, {
        role: 'ai',
        text: 'ERROR :: Connection lost.\n\n**Possible causes:**\n- FastAPI not running → run `uv run python src/api.py`\n- Knowledge base empty → ask any question and it will auto-fetch from arXiv!',
        sources: [], ts: new Date().toLocaleTimeString()
      }])
    }
  }

  function clearSession() {
    setMessages([]); setFiredNodes([]); setNodeLogs({}); setSelectedNode(null)
    setStats({ docsFound:null, grade:null, halucheck:null, retries:null })
    setQueryCount(0)
    vizRef.current?.resetAll()
  }

  function exportSession() {
    const data = {
      exported_at: new Date().toISOString(),
      session_queries: queryCount,
      messages: messages.map(m => ({ role:m.role, text:m.text, sources:m.sources, ts:m.ts })),
      last_pipeline: {
        nodes_fired: firedNodes.map(n => n.node),
        stats,
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `researchforge_session_${Date.now()}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  // agentFlowPage is now always rendered (display:none when hidden) so Three.js never unmounts
  const agentFlowDrawer = selectedNode ? (
    <div style={S.drawer}>
      <div style={S.drawerHeader}>
        <span style={{ color: selectedNode === 'rewriter' ? 'var(--yellow)' : selectedNode === 'router' || selectedNode === 'grader' || selectedNode === 'halucheck' ? 'var(--purple)' : 'var(--accent)', fontFamily:'var(--font-hud)', fontSize:11, fontWeight:700, letterSpacing:1 }}>
          {selectedNode.toUpperCase()} // METRICS & LOGS
        </span>
        <button onClick={() => setSelectedNode(null)} style={S.drawerClose}>✕</button>
      </div>
      <div style={S.drawerContent}>
        {nodeLogs[selectedNode] ? (
          <>
            <div style={S.drawerSection}>
              <div style={S.drawerLabel}>LATENCY</div>
              <div style={{ ...S.drawerValue, color:'var(--warning)' }}>{nodeLogs[selectedNode].latency_ms} ms</div>
            </div>
            <div style={S.drawerSection}>
              <div style={S.drawerLabel}>INPUT_QUERY</div>
              <pre style={S.drawerCode}>{nodeLogs[selectedNode].input}</pre>
            </div>
            <div style={S.drawerSection}>
              <div style={S.drawerLabel}>PROMPT_TEMPLATE</div>
              <pre style={S.drawerCode}>{nodeLogs[selectedNode].prompt}</pre>
            </div>
            <div style={S.drawerSection}>
              <div style={S.drawerLabel}>LLM_OUTPUT</div>
              <pre style={{ ...S.drawerCode, color:'var(--success)' }}>{nodeLogs[selectedNode].output}</pre>
            </div>
          </>
        ) : (
          <div style={{ color:'var(--muted)', fontFamily:'var(--font-mono)', fontSize:11, padding:20, textAlign:'center', paddingTop:60 }}>
            NO_LOGS_AVAILABLE<br/>
            <span style={{ fontSize:10, opacity:0.6 }}>This node was skipped in the last run.</span>
          </div>
        )}
      </div>
    </div>
  ) : null

  return (
    <>
      <div className="scanlines" />
      <div className="bg-grid" />
      <div style={{ display:'flex', height:'100vh', width:'100vw', position:'relative', zIndex:1, overflow:'hidden' }}>
        <Sidebar 
          activePage={activePage} 
          onNav={setActivePage} 
          queryCount={queryCount} 
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={selectSession}
          onDeleteSession={handleDeleteSession}
          onCreateSession={handleCreateSession}
        />

        {/* Chat page */}
        {activePage === 'chat' && (
          <div style={{ flex:1, display:'flex', overflow:'hidden', minWidth:0 }}>
            <ChatArea
              messages={messages}
              streaming={streaming}
              question={question}
              onQuestionChange={setQuestion}
              onSend={send}
              onClear={clearSession}
              onExport={exportSession}
              onFollowUp={(q) => { setQuestion(q); send(q) }}
              backendReady={backendReady}
            />
            <PipelinePanel firedNodes={firedNodes} activeNode={activeNode} stats={stats} />
          </div>
        )}

        {/* Agent Flow — ALWAYS mounted so Three.js canvas never unmounts.
            Visibility toggled via display:none/flex so the scene stays alive. */}
        <div style={{ flex:1, display: activePage === 'pipeline' ? 'flex' : 'none', flexDirection:'column', overflow:'hidden' }}>
          <div style={{ padding:'14px 22px', borderBottom:'1px solid var(--glass-border)', background:'rgba(5,5,8,0.85)', position:'relative', flexShrink:0 }}>
            <div style={{ fontSize:16, fontFamily:'var(--font-hud)', color:'var(--accent)', textShadow:'0 0 10px var(--accent-glow)', fontWeight:700 }}>AGENT_FLOW</div>
            <div style={{ fontSize:10, color:'var(--muted)', fontFamily:'var(--font-mono)', marginTop:2 }}>Last pipeline execution // REALTIME_TRACE // Click on 3D nodes to inspect logs</div>
            <div style={{ position:'absolute', bottom:0, left:0, right:0, height:1, background:'linear-gradient(90deg, transparent, var(--accent), transparent)', boxShadow:'0 0 8px var(--accent-glow)' }} />
          </div>
          <div style={{ flex:1, position:'relative', display:'flex', minHeight:0 }}>
            <div style={{ flex:1, minWidth:0 }}>
              <PipelineViz 
                ref={vizRef} 
                onNodeClick={(name) => setSelectedNode(name)}
                onReady={() => {
                  firedNodes.forEach(e => vizRef.current?.activateNode(e.node))
                }}
              />
            </div>
            {agentFlowDrawer}
          </div>
          {firedNodes.length > 0 ? (
            <div style={{ padding:'16px 40px', borderTop:'1px solid var(--glass-border)', display:'flex', gap:30, flexWrap:'wrap', flexShrink:0, background:'rgba(5,5,8,0.85)' }}>
              {[['NODES_FIRED', firedNodes.length],['DOCS_FOUND', stats.docsFound ?? '--'],['GRADE', stats.grade?.toUpperCase() ?? '--'],['HALLUCINATION', stats.halucheck?.toUpperCase() ?? '--'],['RETRIES', stats.retries ?? 0],['TOTAL_TIME', firedNodes.length > 1 ? (firedNodes[firedNodes.length-1].time - firedNodes[0].time)+'ms' : '--']].map(([l,v]) => (
                <div key={l} style={{ textAlign:'center' }}>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:18, fontWeight:700, color: l==='HALLUCINATION' && v==='HALLUCINATED' ? 'var(--danger)' : l==='HALLUCINATION' && v==='GROUNDED' ? 'var(--success)' : 'var(--accent)' }}>{v}</div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize:9, color:'var(--muted)', letterSpacing:1, marginTop:4 }}>{l}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign:'center', padding:20, color:'var(--muted)', fontFamily:'var(--font-mono)', fontSize:12, borderTop:'1px solid var(--glass-border)', background:'rgba(5,5,8,0.85)' }}>
              NO_PIPELINE_DATA // Ask a question in CHAT_INTERFACE first
            </div>
          )}
        </div>

        {activePage === 'docs'       && <DocumentsPage />}
        {activePage === 'analytics'  && <AnalyticsPage />}
      </div>
    </>
  )
}

const S = {
  drawer: {
    width: 320,
    background: 'rgba(5,5,8,0.98)',
    borderLeft: '1px solid var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    position: 'relative',
    zIndex: 10,
    boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
    animation: 'glitchInRight 0.3s ease',
  },
  drawerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    borderBottom: '1px solid var(--glass-border)',
  },
  drawerClose: {
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontSize: 14,
  },
  drawerContent: {
    flex: 1,
    overflowY: 'auto',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  drawerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  drawerLabel: {
    fontSize: 9,
    fontFamily: 'var(--font-hud)',
    color: 'var(--muted)',
    letterSpacing: 1.5,
  },
  drawerValue: {
    fontSize: 12,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text)',
  },
  drawerCode: {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    background: 'rgba(0,240,255,0.02)',
    border: '1px solid var(--glass-border)',
    padding: '8px 10px',
    borderRadius: 2,
    color: 'var(--text)',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    margin: 0,
    maxHeight: 200,
    overflowY: 'auto',
  },
}
