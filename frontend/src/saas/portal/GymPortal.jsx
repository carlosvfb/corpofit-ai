// Portal da academia (computador): quem gerencia a academia (dono, administrador, gerente) entra aqui.
// Alunos e personais não usam este portal: eles têm o app de treino e o portal do personal.
import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui.jsx'
import DesktopShell from './DesktopShell.jsx'
import { Activity, AiUsage, Err, Overview, PlanTab, ROLE_LABEL, RANK, SEES, Settings } from '../Gyms.jsx'
import { Moderation } from '../Library.jsx'
import { GymAgenda, GymWorkouts, OpsSummary, StudentsPanel, TeamPanel } from './GymOps.jsx'
import {
  acceptOrgInvite, cancelPendingInvite, changeOrgRole, createOrg, errorText, inviteOrgMember, orgContexts, orgMembers, removeOrgMember
} from '../api.js'
import { formatDate } from '../brand.js'

const STAFF = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER']
const SECTIONS = [
  ['geral', 'Visão geral', 'dashboard'], ['alunos', 'Alunos', 'students'], ['equipe', 'Equipe', 'team'], ['agenda', 'Agenda', 'schedule'], ['treinos', 'Treinos', 'workouts'],
  ['membros', 'Membros e convites', 'members'], ['configuracoes', 'Configurações', 'settings'],
  ['atividade', 'Atividade', 'activity'], ['ia', 'Uso da IA', 'ai'], ['plano', 'Plano e cobrança', 'plan'], ['moderacao', 'Moderação da biblioteca', 'moderation']
]
// A moderação é do dono e do administrador (a mesma regra do servidor).
// Alunos, equipe, agenda e treinos são da gestão (dono, administrador e gerente), como a lista de membros.
const OPS = ['students', 'team', 'schedule', 'workouts']
const sees = (role, key) => key === 'moderation' ? ['GYM_OWNER', 'GYM_ADMIN'].includes(role) : OPS.includes(key) ? STAFF.includes(role) : SEES[role].includes(key)

/* ------------------------------- lista e criação ------------------------------- */

function GymHome() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => orgContexts().then(setData).catch(e => setError(errorText(e, 'Não foi possível carregar suas academias.'))), [])
  useEffect(() => { load() }, [load])
  const staff = data?.gyms.filter(g => g.status === 'ACTIVE' && STAFF.includes(g.role)) || []
  const invites = data?.gyms.filter(g => g.status === 'INVITED' && STAFF.includes(g.role)) || []
  const create = async e => { e.preventDefault(); setBusy(true); setError(null); try { const g = await createOrg(name.trim()); nav('/academia/' + g.id) } catch (x) { setError(errorText(x, 'Não foi possível criar a academia.')) } finally { setBusy(false) } }
  return <DesktopShell role="Portal da academia" nav={[{ to: '/academia', label: 'Minhas academias', end: true }]} title="Minhas academias" sub="Escolha uma academia para gerenciar ou cadastre a sua.">
    <Err>{error}</Err>
    {!data && !error && <div className="muted">Carregando…</div>}
    {invites.length > 0 && <>
      <h3>Convites</h3>
      <div className="dk-grid" style={{ marginBottom: 20 }}>{invites.map(g => <div className="card" key={g.id}><b>{g.name}</b><div className="muted small">Convite como {ROLE_LABEL[g.role]}</div><div style={{ marginTop: 10 }}><Button variant="primary" onClick={async () => { await acceptOrgInvite(g.id); load() }}>Aceitar convite</Button></div></div>)}</div>
    </>}
    {data && <div className="dk-grid">
      {staff.map(g => <button key={g.id} className="card" onClick={() => nav('/academia/' + g.id)} style={{ textAlign: 'start', cursor: 'pointer' }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{g.name}</div><div className="muted small">{ROLE_LABEL[g.role]}</div>
      </button>)}
      <form className="card" onSubmit={create}>
        <div style={{ fontWeight: 700 }}>Cadastrar uma academia</div>
        <input className="input" style={{ marginTop: 8 }} value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Nome da academia" aria-label="Nome da academia" />
        <div style={{ marginTop: 10 }}><Button variant="primary" type="submit" disabled={busy || name.trim().length < 2}>Criar academia</Button></div>
        <div className="dim small" style={{ marginTop: 8 }}>Você será o dono e convida professores e alunos por e-mail.</div>
      </form>
    </div>}
    {data && staff.length === 0 && invites.length === 0 && <div className="card dim small" style={{ marginTop: 14 }}>Você ainda não gerencia nenhuma academia. Cadastre a sua ao lado.</div>}
  </DesktopShell>
}

/* ---------------------------------- membros ---------------------------------- */

