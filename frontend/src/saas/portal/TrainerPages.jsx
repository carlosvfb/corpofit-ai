// Páginas do portal do personal: alunos com sinais de atenção, agenda com dia e horário exatos, a ficha de cada
// aluno (treinos, agenda, progresso, anotações privadas, acesso) e o montador de treinos.
// O que o aluno faz fica no app dele; aqui o personal só vê o que o aluno autorizou (o servidor confere a cada leitura).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import '../saas.css'
import './portal.css'
import { Button } from '../../components/ui.jsx'
import { useStore } from '../../store/useStore.js'
import { EXIDX, isCardio, isHold } from '../../lib/exercises.js'
import { pickedExerciseConfig } from '../../lib/history.js'
import { exConfigSheet, exercisePicker } from '../../sheets.jsx'
import { exerciseNameFor } from '../../lib/i18n-core.js'
import { readRoutineBundle, routineLinkBundle } from '../../lib/routine-link.js'
import { Comments, DataView } from '../Personal.jsx'
import { MonthCalendar, SessionForm, SessionRow, localDay, when } from '../Sessions.jsx'
import {
  addTrainerNote, answerLink, assignWorkout, deleteTrainerNote, endLink, errorText, inviteStudent, readStudentData, shareCategories, sharedWithMe,
  trainerAssignments, trainerLinks, trainerNotes, trainerOverview, trainerSessions, updateAssignment
} from '../api.js'
import { formatDateTime } from '../brand.js'

const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null
const Page = ({ title, note, back, action, children }) => <div className="page">
  <div className="pt-head"><div>{back}<h1>{title}</h1></div>{action}</div>
  {note && <p className="pt-note">{note}</p>}
  {children}
</div>
const STATUS = { ASSIGNED: 'Novo', IMPORTED: 'Adicionado pelo aluno', DECLINED: 'Recusado', ARCHIVED: 'Arquivado' }
const FLAG = { inactive: 'Está sem treinar', 'no-workouts': 'Ainda não treinou', missed: 'Faltou 2+ vezes', 'to-mark': 'Registrar presença' }

/* ------------------------------ montador de treino ------------------------------ */

const summary = e => {
  const mode = e.mode || (isCardio(e.id) ? 'cardio' : isHold(e.id) ? 'time' : 'reps')
  const w = e.weight ? ` · ${e.weight}` : ''
  const r = e.restSec ? ` · descanso ${e.restSec}s` : ''
  if (mode === 'cardio') return `${e.min ?? '?'} min${e.speed ? ' · vel. ' + e.speed : ''}`
  if (Array.isArray(e.pyramid) && e.pyramid.length) return `${e.pyramid.length} séries em pirâmide${w}${r}`
  if (mode === 'time') return `${e.sets} × ${e.sec ?? '?'} s${w}${r}`
  return `${e.sets} × ${e.reps ?? e.repsMin ?? '?'}${e.repsMax ? '–' + e.repsMax : ''}${w}${r}`
}

/** O mesmo montador da área do aluno: o seletor de exercícios do app (catálogo completo, busca, filtros, os seus próprios
 *  exercícios) e a tela de configuração de cada exercício (séries, repetições, carga, descanso, progressão, superséries).
 *  O treino montado vai para um aluno e fica como rotina dele. */
