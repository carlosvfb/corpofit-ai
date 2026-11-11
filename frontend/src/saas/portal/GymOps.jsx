// Gestão da academia (computador): números da operação, alunos com o seu personal, equipe com a carga de cada um,
// agenda do mês e treinos enviados. A gestão enxerga os vínculos e a agenda da academia, nunca os dados de treino do aluno
// (isso depende da permissão dele). Vincular um aluno a um personal é uma proposta: o aluno aceita no app dele.
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../../components/ui.jsx'
import { Err } from '../Gyms.jsx'
import { MonthCalendar, SESSION_STATUS, localDay } from '../Sessions.jsx'
import { assignGymTrainer, communityItems, errorText, gymRoster, gymSchedule, gymWorkouts } from '../api.js'
import { formatDate, formatDateTime } from '../brand.js'

const ROLE = { PERSONAL_TRAINER: 'Personal', GYM_MANAGER: 'Gerente', GYM_ADMIN: 'Administrador', GYM_OWNER: 'Dono' }
const LINK = { ACTIVE: 'Ativo', PENDING: 'Aguardando o aluno aceitar' }
const ASG = { ASSIGNED: 'Novo', IMPORTED: 'Adicionado pelo aluno', DECLINED: 'Recusado', ARCHIVED: 'Arquivado' }
const Tile = ({ label, value, hint, warn }) => <div className="card" style={{ flex: '1 1 150px' }}>
  <div className="muted small">{label}</div>
  <div style={{ fontSize: 28, fontWeight: 800, color: warn && value > 0 ? 'var(--red, #ff453a)' : undefined }}>{value}</div>
  {hint && <div className="dim small">{hint}</div>}
</div>

export function useRoster(id) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => gymRoster(id).then(d => { setData(d); setErr(null) }).catch(e => setErr(errorText(e, 'Não foi possível carregar a operação da academia.'))), [id])
  useEffect(() => { load() }, [load])
  return { data, err, load }
}

/** Faixa de números no topo da visão geral. */
export function OpsSummary({ id }) {
  const { data, err } = useRoster(id)
  if (err) return <Err>{err}</Err>
  if (!data) return null
  const s = data.summary
  return <div style={{ marginBottom: 16 }}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Tile label="Alunos sem personal" value={s.withoutTrainer} hint="Vincule na aba Alunos" warn />
      <Tile label="Fichas vencidas" value={s.plansExpired ?? 0} hint={s.plansExpiring ? `${s.plansExpiring} vencem em 3 dias` : undefined} warn />
      <Tile label="Alunos com personal" value={s.withTrainer} hint={s.waitingStudent ? `${s.waitingStudent} aguardando aceitar` : undefined} />
      <Tile label="Personais na equipe" value={s.trainers} />
      <Tile label="Treinos nos próximos 7 dias" value={s.sessionsNext7Days} />
      <Tile label="Treinos feitos (30 dias)" value={s.doneLast30} />
      <Tile label="Faltas (30 dias)" value={s.missedLast30} warn />
    </div>
  </div>
}

/* --------------------------------- alunos --------------------------------- */

