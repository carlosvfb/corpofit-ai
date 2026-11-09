// Personal trainer: o perfil profissional, os alunos, os treinos enviados e a conversa sobre eles, e o
// lado do aluno (pedir um personal, aceitar, receber e importar treinos). O treino enviado é uma das
// rotinas do próprio personal, no mesmo formato do link de rotina do app; o aluno a importa pelo mesmo
// caminho (e a mesma validação) de um link de amigo. O servidor decide quem vê o quê.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { importRoutineLink, readRoutineBundle, routineLinkBundle } from '../lib/routine-link.js'
import { EXIDX } from '../lib/exercises.js'
import {
  addAssignmentComment, answerAssignment, answerLink, assignSuggestion, assignWorkout, assignmentComments, endLink, errorText, inviteStudent,
  readStudentData, requestTrainer, saveTrainerProfile, shareCategories, sharedWithMe, trainerAssignments, trainerLinks, trainerProfile
} from './api.js'
import { formatDateTime } from './brand.js'

const STATUS = { ASSIGNED: 'Novo', IMPORTED: 'Adicionado às rotinas', DECLINED: 'Recusado', ARCHIVED: 'Arquivado' }
const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null
const Section = ({ children }) => <div className="muted small" style={{ margin: '18px 4px 6px', letterSpacing: '.04em' }}>{children}</div>

function Header() {
  const nav = useNavigate()
  return <div className="hdr">
    <button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Personal trainer</h1><div className="sub">Seu personal, seus alunos e os treinos enviados</div></div>
  </div>
}

const exName = id => EXIDX[id]?.n || id
const day = d => d || '–'