export function WorkoutBuilder({ link, initial, onDone, onCancel }) {
  const S = useStore(s => s.S)
  const [title, setTitle] = useState(initial?.title || '')
  const [note, setNote] = useState(initial?.note || '')
  const [items, setItems] = useState(() => { try { return initial ? readRoutineBundle(initial.bundle, S?.unit || 'kg').routines[0].ex : [] } catch { return [] } })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const pseudo = { id: 'builder', name: title.trim() || 'Treino', ex: items }
  const add = () => exercisePicker((ex, quick) => {
    if (quick) setItems(a => [...a, { id: ex.id, ...pickedExerciseConfig(ex.id) }])
    else exConfigSheet(ex, null, cfg => setItems(a => [...a, { id: ex.id, ...cfg }]), null, pseudo, null, null, undefined, { backups: true })
  })
  const edit = i => exConfigSheet(EXIDX[items[i].id] || { id: items[i].id, n: items[i].id }, items[i], cfg => setItems(a => a.map((x, j) => j === i ? { id: x.id, ...cfg } : x)), () => setItems(a => a.filter((_, j) => j !== i)), pseudo)
  const move = (i, d) => setItems(a => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b })
  const send = async () => {
    setErr(null); setBusy(true)
    try {
      const bundle = routineLinkBundle(S, { ...pseudo, name: title.trim() }, { weights: true })
      if (initial) await updateAssignment(initial.id, { title: title.trim(), note, bundle })
      else await assignWorkout(link.id, title.trim(), note, bundle)
      onDone?.()
    } catch (e) { setErr(errorText(e, 'Não foi possível enviar o treino.')) } finally { setBusy(false) }
  }
  return <div className="card" style={{ marginBottom: 12 }}>
    <div style={{ fontWeight: 700 }}>{initial ? 'Editar treino' : 'Montar treino para ' + (link.other?.name || 'o aluno')}</div>
    <Err>{err}</Err>
    <input className="input" style={{ marginTop: 8 }} value={title} maxLength={80} onChange={e => setTitle(e.target.value)} placeholder="Nome do treino (ex.: Treino A, peito e tríceps)" aria-label="Nome do treino" />
    <textarea className="input" style={{ marginTop: 6 }} rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Orientações para o aluno (opcional)" aria-label="Orientações" />
    {items.length === 0 && <div className="dim small" style={{ marginTop: 10 }}>Nenhum exercício ainda. Toque em “Adicionar exercício”.</div>}
    {items.map((it, i) => <div key={i} style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--sep, rgba(128,128,128,.25))', display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
      <button type="button" className="wb-ex" onClick={() => edit(i)} style={{ background: 'none', border: 0, color: 'inherit', textAlign: 'start', padding: 0, flex: 1, minWidth: 0 }}>
        <b style={{ overflowWrap: 'anywhere' }}>{i + 1}. {exerciseNameFor(EXIDX[it.id]) || it.id}</b>
        <div className="muted small">{summary(it)} · toque para editar</div>
      </button>
      <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
        <Button variant="tinted" size="sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">↑</Button>
        <Button variant="tinted" size="sm" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Descer">↓</Button>
        <Button variant="tinted" size="sm" onClick={() => setItems(a => a.filter((_, j) => j !== i))} aria-label="Remover">✕</Button>
      </span>
    </div>)}
    <div style={{ marginTop: 12 }}><Button variant="tinted" onClick={add}>Adicionar exercício</Button></div>
    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
      <Button variant="primary" disabled={busy || title.trim().length < 2 || items.length === 0} onClick={send}>{initial ? 'Salvar nova versão' : 'Enviar ao aluno'}</Button>
      <Button variant="tinted" onClick={onCancel}>Cancelar</Button>
    </div>
    {initial && <div className="dim small" style={{ marginTop: 6 }}>A versão anterior fica guardada no histórico e o aluno recebe o aviso.</div>}
  </div>
}

/* ------------------------------ lista de alunos ------------------------------ */