export function StudentsPanel({ id }) {
  const { data, err, load } = useRoster(id)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const trainers = (data?.team || []).filter(t => t.role === 'PERSONAL_TRAINER' || t.students > 0)
  const rows = (data?.students || []).filter(s => (!only || !s.trainer) && (!q || (s.name || '').toLowerCase().includes(q.toLowerCase()) || (s.email || '').toLowerCase().includes(q.toLowerCase())))
  const assign = async (s, trainerId) => {
    setBusy(true); setError(null); setDone(null)
    try { await assignGymTrainer(id, s.userId, trainerId || null); setDone(trainerId ? `Proposta enviada a ${s.name}. Ele precisa aceitar no app.` : `${s.name} ficou sem personal.`); await load() } catch (e) { setError(errorText(e, 'Não foi possível vincular.')) } finally { setBusy(false) }
  }
  return <>
    <Err>{err || error}</Err>
    {done && <div className="small" role="status" style={{ marginBottom: 10 }}>{done}</div>}
    <div className="dk-toolbar">
      <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar aluno por nome ou e-mail" aria-label="Buscar aluno" />
      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Só sem personal</label>
      <span className="muted small">{rows.length} de {data?.students.length ?? 0}</span>
    </div>
    {!data && !err && <div className="muted">Carregando…</div>}
    {data && <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table className="dk-table">
        <thead><tr><th>Aluno</th><th>E-mail</th><th>Personal responsável</th><th>Ficha de treino</th><th>Próximo treino</th><th>Feitos (30d)</th><th>Faltas (30d)</th><th>Desde</th></tr></thead>
        <tbody>
          {rows.map(s => <tr key={s.userId}>
            <td><b>{s.name || '–'}</b></td><td>{s.email || '–'}</td>
            <td>
              <select className="input" style={{ width: 'auto', minWidth: 170 }} disabled={busy} value={s.trainer?.userId || ''} aria-label={'Personal de ' + (s.name || '')} onChange={e => assign(s, e.target.value)}>
                <option value="">Sem personal</option>
                {trainers.map(t => <option key={t.userId} value={t.userId}>{t.name}</option>)}
              </select>
              {s.trainer && <div className="muted small">{LINK[s.trainer.status]}</div>}
            </td>
            <td>{s.planReview ? <>{s.planReview.title}<div className="small" style={{ color: s.planReview.state === 'expired' ? 'var(--red, #ff453a)' : undefined }}>{s.planReview.state === 'expired' ? 'Venceu em ' : 'Vale até '}{new Date(s.planReview.reviewAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</div></> : <span className="muted">{s.trainer ? 'Sem prazo' : '–'}</span>}</td>
            <td>{s.nextSession ? <>{s.nextSession.title}<div className="muted small">{formatDateTime(s.nextSession.startsAt)}</div></> : <span className="muted">–</span>}</td>
            <td>{s.doneLast30}</td><td style={{ color: s.missedLast30 > 1 ? 'var(--red, #ff453a)' : undefined }}>{s.missedLast30}</td>
            <td>{formatDate(s.since)}</td>
          </tr>)}
          {rows.length === 0 && <tr><td colSpan={8} className="dim">Nenhum aluno. Convide em “Membros”.</td></tr>}
        </tbody>
      </table>
    </div>}
    <div className="dim small" style={{ marginTop: 10 }}>A academia vê quem atende quem, a agenda e os treinos enviados. Os dados de treino do aluno só aparecem para o personal, e só se o aluno liberar.</div>
  </>
}

/* --------------------------------- equipe --------------------------------- */

export function TeamPanel({ id }) {
  const { data, err } = useRoster(id)
  return <>
    <Err>{err}</Err>
    {!data && !err && <div className="muted">Carregando…</div>}
    {data && <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table className="dk-table">
        <thead><tr><th>Profissional</th><th>Função</th><th>Alunos</th><th>Aguardando aceitar</th><th>Treinos (7d)</th><th>Feitos (30d)</th><th>Faltas (30d)</th><th>Treinos enviados (30d)</th></tr></thead>
        <tbody>
          {data.team.map(t => <tr key={t.userId}>
            <td><b>{t.name || '–'}</b><div className="muted small">{t.email}</div></td><td>{ROLE[t.role]}</td>
            <td>{t.students}</td><td>{t.pending}</td><td>{t.sessionsNext7Days}</td><td>{t.doneLast30}</td><td>{t.missedLast30}</td><td>{t.workoutsSentLast30}</td>
          </tr>)}
          {data.team.length === 0 && <tr><td colSpan={8} className="dim">Nenhum personal na equipe. Convide em “Membros” com a função Personal trainer.</td></tr>}
        </tbody>
      </table>
    </div>}
    <div className="dim small" style={{ marginTop: 10 }}>Para convidar, mudar a função ou remover alguém da equipe, use “Membros”.</div>
  </>
}

/* ---------------------------------- agenda ---------------------------------- */

export function GymAgenda({ id }) {
  const now = new Date()
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1))
  const [selected, setSelected] = useState(localDay(now))
  const [trainer, setTrainer] = useState('')
  const [list, setList] = useState(null)
  const [team, setTeam] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => { gymRoster(id).then(d => setTeam(d.team)).catch(() => {}) }, [id])
  useEffect(() => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1).toISOString()
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()
    gymSchedule(id, { from, to, trainer }).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar a agenda.')))
  }, [id, month, trainer])
  const day = (list || []).filter(s => localDay(s.startsAt) === selected)
  const label = new Date(selected + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 520px) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
    <div>
      <Err>{err}</Err>
      <div className="dk-toolbar"><select className="input" value={trainer} onChange={e => setTrainer(e.target.value)} aria-label="Filtrar por personal"><option value="">Todos os personais</option>{team.map(t => <option key={t.userId} value={t.userId}>{t.name}</option>)}</select></div>
      <MonthCalendar sessions={(list || []).filter(s => s.status !== 'CANCELLED')} month={month} onMonth={setMonth} selected={selected} onSelect={setSelected} />
    </div>
    <div>
      <h3 style={{ textTransform: 'capitalize', margin: '0 0 2px' }}>{label}</h3>
      <div className="muted small" style={{ marginBottom: 10 }}>{day.length === 0 ? 'Nenhum compromisso' : day.length + (day.length === 1 ? ' compromisso' : ' compromissos')}</div>
      {day.map(s => <div className="card" key={s.id} style={{ marginBottom: 8, opacity: s.status === 'CANCELLED' ? .55 : 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{s.title}</b><span className="small">{SESSION_STATUS[s.status]}</span></div>
        <div className="small">{new Date(s.startsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} às {new Date(s.endsAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {s.durationMin} min</div>
        <div className="muted small">{s.trainer} com {s.student}{s.place ? ' · ' + s.place : ''}</div>
      </div>)}
    </div>
  </div>
}

/* --------------------------------- treinos --------------------------------- */

export function GymWorkouts({ id }) {
  const [rows, setRows] = useState(null)
  const [lib, setLib] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    gymWorkouts(id).then(setRows).catch(e => setErr(errorText(e, 'Não foi possível carregar os treinos.')))
    communityItems({ scope: 'gym', tenant: id, kind: 'ROUTINE' }).then(r => setLib(r.items || r)).catch(() => setLib([]))
  }, [id])
  return <>
    <Err>{err}</Err>
    <h3>Enviados pelos personais aos alunos</h3>
    {!rows && !err && <div className="muted">Carregando…</div>}
    {rows && <div className="card" style={{ padding: 0, overflow: 'auto', marginBottom: 22 }}>
      <table className="dk-table">
        <thead><tr><th>Treino</th><th>Personal</th><th>Aluno</th><th>Situação</th><th>Versão</th><th>Enviado em</th></tr></thead>
        <tbody>
          {rows.map(w => <tr key={w.id}><td><b>{w.title}</b>{w.kind === 'SUGGESTION' && <div className="muted small">Sugestão</div>}</td><td>{w.trainer}</td><td>{w.student}</td><td>{ASG[w.status]}</td><td>{w.revision}</td><td>{formatDateTime(w.createdAt)}</td></tr>)}
          {rows.length === 0 && <tr><td colSpan={6} className="dim">Nenhum treino enviado ainda. Quando os personais da academia enviarem treinos aos alunos vinculados, eles aparecem aqui.</td></tr>}
        </tbody>
      </table>
    </div>}
    <h3>Biblioteca de treinos da academia</h3>
    <div className="dim small" style={{ marginBottom: 8 }}>Rotinas que a equipe publicou só para esta academia (Ajustes → Biblioteca → Publicar, escolhendo a academia). Os alunos e personais da academia podem adicioná-las às suas rotinas.</div>
    {lib && lib.length === 0 && <div className="card dim small">Nenhuma rotina publicada para a academia ainda.</div>}
    <div className="dk-grid">{(lib || []).map(i => <div className="card" key={i.id}><b>{i.title}</b><div className="muted small">{i.author} · {i.imports} adições</div>{i.description && <div className="small" style={{ marginTop: 4 }}>{i.description}</div>}</div>)}</div>
  </>
}