/** O que o aluno compartilhou, de forma legível. Só o que o servidor devolveu para a categoria. */
export function DataView({ category, data }) {
  const empty = <div className="dim small">Sem registros.</div>
  if (category === 'ACTIVITY') return <div className="small">Último treino: {day(data.lastWorkoutDay)} · {data.totalWorkouts} treinos no total{data.perWeek.map(w => <div key={w.weekStart} className="muted">Semana de {w.weekStart}: {w.workouts}</div>)}</div>
  if (category === 'NOTES') return data.workouts.length + data.days.length === 0 ? empty : <div className="small">{data.workouts.map((n, i) => <div key={'w' + i}>{day(n.day)}: {n.note}</div>)}{data.days.map((n, i) => <div key={'d' + i}>{day(n.day)}: {n.text}</div>)}</div>
  if (!Array.isArray(data) || !data.length) return empty
  return <div className="small" style={{ maxHeight: 260, overflow: 'auto' }}>{data.map((r, i) => {
    if (category === 'WORKOUTS') return <div key={i}>{day(r.day)} · {r.name || 'Treino'} · {r.exercises} exercícios, {r.sets} séries</div>
    if (category === 'EXERCISE_HISTORY') return <div key={i}><b>{day(r.day)}</b>{r.entries.map((e, j) => <div key={j} className="muted">{exName(e.exerciseId)}: {e.sets.map(x => x.weight + '×' + x.reps).join(', ')}</div>)}</div>
    if (category === 'ROUTINES') return <div key={i}>{r.name} · {Array.isArray(r.ex) ? r.ex.length : 0} exercícios</div>
    if (category === 'BODY_WEIGHT') return <div key={i}>{day(r.d)}: {r.w}</div>
    return <div key={i}>{Object.entries(r).map(([k, v]) => k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ')}</div>
  })}</div>
}

function Comments({ assignmentId }) {
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const load = useCallback(() => assignmentComments(assignmentId).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar os comentários.'))), [assignmentId])
  useEffect(() => { load() }, [load])
  const send = async e => { e.preventDefault(); setErr(null); try { await addAssignmentComment(assignmentId, text); setText(''); await load() } catch (x) { setErr(errorText(x, 'Não foi possível enviar.')) } }
  return <div style={{ marginTop: 10 }}>
    <Err>{err}</Err>
    {list?.map(c => <div key={c.id} className="small" style={{ margin: '4px 0', textAlign: c.mine ? 'end' : 'start' }}>
      <span style={{ display: 'inline-block', padding: '6px 10px', borderRadius: 12, background: c.mine ? 'var(--acc-soft, rgba(124,92,255,.16))' : 'var(--surface-2, rgba(128,128,128,.15))', overflowWrap: 'anywhere' }}>{c.body}</span>
    </div>)}
    <form onSubmit={send} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <input className="input" value={text} maxLength={1000} onChange={e => setText(e.target.value)} placeholder="Comentar este treino" aria-label="Comentar este treino" />
      <Button type="submit" variant="tinted" disabled={!text.trim()}>Enviar</Button>
    </form>
  </div>
}

/* ------------------------------ lado do personal ------------------------------ */

function TrainerSide({ links, assignments, reload }) {
  const S = useStore(s => s.S)
  const [profile, setProfile] = useState(undefined)
  const [form, setForm] = useState({ displayName: '', bio: '', specialties: '' })
  const [email, setEmail] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null) // vínculo em que se está montando um envio
  const [routineId, setRoutineId] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [shared, setShared] = useState([])
  const [cats, setCats] = useState([])
  const [view, setView] = useState(null) // { linkId, category, data }
  const [asSuggestion, setAsSuggestion] = useState(false)
  const [target, setTarget] = useState('')
  useEffect(() => { sharedWithMe().then(setShared).catch(() => {}); shareCategories().then(setCats).catch(() => {}) }, [links])
  useEffect(() => { trainerProfile().then(p => { setProfile(p); if (p) setForm({ displayName: p.displayName, bio: p.bio, specialties: p.specialties.join(', ') }) }).catch(() => setProfile(null)) }, [])
  const run = async fn => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const mine = links.filter(l => l.side === 'TRAINER')
  const routines = (S?.routines || []).filter(r => Array.isArray(r.ex) && r.ex.length)
  const send = l => run(async () => {
    const r = routines.find(x => x.id === routineId)
    const bundle = routineLinkBundle(S, r, { weights: false, from: profile?.displayName || '' })
    if (asSuggestion) await assignSuggestion(l.id, title.trim() || r.name, note, bundle, target.trim())
    else await assignWorkout(l.id, title.trim() || r.name, note, bundle)
    setOpen(null); setAsSuggestion(false); setTarget(''); setTitle(''); setNote(''); setRoutineId(''); await reload()
  })
  return <>
    <Section>MEU PERFIL PROFISSIONAL</Section>
    <form className="card" onSubmit={e => { e.preventDefault(); run(async () => setProfile(await saveTrainerProfile({ displayName: form.displayName, bio: form.bio, specialties: form.specialties.split(',') }))) }}>
      <Err>{err}</Err>
      <label className="small muted" htmlFor="tp-name">Nome profissional</label>
      <input id="tp-name" className="input" value={form.displayName} maxLength={80} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))} />
      <label className="small muted" htmlFor="tp-bio" style={{ display: 'block', marginTop: 8 }}>Sobre você</label>
      <textarea id="tp-bio" className="input" rows={3} maxLength={600} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
      <label className="small muted" htmlFor="tp-spec" style={{ display: 'block', marginTop: 8 }}>Especialidades (separadas por vírgula)</label>
      <input id="tp-spec" className="input" value={form.specialties} onChange={e => setForm(f => ({ ...f, specialties: e.target.value }))} />
      <div style={{ marginTop: 10 }}><Button variant="primary" type="submit" disabled={busy || form.displayName.trim().length < 2}>{profile ? 'Salvar perfil' : 'Virar personal trainer'}</Button></div>
    </form>
    {profile && <>
      <Section>MEUS ALUNOS</Section>
      <form className="card" style={{ marginBottom: 8 }} onSubmit={e => { e.preventDefault(); run(async () => { await inviteStudent(email.trim()); setEmail(''); await reload() }) }}>
        <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail da conta do aluno" aria-label="E-mail da conta do aluno" />
        <div style={{ marginTop: 8 }}><Button variant="primary" type="submit" disabled={busy || !email.includes('@')}>Convidar aluno</Button></div>
        <div className="dim small" style={{ marginTop: 6 }}>O aluno precisa já ter uma conta e aceitar. Você só envia treinos: não vê dados do aluno sem a autorização dele.</div>
      </form>
      {mine.length === 0 && <div className="card dim small">Nenhum aluno ainda.</div>}
      {mine.map(l => {
        const sent = assignments.filter(a => a.linkId === l.id)
        const grants = shared.find(x => x.linkId === l.id)?.grants || {}
        const canSuggest = grants.ROUTINES === 'SUGGEST'
        const read = async category => { setErr(null); try { setView({ linkId: l.id, category, ...(await readStudentData(l.id, category)) }) } catch (e) { setView(null); setErr(errorText(e, 'Não foi possível ler. O aluno pode ter revogado o acesso.')) } }
        return <div className="card" key={l.id} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{l.other.name || l.other.email}</div>
          <div className="muted small">{l.status === 'PENDING' ? (l.initiatedBy === 'TRAINER' ? 'Convite enviado, esperando o aluno' : 'O aluno pediu para ser atendido por você') : 'Ativo'}</div>
          {l.status === 'PENDING' && l.initiatedBy === 'STUDENT' && <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <Button variant="primary" disabled={busy} onClick={() => run(async () => { await answerLink(l.id, true); await reload() })}>Aceitar</Button>
            <Button variant="tinted" disabled={busy} onClick={() => run(async () => { await answerLink(l.id, false); await reload() })}>Recusar</Button>
          </div>}
          {l.status === 'ACTIVE' && <>
            {open === l.id ? <div style={{ marginTop: 10 }}>
              <select className="input" value={routineId} onChange={e => { setRoutineId(e.target.value); const r = routines.find(x => x.id === e.target.value); if (r && !title) setTitle(r.name) }} aria-label="Rotina a enviar">
                <option value="">Escolha uma das suas rotinas</option>
                {routines.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input className="input" style={{ marginTop: 6 }} value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="Nome do treino" aria-label="Nome do treino" />
              <textarea className="input" style={{ marginTop: 6 }} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Recado para o aluno (opcional)" aria-label="Recado" />
              {canSuggest && <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}><input type="checkbox" checked={asSuggestion} onChange={e => setAsSuggestion(e.target.checked)} /> Enviar como sugestão para uma rotina do aluno</label>}
              {canSuggest && asSuggestion && <input className="input" style={{ marginTop: 6 }} value={target} maxLength={80} onChange={e => setTarget(e.target.value)} placeholder="Nome da rotina do aluno" aria-label="Rotina do aluno" />}
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}><Button variant="primary" disabled={busy || !routineId} onClick={() => send(l)}>Enviar treino</Button><Button variant="tinted" onClick={() => setOpen(null)}>Cancelar</Button></div>
              {routines.length === 0 && <div className="dim small" style={{ marginTop: 6 }}>Monte uma rotina na aba Plano para poder enviá-la.</div>}
            </div> : <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => setOpen(l.id)}>Enviar treino</Button>
              <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Encerrar o vínculo com este aluno?')) run(async () => { await endLink(l.id); await reload() }) }}>Encerrar vínculo</Button>
            </div>}
            <div style={{ marginTop: 10 }}>
              <div className="muted small">O aluno compartilha com você:</div>
              {Object.keys(grants).length === 0 ? <div className="dim small">Nada por enquanto. O aluno controla isso em Privacidade e compartilhamento.</div>
                : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>{Object.keys(grants).map(c => <Button key={c} variant={view?.linkId === l.id && view.category === c ? 'primary' : 'tinted'} onClick={() => read(c)}>{cats.find(x => x.id === c)?.label || c}</Button>)}</div>}
              {view?.linkId === l.id && <div style={{ marginTop: 8 }}><DataView category={view.category} data={view.data} /></div>}
            </div>
            {sent.map(a => <div key={a.id} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--sep, rgba(128,128,128,.25))' }}>
              <div style={{ fontWeight: 600 }}>{a.title}</div>
              <div className="muted small">{STATUS[a.status]} · versão {a.revision} · {formatDateTime(a.createdAt)}</div>
              <Comments assignmentId={a.id} />
            </div>)}
          </>}
        </div>
      })}
    </>}
  </>
}