export function StudentsHome() {
  const nav = useNavigate()
  const [rows, setRows] = useState(null)
  const [pending, setPending] = useState([])
  const [email, setEmail] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { const [o, l] = await Promise.all([trainerOverview(), trainerLinks()]); setRows(o); setPending(l.filter(x => x.side === 'TRAINER' && x.status === 'PENDING')) } catch (e) { setErr(errorText(e, 'Não foi possível carregar.')) }
  }, [])
  useEffect(() => { load() }, [load])
  const run = async fn => { setBusy(true); setErr(null); try { await fn(); await load() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  return <Page title="Alunos" note="Você vê do aluno só o que ele autorizar. Quem precisa de atenção aparece primeiro.">
    <Err>{err}</Err>
    {pending.map(l => <div className="card" key={l.id} style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 700 }}>{l.other.name || l.other.email}</div>
      <div className="muted small">{l.initiatedBy === 'STUDENT' ? 'Pediu para ser atendido por você' : 'Convite enviado, esperando o aluno'}</div>
      {l.initiatedBy === 'STUDENT' && <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
        <Button variant="primary" disabled={busy} onClick={() => run(() => answerLink(l.id, true))}>Aceitar</Button>
        <Button variant="tinted" disabled={busy} onClick={() => run(() => answerLink(l.id, false))}>Recusar</Button>
      </div>}
    </div>)}
    {!rows && !err && <div className="muted small">Carregando…</div>}
    {rows?.length === 0 && <div className="card dim small">Nenhum aluno ativo ainda. Convide pelo e-mail da conta dele logo abaixo.</div>}
    {rows?.map(r => <button key={r.linkId} type="button" className="card" onClick={() => nav('/personal/aluno/' + r.linkId)} style={{ display: 'block', width: '100%', textAlign: 'start', marginBottom: 8, color: 'inherit' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <b style={{ overflowWrap: 'anywhere' }}>{r.name || 'Aluno'}</b><span aria-hidden="true">›</span>
      </div>
      {r.flags.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0' }}>{r.flags.map(f => <span key={f} className="small" style={{ padding: '2px 8px', borderRadius: 10, background: 'rgba(255,69,58,.15)', color: 'var(--red)' }}>{FLAG[f]}</span>)}</div>}
      <div className="small">{r.shares ? (r.lastWorkoutDay ? `Último treino: ${new Date(r.lastWorkoutDay + 'T12:00:00').toLocaleDateString('pt-BR')} (há ${r.daysSinceLastWorkout} ${r.daysSinceLastWorkout === 1 ? 'dia' : 'dias'})` : 'Ainda não registrou treinos') : <span className="muted">Frequência não compartilhada pelo aluno</span>}</div>
      {r.workoutsLast4Weeks !== null && <div className="muted small">{r.workoutsLast4Weeks} treinos nas últimas 4 semanas</div>}
      <div className="small">{r.nextSession ? `Próximo: ${r.nextSession.title}, ${when(r.nextSession.startsAt)}${r.nextSession.status === 'PLANNED' ? ' (aguardando confirmação)' : ''}` : <span className="muted">Nenhum treino marcado</span>}</div>
      {r.pendingAssignments > 0 && <div className="muted small">{r.pendingAssignments} treino(s) enviado(s) ainda não adicionado(s) pelo aluno</div>}
    </button>)}
    <form className="card" style={{ marginTop: 12 }} onSubmit={e => { e.preventDefault(); run(async () => { await inviteStudent(email.trim()); setEmail('') }) }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Convidar aluno</div>
      <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail da conta do aluno" aria-label="E-mail da conta do aluno" />
      <div style={{ marginTop: 8 }}><Button variant="primary" type="submit" disabled={busy || !email.includes('@')}>Convidar aluno</Button></div>
      <div className="dim small" style={{ marginTop: 6 }}>O aluno precisa já ter conta e aceitar. Ao aceitar, ele escolhe o que compartilha com você.</div>
    </form>
  </Page>
}

/* ------------------------------ agenda geral ------------------------------ */

export function Agenda() {
  const now = new Date()
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selected, setSelected] = useState(localDay(now))
  const [list, setList] = useState(null)
  const [students, setStudents] = useState([])
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState(null)
  const load = useCallback(async () => {
    try {
      const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString()
      const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()
      const [s, o] = await Promise.all([trainerSessions({ from, to }), trainerOverview()])
      setList(s); setStudents(o)
    } catch (e) { setErr(errorText(e, 'Não foi possível carregar a agenda.')) }
  }, [month])
  useEffect(() => { load() }, [load])
  const day = (list || []).filter(s => localDay(s.startsAt) === selected)
  const label = new Date(selected + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  return <Page title="Agenda" note="Toque em um dia para ver todos os compromissos dele. O aluno confirma pelo app dele.">
    <Err>{err}</Err>
    <MonthCalendar sessions={(list || []).filter(s => s.status !== 'CANCELLED')} month={month} onMonth={setMonth} selected={selected} onSelect={d => { setSelected(d); setCreating(false) }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 4px 8px', gap: 8 }}>
      <div><b style={{ textTransform: 'capitalize' }}>{label}</b><div className="muted small">{day.length === 0 ? 'Nenhum compromisso' : day.length + (day.length === 1 ? ' compromisso' : ' compromissos')}</div></div>
      {students.length > 0 && !creating && <Button variant="primary" size="sm" onClick={() => setCreating(true)}>Marcar neste dia</Button>}
    </div>
    {creating && <SessionForm students={students} defaultAt={selected + 'T09:00'} onDone={() => { setCreating(false); load() }} onCancel={() => setCreating(false)} />}
    {!list && !err && <div className="muted small">Carregando…</div>}
    {list && students.length === 0 && <div className="card dim small">Aceite um aluno em “Alunos” para marcar treinos.</div>}
    {day.map(s => <SessionRow key={s.id} s={s} role="trainer" onChange={load} />)}
  </Page>
}

/* ------------------------------ ficha do aluno ------------------------------ */

const TABS = [['treinos', 'Treinos'], ['agenda', 'Agenda'], ['progresso', 'Progresso'], ['notas', 'Notas'], ['acesso', 'Acesso']]

function TabTreinos({ link }) {
  const [list, setList] = useState(null)
  const [building, setBuilding] = useState(null) // null | 'new' | assignment
  const S = useStore(s => s.S)
  const routines = (S?.routines || []).filter(r => Array.isArray(r.ex) && r.ex.length)
  const sendOwn = r => { setErr(null); assignWorkout(link.id, r.name, '', routineLinkBundle(S, r, { weights: true })).then(() => load()).catch(e => setErr(errorText(e, 'Não foi possível enviar.'))) }
  const [err, setErr] = useState(null)
  const load = useCallback(() => trainerAssignments(link.id).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))), [link.id])
  useEffect(() => { load() }, [load])
  return <>
    <Err>{err}</Err>
    {building ? <WorkoutBuilder link={link} initial={building === 'new' ? null : building} onDone={() => { setBuilding(null); load() }} onCancel={() => setBuilding(null)} />
      : <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" onClick={() => setBuilding('new')}>Montar novo treino</Button>
        {routines.length > 0 && <select className="input" style={{ width: 'auto', flex: 1, minWidth: 160 }} value="" aria-label="Enviar uma rotina do meu plano" onChange={e => { const r = routines.find(x => x.id === e.target.value); if (r) sendOwn(r) }}>
          <option value="">Enviar uma rotina do meu plano…</option>
          {routines.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>}
      </div>}
    {!list && !err && <div className="muted small" style={{ marginTop: 8 }}>Carregando…</div>}
    {list?.length === 0 && !building && <div className="card dim small" style={{ marginTop: 8 }}>Nenhum treino enviado a este aluno ainda. Monte um escolhendo os exercícios, as séries e as repetições.</div>}
    {list?.map(a => <div className="card" key={a.id} style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 700 }}>{a.title}</div>
      <div className="muted small">{a.kind === 'SUGGESTION' ? 'Sugestão' + (a.target ? ' para “' + a.target + '”' : '') + ' · ' : ''}{STATUS[a.status]} · versão {a.revision} · {formatDateTime(a.createdAt)}</div>
      {a.note && <div className="small" style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>{a.note}</div>}
      {a.kind !== 'SUGGESTION' && ['ASSIGNED', 'IMPORTED'].includes(a.status) && <div style={{ marginTop: 6 }}><Button variant="tinted" onClick={() => setBuilding(a)}>Editar treino</Button></div>}
      <Comments assignmentId={a.id} />
    </div>)}
  </>
}