/** Tabela de membros (computador): filtra, convida por e-mail, muda papel, remove e cancela convite pendente. */
export function MembersTable({ id, role }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('STUDENT')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => orgMembers(id).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar os membros.'))), [id])
  useEffect(() => { load() }, [load])
  const act = async fn => { setBusy(true); setErr(null); try { await fn(); await load() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const assignable = Object.keys(RANK).filter(r => role === 'GYM_OWNER' || RANK[r] < RANK[role])
  const manageable = m => m.userId && RANK[m.role] < RANK[role] && ['GYM_OWNER', 'GYM_ADMIN'].includes(role)
  const rows = (list || []).filter(m => (!filter || m.role === filter) && (!q || (m.name || '').toLowerCase().includes(q.toLowerCase()) || (m.email || '').toLowerCase().includes(q.toLowerCase())))
  return <>
    <Err>{err}</Err>
    <form className="card" style={{ marginBottom: 16 }} onSubmit={e => { e.preventDefault(); act(async () => { await inviteOrgMember(id, email.trim(), inviteRole); setEmail('') }) }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Convidar</div>
      <div className="dk-toolbar" style={{ marginBottom: 0 }}>
        <input className="input" type="email" style={{ minWidth: 280 }} value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail (a pessoa pode ainda não ter conta)" aria-label="E-mail do convidado" />
        <select className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value)} aria-label="Papel do convidado">{assignable.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        <Button variant="primary" type="submit" disabled={busy || !email.includes('@')}>Enviar convite</Button>
      </div>
      <div className="dim small" style={{ marginTop: 8 }}>Quem ainda não tem conta recebe o convite depois de se cadastrar e confirmar o e-mail.</div>
    </form>
    <div className="dk-toolbar">
      <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar membros" />
      <select className="input" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filtrar por papel"><option value="">Todos os papéis</option>{Object.keys(RANK).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
      <span className="muted small">{rows.length} de {list?.length ?? 0}</span>
    </div>
    {!list && !err && <div className="muted">Carregando…</div>}
    {list && <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table className="dk-table">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Desde</th><th /></tr></thead>
        <tbody>
          {rows.map(m => <tr key={m.userId || m.pendingId}>
            <td>{m.name || '–'}</td><td>{m.email || '–'}</td>
            <td>{manageable(m) && m.status === 'ACTIVE'
              ? <select className="input" style={{ width: 'auto' }} value={m.role} disabled={busy} aria-label={'Papel de ' + (m.name || '')} onChange={e => act(() => changeOrgRole(id, m.userId, e.target.value))}>{assignable.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
              : ROLE_LABEL[m.role]}</td>
            <td>{m.status === 'ACTIVE' ? 'Ativo' : m.status === 'INVITED' ? 'Convite enviado' : 'Aguardando cadastro'}</td>
            <td>{formatDate(m.since)}</td>
            <td style={{ textAlign: 'end' }}>
              {manageable(m) && <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Remover ' + (m.name || 'esta pessoa') + ' da academia? O acesso termina agora.')) act(() => removeOrgMember(id, m.userId)) }}>Remover</Button>}
              {m.status === 'PENDING_SIGNUP' && <Button variant="tinted" disabled={busy} onClick={() => act(() => cancelPendingInvite(id, m.pendingId))}>Cancelar convite</Button>}
            </td>
          </tr>)}
          {rows.length === 0 && <tr><td colSpan={6} className="dim">Ninguém encontrado.</td></tr>}
        </tbody>
      </table>
    </div>}
  </>
}

/* ----------------------------- uma academia (seções) ----------------------------- */

function GymLayout() {
  const { id, section } = useParams()
  const nav = useNavigate()
  const [ctx, setCtx] = useState(null)
  const [error, setError] = useState(null)
  const [stamp, setStamp] = useState(0)
  useEffect(() => {
    orgContexts().then(c => {
      const g = c.gyms.find(x => x.id === id && x.status === 'ACTIVE' && STAFF.includes(x.role))
      if (!g) setError('Você não gerencia esta academia (ou ela não existe).'); else setCtx(g)
    }).catch(e => setError(errorText(e, 'Não foi possível carregar a academia.')))
  }, [id, stamp])
  if (error) return <DesktopShell role="Portal da academia" nav={[{ to: '/academia', label: 'Minhas academias', end: true }]} title="Academia"><Err>{error}</Err><Button variant="primary" onClick={() => nav('/academia')}>Voltar às minhas academias</Button></DesktopShell>
  if (!ctx) return <DesktopShell role="Portal da academia" nav={[]} title="Academia"><div className="muted">Carregando…</div></DesktopShell>
  const visible = SECTIONS.filter(([, , key]) => sees(ctx.role, key))
  const current = visible.find(([k]) => k === section) || visible[0]
  const key = current[2]
  const navItems = [...visible.map(([k, label]) => ({ to: `/academia/${id}/${k}`, label })), { to: '/academia', label: '← Trocar de academia', end: true }]
  return <DesktopShell role="Portal da academia" nav={navItems} context={{ title: ctx.name, sub: ROLE_LABEL[ctx.role] }} title={current[1]} sub={ctx.name}>
    {key === 'dashboard' && <><OpsSummary id={id} /><Overview id={id} /></>}
    {key === 'students' && <StudentsPanel id={id} />}
    {key === 'team' && <TeamPanel id={id} />}
    {key === 'schedule' && <GymAgenda id={id} />}
    {key === 'workouts' && <GymWorkouts id={id} />}
    {key === 'members' && <MembersTable id={id} role={ctx.role} />}
    {key === 'settings' && <Settings id={id} onSaved={() => setStamp(x => x + 1)} />}
    {key === 'activity' && <Activity id={id} />}
    {key === 'ai' && <AiUsage id={id} />}
    {key === 'plan' && <PlanTab id={id} />}
    {key === 'moderation' && <Moderation gyms={[ctx]} onNotice={() => {}} />}
  </DesktopShell>
}

export default function GymPortal() {
  return <Routes>
    <Route index element={<GymHome />} />
    <Route path="entrar" element={<Navigate to="/academia" replace />} />
    <Route path="cadastro" element={<Navigate to="/academia" replace />} />
    <Route path=":id" element={<GymLayout />} />
    <Route path=":id/:section" element={<GymLayout />} />
    <Route path="*" element={<Navigate to="/academia" replace />} />
  </Routes>
}
