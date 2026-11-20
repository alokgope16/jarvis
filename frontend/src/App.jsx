import { useEffect, useRef, useState } from 'react'
import './App.css'

const LABELS = {
  idle: 'Offline · text only',
  sleeping: 'Say "Hello Jarvis"',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

const WELCOME = { id: 0, role: 'system', text: 'Type below, or switch to Online to talk to Jarvis.' }
const MODEL_TAGS = { 'llama3.2:3b': 'BALANCED', 'llama3.2:1b': 'FAST', 'qwen2.5:3b': 'ALT' }

let nextId = 1

export default function App() {
  const [mode, setModeState] = useState('offline')
  const [status, setStatus] = useState('idle')
  const [messages, setMessages] = useState([WELCOME])
  const [models, setModels] = useState([])
  const [model, setModel] = useState('')
  const [input, setInput] = useState('')
  const [chats, setChats] = useState([])
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 800)

  const chatEnd = useRef(null)
  const chatIdRef = useRef(crypto.randomUUID())
  const [activeId, setActiveId] = useState(chatIdRef.current)
  const modelRef = useRef('')
  // values that voice callbacks need to read without going stale
  const r = useRef({
    mode: 'offline', state: 'idle', awake: false, muted: false,
    pendingSpeech: 0, streamDone: true, controller: null,
    recognition: null, awakeTimer: null, restartTimer: null,
    utterances: [], lastSpeakAt: 0,
  })
  modelRef.current = model

  /* ---------- helpers ---------- */
  const setState = s => { r.current.state = s; setStatus(s) }
  const addMsg = (role, text) => {
    const id = nextId++
    setMessages(m => [...m, { id, role, text }])
    return id
  }
  const updateMsg = (id, text) =>
    setMessages(m => m.map(x => (x.id === id ? { ...x, text } : x)))

  /* ---------- chat history ---------- */
  const loadChats = () =>
    fetch('/api/chats').then(res => res.json()).then(setChats).catch(() => {})

  const newChat = () => {
    stop()
    const id = crypto.randomUUID()
    chatIdRef.current = id
    setActiveId(id)
    setMessages([WELCOME])
  }

  const openChat = async id => {
    if (id === chatIdRef.current) return
    stop()
    chatIdRef.current = id
    setActiveId(id)
    try {
      const res = await fetch(`/api/chats/${id}`)
      const list = await res.json()
      setMessages(list.length
        ? list.map(m => ({ id: nextId++, role: m.role === 'user' ? 'user' : 'jarvis', text: m.text }))
        : [WELCOME])
    } catch {
      setMessages([{ id: nextId++, role: 'system', text: 'Could not load this chat.' }])
    }
    if (window.innerWidth <= 800) setSidebarOpen(false)
  }

  const deleteChat = async (id, e) => {
    e.stopPropagation()
    if (!window.confirm('Delete this chat?')) return
    await fetch(`/api/chats/${id}`, { method: 'DELETE' })
    if (id === chatIdRef.current) newChat()
    loadChats()
  }

  /* ---------- mode toggle ---------- */
  const setMode = m => {
    r.current.mode = m
    if (m === 'online') { if (!startVoice()) r.current.mode = 'offline' }
    else stopVoice()
    setModeState(r.current.mode)
  }

  /* ---------- voice: listening ---------- */
  // Opens a fresh listening session (only when online, unmuted, and none is open)
  const listen = () => {
    const c = r.current
    if (c.mode !== 'online' || c.muted || c.recognition) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-IN'
    rec.onresult = handleSpeech
    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        addMsg('system', 'Microphone access was blocked. Allow it in the address bar and try again.')
        setMode('offline')
      } else if (e.error === 'network') {
        addMsg('system', 'Voice needs internet in Online mode. Switched to Offline.')
        setMode('offline')
      }
    }
    rec.onend = () => {
      // Chrome ends sessions now and then. Open a fresh one after a short pause.
      if (c.recognition === rec) {
        c.recognition = null
        clearTimeout(c.restartTimer)
        c.restartTimer = setTimeout(listen, 300)
      }
    }
    c.recognition = rec
    try {
      rec.start()
    } catch {
      c.recognition = null
      clearTimeout(c.restartTimer)
      c.restartTimer = setTimeout(listen, 500)   // retry until it works
    }
  }

  // Close the microphone (used while Jarvis thinks or speaks)
  const pauseListening = () => {
    const c = r.current
    c.muted = true
    clearTimeout(c.restartTimer)
    const rec = c.recognition
    if (rec) {
      c.recognition = null
      rec.onresult = rec.onerror = rec.onend = null
      try { rec.abort() } catch { /* ignore */ }
    }
  }

  // Reopen the microphone once Jarvis is quiet
  const resumeListening = () => {
    const c = r.current
    c.muted = false
    clearTimeout(c.restartTimer)
    c.restartTimer = setTimeout(listen, 400)
  }

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice needs Chrome or Edge.'); return false }
    r.current.muted = false
    setState('sleeping')
    listen()
    return true
  }

  const stopVoice = () => {
    const c = r.current
    pauseListening()
    speechSynthesis.cancel()
    c.pendingSpeech = 0
    c.utterances = []
    c.awake = false
    clearTimeout(c.awakeTimer)
    setState('idle')
  }

  const handleSpeech = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal || r.current.muted) continue
      onHeard(e.results[i][0].transcript.trim())
    }
  }

  const onHeard = text => {
    const c = r.current
    console.log('[voice] heard:', text)
    const m = text.match(/\b(?:hello|hey|hi)\s+jarvis\b[\s,.!?]*(.*)$/i)
    if (m) {
      if (m[1].trim()) { c.awake = false; ask(m[1].trim()) }   // "Hello Jarvis, what is Java?"
      else wakeUp()
    } else if (c.awake) {
      c.awake = false
      clearTimeout(c.awakeTimer)
      ask(text)
    }
  }

  const wakeUp = () => {
    const c = r.current
    c.awake = true
    pauseListening()
    setState('listening')
    addMsg('jarvis', 'Yes boss, how may I help you?')
    speak('Yes boss, how may I help you?')
    if (c.pendingSpeech === 0) finishIfIdle()   // in case speech could not start
    clearTimeout(c.awakeTimer)
    c.awakeTimer = setTimeout(() => {           // back to sleep if nothing is said
      c.awake = false
      if (c.state === 'listening') setState('sleeping')
    }, 20000)
  }

  /* ---------- voice: speaking ---------- */
  const speak = text => {
    const c = r.current
    if (c.mode !== 'online' || !text.trim()) return
    const u = new SpeechSynthesisUtterance(text)
    const v = speechSynthesis.getVoices().find(v => v.localService && v.lang.startsWith('en'))
    if (v) u.voice = v
    c.utterances.push(u)   // keep a reference, or Chrome may drop it before it finishes
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      c.utterances = c.utterances.filter(x => x !== u)
      c.pendingSpeech = Math.max(0, c.pendingSpeech - 1)
      finishIfIdle()
    }
    u.onstart = () => setState('speaking')
    u.onend = done
    u.onerror = done
    c.pendingSpeech++
    c.lastSpeakAt = Date.now()
    speechSynthesis.speak(u)
  }

  const speakCompleteSentences = buf => {   // speak each sentence once it is complete
    let m
    while ((m = buf.match(/^([\s\S]*?[.!?])\s+/))) {
      speak(m[1])
      buf = buf.slice(m[0].length)
    }
    return buf
  }

  const finishIfIdle = () => {
    const c = r.current
    if (c.pendingSpeech > 0 || !c.streamDone) return
    if (c.mode === 'online') {
      setState(c.awake ? 'listening' : 'sleeping')
      resumeListening()
    } else {
      setState('idle')
    }
  }

  /* ---------- talking to Spring Boot ---------- */
  const ask = async text => {
    if (!text) return
    const c = r.current
    pauseListening()                 // close the mic while Jarvis answers
    clearTimeout(c.awakeTimer)
    addMsg('user', text)
    const botId = addMsg('jarvis', '')
    setState('thinking')
    c.controller = new AbortController()
    c.streamDone = false
    let full = '', sentenceBuf = ''
    try {
      const url = `/api/chat?message=${encodeURIComponent(text)}` +
        `&model=${encodeURIComponent(modelRef.current)}&sessionId=${chatIdRef.current}`
      const res = await fetch(url, { signal: c.controller.signal })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) !== -1) {   // one event = one token
          const evt = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const token = evt.split('\n').filter(l => l.startsWith('data:'))
            .map(l => l.slice(5)).join('\n')
          full += token
          sentenceBuf = speakCompleteSentences(sentenceBuf + token)
          updateMsg(botId, full)
        }
      }
      if (sentenceBuf.trim()) speak(sentenceBuf)
    } catch (err) {
      if (err.name !== 'AbortError') updateMsg(botId, 'Could not reach Jarvis. Is Ollama running?')
    } finally {
      c.streamDone = true
      c.controller = null
      finishIfIdle()
      setTimeout(loadChats, 600)     // refresh the sidebar (new chat title, ordering)
    }
  }

  const send = () => {
    const t = input.trim()
    setInput('')
    ask(t)
  }

  const stop = () => {
    const c = r.current
    if (c.controller) c.controller.abort()
    speechSynthesis.cancel()
    c.pendingSpeech = 0
    c.utterances = []
    c.awake = false
    c.streamDone = true
    finishIfIdle()
  }

  /* ---------- effects ---------- */
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(list => { setModels(list); setModel(list[0] || '') })
      .catch(() => addMsg('system', 'Could not reach the Jarvis backend. Is it running on port 8080?'))
    loadChats()
    return () => stopVoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Watchdog: if Chrome never reports that speech ended, recover so Jarvis does not stay stuck
  useEffect(() => {
    const t = setInterval(() => {
      const c = r.current
      if (c.pendingSpeech > 0 && Date.now() - c.lastSpeakAt > 1500 &&
          !speechSynthesis.speaking && !speechSynthesis.pending) {
        c.pendingSpeech = 0
        c.utterances = []
        finishIfIdle()
      }
    }, 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { chatEnd.current?.scrollIntoView() }, [messages])

  /* ---------- UI ---------- */
  return (
    <div className={`app s-${status}`}>
      <div className="bg-grid" />
      <div className="bg-glow" />

      <aside className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
        <div className="side-title">CHATS</div>
        <button className="new-chat" onClick={newChat}><span>+</span> New chat</button>
        <ul className="chat-list">
          {chats.length === 0 && <li className="empty-hint">No saved chats yet.</li>}
          {chats.map(c => (
            <li
              key={c.id}
              className={`chat-item ${c.id === activeId ? 'active' : ''}`}
              onClick={() => openChat(c.id)}
            >
              <span className="t">{c.title}</span>
              <button className="x" onClick={e => deleteChat(c.id, e)} aria-label="Delete chat">×</button>
            </li>
          ))}
        </ul>
        <div className="side-foot">Chats are saved only on this laptop, in a local database file.</div>
      </aside>

      <div className="workspace">
        <header>
          <div className="left">
            <button className="icon-btn" onClick={() => setSidebarOpen(o => !o)} aria-label="Toggle chat history">☰</button>
            <span className="brand">J.A.R.V.I.S</span>
          </div>
          <div className="controls">
            <ModelPicker models={models} value={model} onChange={setModel} />
            <button
              className={`switch ${mode}`}
              onClick={() => setMode(mode === 'offline' ? 'online' : 'offline')}
              aria-label="Toggle online or offline mode"
            >
              <span className="knob" />
              {mode === 'online' ? 'Online' : 'Offline'}
            </button>
          </div>
        </header>

        <main>
          <div className={`stage ${status}`}>
            <div className="ring r1" />
            <div className="ring r2" />
            <div className="ring r3" />
            <div className="ripple" />
            <div className="ripple d2" />
            <div className="core" />
          </div>
          <div className={`bars ${status}`}>
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />
            ))}
          </div>
          <p className="status">{LABELS[status]}</p>

          <div className="chat">
            {messages.map(m => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.text || <span className="dots"><i /><i /><i /></span>}
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
        </main>

        <footer>
          <p className={`privacy ${mode}`}>
            {mode === 'online'
              ? 'Voice on · speech is transcribed by the browser’s cloud service · answers come from the local model'
              : 'Fully offline and private · microphone off · everything runs on this laptop'}
          </p>
          <div className="composer">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask Jarvis anything…"
            />
            <button className="ghost" onClick={stop} aria-label="Stop">■</button>
            <button onClick={send} aria-label="Send">↑</button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ---------- custom model dropdown ---------- */
function ModelPicker({ models, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div className="picker" ref={ref}>
      <button
        className={`picker-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="picker-label">MODEL</span>
        <span className="picker-value">{value || 'loading…'}</span>
        <svg className="chev" width="12" height="12" viewBox="0 0 12 12">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul className="picker-menu" role="listbox">
          {models.map(m => (
            <li
              key={m}
              role="option"
              aria-selected={m === value}
              className={m === value ? 'selected' : ''}
              onClick={() => { onChange(m); setOpen(false) }}
            >
              <span className="name">{m}</span>
              <span className="meta">
                {MODEL_TAGS[m] && <em className="tag">{MODEL_TAGS[m]}</em>}
                {m === value && <span className="tick">●</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}