/* ------------------------------- lado do aluno ------------------------------- */

function StudentSide({ links, assignments, reload }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [email, setEmail] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const run = async fn => { setBusy(true); setErr(null); setNotice(null); try { await fn() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const mine = links.filter(l => l.side === 'STUDENT')
  const add = a => run(async () => {
    const parsed = readRoutineBundle(a.bundle, S?.unit || 'kg')
    update(s => { importRoutineLink(s, parsed) })
    await answerAssignment(a.id, 'IMPORTED')
    setNotice('Treino adicionado às suas rotinas (aba Plano).')
    await reload()
  })
  return <>
    <Section>MEU PERSONAL</Section>
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="small">Por padrão, seu personal não vê nenhum dado seu.</div>
      <div style={{ marginTop: 8 }}><Button variant="tinted" onClick={() => nav('/privacidade')}>Privacidade e compartilhamento</Button></div>
    </div>
    <Err>{err}</Err>
    {notice && <div className="small" role="status" style={{ margin: '6px 0' }}>{notice}</div>}
    <form className="card" style={{ marginBottom: 8 }} onSubmit={e => { e.preventDefault(); run(async () => { await requestTrainer(email.trim()); setEmail(''); await reload() }) }}>
      <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail do seu personal" aria-label="E-mail do seu personal" />
      <div style={{ marginTop: 8 }}><Button variant="primary" type="submit" disabled={busy || !email.includes('@')}>Pedir para ser atendido</Button></div>
      <div className="dim small" style={{ marginTop: 6 }}>O personal precisa ter o perfil profissional criado e aceitar o pedido.</div>
    </form>
    {mine.length === 0 && <div className="card dim small">Você ainda não tem um personal vinculado.</div>}
    {mine.map(l => {
      const got = assignments.filter(a => a.linkId === l.id)
      return <div className="card" key={l.id} style={{ marginBottom: 8 }}>
        <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{l.other.name || l.other.email}</div>
        <div className="muted small">{l.status === 'PENDING' ? (l.initiatedBy === 'TRAINER' ? 'Convidou você para ser aluno' : 'Pedido enviado, esperando o personal') : 'Ativo'}</div>
        {l.status === 'PENDING' && l.initiatedBy === 'TRAINER' && <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <Button variant="primary" disabled={busy} onClick={() => run(async () => { await answerLink(l.id, true); await reload() })}>Aceitar</Button>
          <Button variant="tinted" disabled={busy} onClick={() => run(async () => { await answerLink(l.id, false); await reload() })}>Recusar</Button>
        </div>}
        {l.status === 'ACTIVE' && <div style={{ marginTop: 8 }}>
          <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Encerrar o vínculo com este personal? Os treinos já recebidos ficam com você.')) run(async () => { await endLink(l.id); await reload() }) }}>Encerrar vínculo</Button>
        </div>}
        {got.map(a => <div key={a.id} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--sep, rgba(128,128,128,.25))' }}>
          <div style={{ fontWeight: 600 }}>{a.title}</div>
          <div className="muted small">{a.kind === 'SUGGESTION' ? 'Sugestão' + (a.target ? ' para “' + a.target + '”' : '') + ' · ' : ''}{STATUS[a.status]} · versão {a.revision} · {formatDateTime(a.createdAt)}</div>
          {a.note && <div className="small" style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>{a.note}</div>}
          {a.status === 'ASSIGNED' && <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
            <Button variant="primary" disabled={busy} onClick={() => add(a)}>{a.kind === 'SUGGESTION' ? 'Aceitar como nova rotina' : 'Adicionar às minhas rotinas'}</Button>
            <Button variant="tinted" disabled={busy} onClick={() => run(async () => { await answerAssignment(a.id, 'DECLINED'); await reload() })}>Recusar</Button>
          </div>}
          <Comments assignmentId={a.id} />
        </div>)}
      </div>
    })}
  </>
}

export default function Personal() {
  const [links, setLinks] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState(null)
  const reload = useCallback(async () => {
    try { const [l, a] = await Promise.all([trainerLinks(), trainerAssignments()]); setLinks(l); setAssignments(a) } catch (e) { setError(errorText(e, 'Não foi possível carregar.')) }
  }, [])
  useEffect(() => { reload() }, [reload])
  return <div className="page">
    <Header />
    <Err>{error}</Err>
    {!links && !error && <div className="muted small">Carregando…</div>}
    {links && <>
      <StudentSide links={links} assignments={assignments} reload={reload} />
      <TrainerSide links={links} assignments={assignments} reload={reload} />
    </>}
  </div>
}
