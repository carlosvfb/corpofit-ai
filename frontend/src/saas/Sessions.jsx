// Treinos marcados entre personal e aluno: dia e horário exatos. O personal marca, remarca e registra se o treino
// aconteceu; o aluno confirma ou recusa; os dois podem cancelar. O servidor confere quem pode o quê.
import { useEffect, useState } from 'react'
import { Button } from '../components/ui.jsx'
import { answerSession, cancelSession, createSessions, errorText, trainerAssignments, updateSession } from './api.js'

export const when = d => new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const dayKey = d => new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
export const SESSION_STATUS = { PLANNED: 'Aguardando confirmação', CONFIRMED: 'Confirmado', DONE: 'Treino feito', MISSED: 'Faltou', CANCELLED: 'Cancelado' }
const OPEN = ['PLANNED', 'CONFIRMED']
const pad = n => String(n).padStart(2, '0')
/** Valor de <input type="datetime-local"> (horário local) para uma data. */
export const toInput = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}` }
const tomorrow9 = () => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(9, 0, 0, 0); return toInput(x) }
const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null

/** Marcar (linkId fixo ou escolhido entre `students`) ou remarcar (`session`). */
export function SessionForm({ linkId, students, session, defaultAt, onDone, onCancel }) {
  const [link, setLink] = useState(linkId || session?.linkId || students?.[0]?.linkId || '')
  const [f, setF] = useState({ title: session?.title || '', at: session ? toInput(session.startsAt) : (defaultAt || tomorrow9()), durationMin: session?.durationMin || 60, place: session?.place || '', note: session?.note || '', repeatWeeks: 0, assignmentId: session?.assignmentId || '' })
  const [plans, setPlans] = useState([])
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (link) trainerAssignments(link).then(a => setPlans(a.filter(x => x.kind !== 'SUGGESTION' && x.status !== 'DECLINED'))).catch(() => setPlans([])) }, [link])
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const submit = async e => {
    e.preventDefault(); setErr(null); setBusy(true)
    try {
      const body = { title: f.title, startsAt: new Date(f.at).toISOString(), durationMin: Number(f.durationMin), place: f.place, note: f.note, assignmentId: f.assignmentId || (session ? null : undefined) }
      if (session) await updateSession(session.id, body)
      else await createSessions(link, { ...body, repeatWeeks: Number(f.repeatWeeks) })
      onDone?.()
    } catch (x) { setErr(errorText(x, 'Não foi possível salvar.')) } finally { setBusy(false) }
  }
  return <form className="card" onSubmit={submit} style={{ marginBottom: 10 }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>{session ? 'Remarcar treino' : 'Marcar treino'}</div>
    <Err>{err}</Err>
    {!linkId && !session && students && <select className="input" value={link} onChange={e => setLink(e.target.value)} aria-label="Aluno">{students.map(s => <option key={s.linkId} value={s.linkId}>{s.name || 'Aluno'}</option>)}</select>}
    <input className="input" style={{ marginTop: 6 }} value={f.title} maxLength={80} onChange={e => set('title', e.target.value)} placeholder="Nome do treino (ex.: Treino A, pernas)" aria-label="Nome do treino" />
    <label className="small muted" htmlFor="ss-at" style={{ display: 'block', marginTop: 8 }}>Dia e horário</label>
    <input id="ss-at" className="input" type="datetime-local" value={f.at} onChange={e => set('at', e.target.value)} />
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <select className="input" value={f.durationMin} onChange={e => set('durationMin', e.target.value)} aria-label="Duração">{[30, 45, 60, 75, 90, 120].map(m => <option key={m} value={m}>{m} min</option>)}</select>
      {!session && <select className="input" value={f.repeatWeeks} onChange={e => set('repeatWeeks', e.target.value)} aria-label="Repetir">
        <option value={0}>Não repetir</option>{[1, 2, 3, 4, 8, 12].map(n => <option key={n} value={n}>Repetir toda semana por +{n}</option>)}
      </select>}
    </div>
    <input className="input" style={{ marginTop: 6 }} value={f.place} maxLength={120} onChange={e => set('place', e.target.value)} placeholder="Local (academia, sala, link da chamada)" aria-label="Local" />
    {plans.length > 0 && <select className="input" style={{ marginTop: 6 }} value={f.assignmentId} onChange={e => set('assignmentId', e.target.value)} aria-label="Treino previsto">
      <option value="">Sem treino definido</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
    </select>}
    <textarea className="input" style={{ marginTop: 6 }} rows={2} maxLength={500} value={f.note} onChange={e => set('note', e.target.value)} placeholder="Recado para o aluno (opcional)" aria-label="Recado" />
    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
      <Button variant="primary" type="submit" disabled={busy || f.title.trim().length < 2 || !f.at}>{session ? 'Salvar novo horário' : 'Marcar'}</Button>
      <Button variant="tinted" type="button" onClick={onCancel}>Cancelar</Button>
    </div>
    {session && <div className="dim small" style={{ marginTop: 6 }}>Mudar o dia ou o horário pede uma nova confirmação do aluno.</div>}
  </form>
}

/** Um treino marcado, com as ações de quem olha. `role`: 'trainer' ou 'student'. */
export function SessionRow({ s, role, onChange, showWho = true }) {
  const [edit, setEdit] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const open = OPEN.includes(s.status)
  const past = new Date(s.startsAt).getTime() < Date.now() - 3_600_000
  const run = async fn => { setErr(null); setBusy(true); try { await fn(); onChange?.() } catch (x) { setErr(errorText(x, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const cancel = () => {
    const series = !!s.seriesId && window.confirm('Cancelar também os próximos treinos dessa repetição semanal?\n\nOK = este e os próximos. Cancelar = só este.')
    const reason = window.prompt('Motivo (opcional):', '') ?? null
    if (reason === null) return
    run(() => cancelSession(s.id, reason, series))
  }
  if (edit) return <SessionForm session={s} onDone={() => { setEdit(false); onChange?.() }} onCancel={() => setEdit(false)} />
  const who = role === 'trainer' ? s.student : s.trainer
  return <div className="card" style={{ marginBottom: 8, opacity: s.status === 'CANCELLED' ? .6 : 1 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ fontWeight: 700 }}>{s.title}</div>
      <span className="small" style={{ color: s.status === 'CONFIRMED' || s.status === 'DONE' ? 'var(--green, #30d158)' : s.status === 'MISSED' || s.status === 'CANCELLED' ? 'var(--red)' : 'inherit' }}>{SESSION_STATUS[s.status]}</span>
    </div>
    <div className="small">{when(s.startsAt)} às {new Date(s.endsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {s.durationMin} min</div>
    <div className="muted small">{showWho && who ? who + ' · ' : ''}{s.place || 'Local a combinar'}</div>
    {s.note && <div className="small" style={{ marginTop: 4, overflowWrap: 'anywhere' }}>{s.note}</div>}
    {s.status === 'CANCELLED' && <div className="muted small">Cancelado por {s.cancelledBy === 'TRAINER' ? 'o personal' : 'o aluno'}{s.reason ? ': ' + s.reason : ''}</div>}
    <Err>{err}</Err>
    {open && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {role === 'student' && s.status === 'PLANNED' && <>
        <Button variant="primary" disabled={busy} onClick={() => run(() => answerSession(s.id, 'confirm'))}>Confirmar</Button>
        <Button variant="tinted" disabled={busy} onClick={() => run(() => answerSession(s.id, 'decline'))}>Não posso</Button>
      </>}
      {role === 'trainer' && <>
        {s.startsAt && new Date(s.startsAt).getTime() < Date.now() + 3_600_000 && <>
          <Button variant="primary" disabled={busy} onClick={() => run(() => answerSession(s.id, 'done'))}>Treino feito</Button>
          <Button variant="tinted" disabled={busy} onClick={() => run(() => answerSession(s.id, 'missed'))}>Faltou</Button>
        </>}
        {!past && <Button variant="tinted" disabled={busy} onClick={() => setEdit(true)}>Remarcar</Button>}
      </>}
      <Button variant="tinted" disabled={busy} onClick={cancel}>Cancelar</Button>
    </div>}
  </div>
}

/** Agrupa por dia, em ordem. */
export function groupByDay(list) {
  const out = []
  for (const s of list) { const k = dayKey(s.startsAt); const g = out.at(-1); if (g && g.k === k) g.items.push(s); else out.push({ k, items: [s] }) }
  return out
}

/* ------------------------------ calendário mensal ------------------------------ */

export const localDay = d => toInput(d).slice(0, 10)
const DOT = { PLANNED: '#ffb020', CONFIRMED: '#30d158', DONE: '#8e8e93', MISSED: '#ff453a', CANCELLED: '#636366' }
const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Mês em grade: cada dia mostra pontos coloridos pelo status dos compromissos; tocar no dia seleciona.
 *  `sessions`: lista do mês; `selected`/`onSelect`: dia 'YYYY-MM-DD'; `month`/`onMonth`: primeiro dia do mês. */
export function MonthCalendar({ sessions, month, onMonth, selected, onSelect }) {
  const byDay = {}
  for (const s of sessions) (byDay[localDay(s.startsAt)] ||= []).push(s)
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const cells = []
  for (let i = 0; i < first.getDay(); i++) cells.push(null)
  for (let d = 1; d <= new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(); d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
  const today = localDay(new Date())
  const go = n => onMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))
  return <div className="card cal" style={{ padding: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Button variant="tinted" size="sm" onClick={() => go(-1)} aria-label="Mês anterior">‹</Button>
      <div style={{ textAlign: 'center' }}>
        <b style={{ textTransform: 'capitalize', fontSize: 17 }}>{month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</b>
        <div><button type="button" className="small" style={{ background: 'none', border: 0, color: 'var(--acc, #7c5cff)', padding: 0 }} onClick={() => { const n = new Date(); onMonth(new Date(n.getFullYear(), n.getMonth(), 1)); onSelect(localDay(n)) }}>Hoje</button></div>
      </div>
      <Button variant="tinted" size="sm" onClick={() => go(1)} aria-label="Próximo mês">›</Button>
    </div>
    <div className="cal-grid">
      {WEEK.map(w => <div key={w} className="cal-w">{w}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={'e' + i} />
        const k = localDay(d), list = byDay[k] || [], on = k === selected
        return <button key={k} type="button" className={'cal-d' + (on ? ' sel' : '') + (k === today ? ' today' : '')} onClick={() => onSelect(k)} aria-label={`${d.getDate()}, ${list.length} compromisso(s)`} aria-pressed={on}>
          <span>{d.getDate()}</span>
          <span className="cal-dots">{list.slice(0, 3).map(s => <i key={s.id} style={{ background: DOT[s.status] }} />)}{list.length > 3 && <small>+{list.length - 3}</small>}</span>
        </button>
      })}
    </div>
    <div className="small muted" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
      {[['PLANNED', 'Aguardando'], ['CONFIRMED', 'Confirmado'], ['DONE', 'Feito'], ['MISSED', 'Faltou']].map(([k, l]) => <span key={k}><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: DOT[k], marginInlineEnd: 4 }} />{l}</span>)}
    </div>
  </div>
}