function TabAgenda({ link }) {
  const [list, setList] = useState(null)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState(null)
  const load = useCallback(() => trainerSessions({ link: link.id, from: new Date(Date.now() - 30 * 86_400_000).toISOString() }).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))), [link.id])
  useEffect(() => { load() }, [load])
  const now = Date.now()
  const next = (list || []).filter(s => new Date(s.startsAt).getTime() >= now - 3_600_000)
  const past = (list || []).filter(s => new Date(s.startsAt).getTime() < now - 3_600_000).reverse()
  return <>
    <Err>{err}</Err>
    {creating ? <SessionForm linkId={link.id} onDone={() => { setCreating(false); load() }} onCancel={() => setCreating(false)} /> : <Button variant="primary" onClick={() => setCreating(true)}>Marcar treino</Button>}
    {!list && !err && <div className="muted small" style={{ marginTop: 8 }}>Carregando…</div>}
    {list && <div className="muted small" style={{ margin: '14px 4px 6px' }}>PRÓXIMOS</div>}
    {list && next.length === 0 && <div className="card dim small">Nenhum treino marcado à frente.</div>}
    {next.map(s => <SessionRow key={s.id} s={s} role="trainer" onChange={load} showWho={false} />)}
    {past.length > 0 && <div className="muted small" style={{ margin: '14px 4px 6px' }}>ANTERIORES</div>}
    {past.map(s => <SessionRow key={s.id} s={s} role="trainer" onChange={load} showWho={false} />)}
  </>
}

