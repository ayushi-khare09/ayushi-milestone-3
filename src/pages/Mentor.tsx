import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Bot, CalendarCheck, Check, CircleAlert, Lightbulb, LoaderCircle, MessageCircle, Send, ShieldCheck, Sparkles, Target } from 'lucide-react'
import { errorMessage } from '../components/ui'
import { api, isDemoMode } from '../services/api'
import type { PipelineRun, ProjectIdea } from '../types/models'

type ChatMessage = { id: string; role: 'student' | 'mentor'; text: string; createdAt: string }
const prompts = ['What should I build first?', 'Is my plan realistic?', 'What should I test?']
const newMessage = (role: ChatMessage['role'], text: string): ChatMessage => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, text, createdAt: new Date().toISOString() })

export default function Mentor() {
  const [projects, setProjects] = useState<ProjectIdea[]>([])
  const [projectId, setProjectId] = useState('')
  const [run, setRun] = useState<PipelineRun | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [checkInOpen, setCheckInOpen] = useState(false)
  const [checkInWeek, setCheckInWeek] = useState(1)
  const [completedWork, setCompletedWork] = useState('')
  const [blockers, setBlockers] = useState('')
  const [nextFocus, setNextFocus] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const project = projects.find(item => item.id === projectId) ?? null

  useEffect(() => {
    let cancelled = false
    api.listProjects().then(list => { if (!cancelled) { setProjects(list); setProjectId(list[0]?.id ?? '') } })
      .catch(e => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setRun(null)
    setError('')
    setCheckInOpen(false)
    setCompletedWork('')
    setBlockers('')
    setNextFocus('')
    if (!project) {
      setMessages([])
      return () => { cancelled = true }
    }

    // Load chat history and pipeline run
    setLoading(true)
    Promise.all([
      api.getMentorMessages(project.id).catch(() => []),
      project.latestRunId ? api.getPipelineRun(project.latestRunId).catch(() => null) : Promise.resolve(null)
    ]).then(([history, runValue]) => {
      if (cancelled) return
      setRun(runValue)
      if (history.length > 0) {
        setMessages(history.map(m => ({ id: m.id, role: m.role, text: m.text, createdAt: m.createdAt })))
      } else {
        const welcome = newMessage('mentor', `Hi! I’m your project mentor for “${project.title}”. Ask me about your project idea, timeline, technology, or how to break down the next step.`)
        setMessages([welcome])
      }
    }).catch(e => {
      if (!cancelled) setError(errorMessage(e))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages])

  const currentWeek = project
    ? Math.min(project.durationWeeks, Math.max(1, Math.floor((Date.now() - new Date(project.createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1))
    : 1
  const send = async (text: string): Promise<boolean> => {
    const question = text.trim()
    if (!question || !project || sending) return false
    setSending(true)
    setError('')
    try {
      const res = await api.sendMentorMessage(project.id, question)
      setMessages(current => [...current, { id: res.studentMessage.id, role: res.studentMessage.role, text: res.studentMessage.text, createdAt: res.studentMessage.createdAt }, { id: res.mentorReply.id, role: res.mentorReply.role, text: res.mentorReply.text, createdAt: res.mentorReply.createdAt }])
      setDraft('')
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setSending(false)
    }
  }
  const submit = (event: FormEvent) => { event.preventDefault(); send(draft) }
  const submitCheckIn = (event: FormEvent) => {
    event.preventDefault()
    const text = `Weekly check-in (week ${checkInWeek})\nCompleted: ${completedWork.trim() || 'Nothing yet'}\nBlockers: ${blockers.trim() || 'None'}\nNext focus: ${nextFocus.trim() || 'Not decided yet'}`
    void send(text).then(sent => {
      if (!sent) return
      setCompletedWork('')
      setBlockers('')
      setNextFocus('')
      setCheckInOpen(false)
    })
  }

  if (loading) return <p className="page-loading"><LoaderCircle className="spin" size={18} /> Opening your mentor workspace…</p>
  if (!project) return <section className="mentor-empty">
    <span className="mentor-empty-icon"><MessageCircle size={22} /></span>
    <span className="muted-label">AI MENTOR</span>
    <h1>Start with a project idea</h1>
    <p>Your mentor workspace will use your project plan to make its guidance more relevant.</p>
    {error && <p className="form-error" role="alert"><CircleAlert size={15} /> {error}</p>}
    <Link className="button button-primary" to="/create">Create a project <ArrowUpRight size={16} /></Link>
  </section>

  return <section className="mentor-workspace" aria-labelledby="mentor-title">
    <header className="mentor-page-head">
      <div><span className="muted-label"><Sparkles size={13} /> YOUR PROJECT GUIDE</span><h1 id="mentor-title">AI Mentor</h1><p>Ask a question and get practical guidance based on your project.</p></div>
      <span className="mentor-demo-badge"><span /> {isDemoMode ? 'Project-aware demo mentor' : 'AI mentor · backend'}</span>
    </header>
    {error && <p className="form-error" role="alert"><CircleAlert size={15} /> {error}</p>}
    <div className="mentor-chat-card">
      <div className="mentor-chat-head">
        <div className="mentor-avatar"><Bot size={20} /></div>
        <div><strong>Project mentor</strong><span>Guidance for your project workspace</span></div>
        <label className="mentor-project-select"><span>PROJECT</span><select aria-label="Choose a project" value={projectId} onChange={event => setProjectId(event.target.value)}>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      </div>
      <div className="mentor-project-context"><Target size={15} /><span>{project.description}</span></div>
      <section className="mentor-checkin" aria-labelledby="mentor-checkin-title">
        <div className="mentor-checkin-heading">
          <div><CalendarCheck size={17} /><div><strong id="mentor-checkin-title">Weekly student check-in</strong><span>Review progress, surface blockers, and agree on a manageable next step.</span></div></div>
          {!checkInOpen && <button type="button" className="button button-ghost" onClick={() => { setCheckInWeek(currentWeek); setCheckInOpen(true) }}>Start check-in</button>}
        </div>
        {checkInOpen && <form className="mentor-checkin-form" onSubmit={submitCheckIn}>
          <label>Project week
            <select value={checkInWeek} onChange={event => setCheckInWeek(Number(event.target.value))}>
              {Array.from({ length: project.durationWeeks }, (_, index) => index + 1).map(week => <option key={week} value={week}>Week {week}</option>)}
            </select>
          </label>
          <label>What did you complete?
            <textarea rows={2} maxLength={120} value={completedWork} onChange={event => setCompletedWork(event.target.value)} placeholder="A feature, task, or learning milestone…" />
          </label>
          <label>What is blocked or difficult?
            <textarea rows={2} maxLength={120} value={blockers} onChange={event => setBlockers(event.target.value)} placeholder="Describe a blocker, or leave blank if there isn't one." />
          </label>
          <label>What will you focus on next?
            <textarea rows={2} maxLength={120} value={nextFocus} onChange={event => setNextFocus(event.target.value)} placeholder="Your next small, achievable outcome…" />
          </label>
          <div className="mentor-checkin-actions">
            <button type="button" className="button button-ghost" onClick={() => setCheckInOpen(false)}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={sending || (!completedWork.trim() && !blockers.trim() && !nextFocus.trim())}>{sending ? <><LoaderCircle size={15} className="spin" /> Sending check-in…</> : <><Send size={14} /> Share check-in with mentor</>}</button>
          </div>
        </form>}
      </section>
      <div className="mentor-messages" aria-live="polite" aria-label="Mentor conversation">
        {messages.map(message => <article key={message.id} className={`mentor-message ${message.role}`}>
          {message.role === 'mentor' && <span className="mentor-message-avatar"><Sparkles size={14} /></span>}
          <div className="mentor-message-bubble"><p>{message.text}</p><time>{new Date(message.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></div>
        </article>)}
        <div ref={bottomRef} />
      </div>
      <div className="mentor-quick-prompts"><span>TRY ASKING</span>{prompts.map(prompt => <button type="button" key={prompt} onClick={() => send(prompt)} disabled={sending}><Lightbulb size={13} /> {prompt}</button>)}</div>
      <form className="mentor-composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="mentor-question">Ask about your project</label>
        <textarea id="mentor-question" rows={1} maxLength={500} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(draft) } }} placeholder="Ask anything about your project…" disabled={sending} />
        {sending && <p className="mentor-sending"><LoaderCircle size={14} className="spin" /> Sending…</p>}
        <button className="button button-primary" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">{sending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}</button>
      </form>
      <p className="mentor-demo-note"><ShieldCheck size={14} /> {isDemoMode ? 'Demo mode uses project-aware local guidance. Live mentor replies use your backend AI configuration; API usage may incur provider charges.' : 'Your messages are sent to the configured backend AI service with project and blueprint context. API usage may incur provider charges.'}</p>
    </div>
    {run?.results && <aside className="mentor-context-summary"><Check size={15} /><span>Project context loaded from your latest blueprint, including the recommended stack and milestones.</span><Link to={`/projects/${project.id}`}>View blueprint</Link></aside>}
  </section>
}