function TabProgresso({ link }) {
  const [shared, setShared] = useState(null)
  const [cats, setCats] = useState([])
  const [view, setView] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { Promise.all([sharedWithMe(), shareCategories()]).then(([s, c]) => { setShared(s.find(x => x.linkId === link.id)?.grants || {}); setCats(c) }).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))) }, [link.id])
  const read = async category => { setErr(null); try { setView({ category, ...(await readStudentData(link.id, category)) }) } catch (e) { setView(null); setErr(errorText(e, 'Não foi possível ler. O aluno pode ter revogado o acesso.')) } }
  useEffect(() => { if (shared) { const first = ['WORKOUTS', 'ACTIVITY'].find(c => shared[c]); if (first) read(first) } }, [shared]) // eslint-disable-line react-hooks/exhaustive-deps
  const granted = Object.keys(shared || {})
  return <>
    <Err>{err}</Err>
    {!shared && !err && <div className="muted small">Carregando…</div>}
    {shared && granted.length === 0 && <div className="card small">Este aluno ainda não compartilha nada com você. Peça para ele ligar o atalho “Acompanhamento de treino” em Privacidade e compartilhamento: ele escolhe o que você vê e pode revogar quando quiser.</div>}
    {granted.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {granted.map(c => <Button key={c} variant={view?.category === c ? 'primary' : 'tinted'} onClick={() => read(c)}>{cats.find(x => x.id === c)?.label || c}</Button>)}
    </div>}
    {view && <div className="card" style={{ marginTop: 10 }}><DataView category={view.category} data={view.data} /><div className="dim small" style={{ marginTop: 6 }}>Cada leitura fica registrada para o aluno ver.</div></div>}
  </>
}

function TabNotas({ link }) {
  const [list, setList] = useState(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState(null)
  const load = useCallback(() => trainerNotes(link.id).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))), [link.id])
  useEffect(() => { load() }, [load])
  const add = async e => { e.preventDefault(); setErr(null); try { await addTrainerNote(link.id, text); setText(''); await load() } catch (x) { setErr(errorText(x, 'Não foi possível salvar.')) } }
  return <>
    <div className="dim small" style={{ marginBottom: 8 }}>Anotações só suas: o aluno nunca as vê. Use para lesões, preferências, metas e combinados.</div>
    <Err>{err}</Err>
    <form className="card" onSubmit={add}>
      <textarea className="input" rows={3} maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder="Nova anotação" aria-label="Nova anotação" />
      <div style={{ marginTop: 8 }}><Button variant="primary" type="submit" disabled={!text.trim()}>Salvar anotação</Button></div>
    </form>
    {list?.map(n => <div className="card" key={n.id} style={{ marginTop: 8 }}>
      <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{n.body}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <span className="muted small">{formatDateTime(n.at)}</span>
        <Button variant="tinted" size="sm" onClick={() => { if (window.confirm('Apagar esta anotação?')) deleteTrainerNote(n.id).then(load).catch(x => setErr(errorText(x, 'Não foi possível apagar.'))) }}>Apagar</Button>
      </div>
    </div>)}
  </>
}

function TabAcesso({ link, onEnded }) {
  const [shared, setShared] = useState(null)
  const [cats, setCats] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => { Promise.all([sharedWithMe(), shareCategories()]).then(([s, c]) => { setShared(s.find(x => x.linkId === link.id)?.grants || {}); setCats(c) }).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))) }, [link.id])
  const label = c => cats.find(x => x.id === c)?.label || c
  return <>
    <Err>{err}</Err>
    <div className="card">
      <div style={{ fontWeight: 700 }}>O que {link.other?.name || 'o aluno'} compartilha com você</div>
      {shared && Object.keys(shared).length === 0 && <div className="dim small">Nada por enquanto.</div>}
      {shared && Object.entries(shared).map(([c, lvl]) => <div key={c} className="small">{label(c)}: {lvl === 'SUGGEST' ? 'ver e sugerir' : 'ver'}</div>)}
      <div className="dim small" style={{ marginTop: 6 }}>O aluno controla isso e pode mudar a qualquer momento. Você nunca altera os dados dele diretamente.</div>
    </div>
    <div style={{ marginTop: 12 }}><Button variant="tinted" onClick={() => { if (window.confirm('Encerrar o vínculo com este aluno? A agenda futura entre vocês deixa de valer.')) endLink(link.id).then(onEnded).catch(e => setErr(errorText(e, 'Não foi possível encerrar.'))) }}>Encerrar vínculo</Button></div>
  </>
}

export function StudentDetail() {
  const { linkId } = useParams()
  const nav = useNavigate()
  const [link, setLink] = useState(undefined)
  const [tab, setTab] = useState('treinos')
  useEffect(() => { trainerLinks().then(l => setLink(l.find(x => x.id === linkId && x.side === 'TRAINER' && x.status === 'ACTIVE') || null)).catch(() => setLink(null)) }, [linkId])
  if (link === undefined) return <div className="page"><div className="muted small">Carregando…</div></div>
  if (!link) return <Page title="Aluno" back={<button className="btn-link small" onClick={() => nav('/personal')}>‹ Alunos</button>}><div className="card dim small">Aluno não encontrado ou vínculo encerrado.</div></Page>
  return <Page title={link.other?.name || 'Aluno'} back={<button type="button" className="small" style={{ background: 'none', border: 0, color: 'var(--acc, #7c5cff)', padding: 0 }} onClick={() => nav('/personal')}>‹ Alunos</button>}>
    <div className="ts-tabs" role="tablist">{TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>)}</div>
    {tab === 'treinos' && <TabTreinos link={link} />}
    {tab === 'agenda' && <TabAgenda link={link} />}
    {tab === 'progresso' && <TabProgresso link={link} />}
    {tab === 'notas' && <TabNotas link={link} />}
    {tab === 'acesso' && <TabAcesso link={link} onEnded={() => nav('/personal')} />}
  </Page>
}

