// Academias: a lista dos contextos do usuário (convites pendentes, minhas academias, criar uma) e o
// painel de cada academia (visão geral, membros, configurações, atividade). O servidor decide o que
// cada papel pode (api/saas/org); as abas escondidas aqui são só conforto: o acesso real é checado lá.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import {
  acceptOrgInvite, aiContext, changeOrgRole, createOrg, errorText, inviteOrgMember, leaveOrg, orgActivity, orgAiUsage, orgContexts,
  orgDashboard, orgMembers, orgSettings, removeOrgMember, saveOrgSettings, setAiContext
} from './api.js'
import { formatDateTime } from './brand.js'

export const ROLE_LABEL = {
  GYM_OWNER: 'Dono', GYM_ADMIN: 'Administrador', GYM_MANAGER: 'Gerente', PERSONAL_TRAINER: 'Personal trainer', STUDENT: 'Aluno'
}
const RANK = { GYM_OWNER: 5, GYM_ADMIN: 4, GYM_MANAGER: 3, PERSONAL_TRAINER: 2, STUDENT: 1 }
// Espelho do servidor, só para decidir o que mostrar (api/saas/org/rbac.js é quem vale).
const SEES = {
  GYM_OWNER: ['dashboard', 'members', 'settings', 'activity', 'ai'], GYM_ADMIN: ['dashboard', 'members', 'settings', 'activity', 'ai'],
  GYM_MANAGER: ['dashboard', 'members', 'activity'], PERSONAL_TRAINER: ['dashboard'], STUDENT: []
}
const ACTION_LABEL = {
  'tenant.created': 'Academia criada', 'member.invited': 'Convite enviado', 'member.joined': 'Entrou na academia',
  'member.role-changed': 'Papel alterado', 'member.removed': 'Removido', 'member.left': 'Saiu da academia', 'settings.updated': 'Configurações atualizadas'
}

function Header({ title, sub, back = '/' }) {
  const nav = useNavigate()
  return <div className="hdr">
    <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label="Voltar"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
  </div>
}
const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null

/* ------------------------------ lista de contextos ------------------------------ */

export default function Gyms() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => orgContexts().then(setData).catch(e => setError(errorText(e, 'Não foi possível carregar suas academias.'))), [])
  useEffect(() => { load() }, [load])
  const act = async fn => { setBusy(true); setError(null); try { await fn(); await load() } catch (e) { setError(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const invites = data?.gyms.filter(g => g.status === 'INVITED') || []
  const gyms = data?.gyms.filter(g => g.status === 'ACTIVE') || []
  return <div className="page">
    <Header title="Academias" sub="Seu espaço pessoal e as academias em que você participa" back="/settings" />
    <Err>{error}</Err>
    {!data && !error && <div className="muted small">Carregando…</div>}
    {data && <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700 }}>Espaço pessoal</div>
        <div className="muted small">Seus treinos, histórico e a IA ficam só com você, separados de qualquer academia.</div>
      </div>
      {invites.length > 0 && <>
        <div className="muted small" style={{ margin: '14px 4px 6px' }}>CONVITES</div>
        {invites.map(g => <div className="card" key={g.id} style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>{g.name}</div>
          <div className="muted small">Convite como {ROLE_LABEL[g.role] || g.role}</div>
          <div style={{ marginTop: 8 }}><Button variant="primary" disabled={busy} onClick={() => act(() => acceptOrgInvite(g.id))}>Aceitar convite</Button></div>
        </div>)}
      </>}
      <div className="muted small" style={{ margin: '14px 4px 6px' }}>MINHAS ACADEMIAS</div>
      {gyms.length === 0 && <div className="card dim small" style={{ marginBottom: 8 }}>Você ainda não participa de nenhuma academia.</div>}
      {gyms.map(g => <button key={g.id} className="card" onClick={() => nav('/academias/' + g.id)} style={{ width: '100%', textAlign: 'start', marginBottom: 8, cursor: 'pointer' }}>
        <div style={{ fontWeight: 700 }}>{g.name}</div>
        <div className="muted small">{ROLE_LABEL[g.role] || g.role}</div>
      </button>)}
      <div className="muted small" style={{ margin: '14px 4px 6px' }}>CRIAR UMA ACADEMIA</div>
      <form className="card" onSubmit={e => { e.preventDefault(); act(async () => { const g = await createOrg(name.trim()); setName(''); nav('/academias/' + g.id) }) }}>
        <label className="small muted" htmlFor="gym-name">Nome da academia</label>
        <input id="gym-name" className="input" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Ex.: Academia Força Total" />
        <div style={{ marginTop: 10 }}><Button variant="primary" disabled={busy || name.trim().length < 2} type="submit">Criar academia</Button></div>
        <div className="dim small" style={{ marginTop: 8 }}>Você será o dono e poderá convidar professores e alunos que já tenham conta.</div>
      </form>
    </>}
  </div>
}

/* ------------------------------ painel de uma academia ------------------------------ */

function Overview({ id }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { orgDashboard(id).then(setD).catch(e => setErr(errorText(e, 'Não foi possível carregar o painel.'))) }, [id])
  if (err) return <Err>{err}</Err>
  if (!d) return <div className="muted small">Carregando…</div>
  const Tile = ({ label, value }) => <div className="card" style={{ flex: '1 1 140px' }}><div className="muted small">{label}</div><div style={{ fontSize: 26, fontWeight: 800 }}>{value}</div></div>
  return <>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Tile label="Alunos ativos" value={d.students.active} />
      <Tile label="Novos alunos (30 dias)" value={d.students.joinedLast30Days} />
      <Tile label="Profissionais" value={d.professionals.active} />
      <Tile label="Convites pendentes" value={d.members.invited} />
    </div>
    <div className="dim small" style={{ marginTop: 10 }}>Frequência e evolução dos alunos aparecem aqui quando houver dados autorizados por eles.</div>
  </>
}

function Members({ id, role }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(null)
  const [email, setEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('STUDENT')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => orgMembers(id).then(setList).catch(e => setErr(errorText(e, 'Não foi possível carregar os membros.'))), [id])
  useEffect(() => { load() }, [load])
  const act = async fn => { setBusy(true); setErr(null); try { await fn(); await load() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const assignable = Object.keys(RANK).filter(r => (role === 'GYM_OWNER') || RANK[r] < RANK[role])
  const manageable = m => RANK[m.role] < RANK[role] && ['GYM_OWNER', 'GYM_ADMIN'].includes(role)
  return <>
    <Err>{err}</Err>
    <form className="card" style={{ marginBottom: 12 }} onSubmit={e => { e.preventDefault(); act(async () => { await inviteOrgMember(id, email.trim(), inviteRole); setEmail('') }) }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Convidar alguém</div>
      <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="E-mail da conta" aria-label="E-mail da conta" />
      <select className="input" style={{ marginTop: 8 }} value={inviteRole} onChange={e => setInviteRole(e.target.value)} aria-label="Papel">
        {assignable.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </select>
      <div style={{ marginTop: 10 }}><Button variant="primary" type="submit" disabled={busy || !email.includes('@')}>Enviar convite</Button></div>
      <div className="dim small" style={{ marginTop: 6 }}>A pessoa precisa já ter uma conta e aceitar o convite.</div>
    </form>
    {!list && !err && <div className="muted small">Carregando…</div>}
    {list?.map(m => <div className="card" key={m.userId} style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{m.name || 'Sem nome'}</div>
          <div className="muted small" style={{ overflowWrap: 'anywhere' }}>{m.email}</div>
          <div className="small">{ROLE_LABEL[m.role]}{m.status === 'INVITED' ? ' · convite pendente' : ''}</div>
        </div>
        {manageable(m) && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {m.status === 'ACTIVE' && <select className="input" style={{ width: 'auto' }} value={m.role} disabled={busy} aria-label={'Papel de ' + (m.name || '')}
            onChange={e => act(() => changeOrgRole(id, m.userId, e.target.value))}>
            {assignable.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>}
          <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Remover ' + (m.name || 'esta pessoa') + ' da academia? O acesso dela termina agora.')) act(() => removeOrgMember(id, m.userId)) }}>Remover</Button>
        </div>}
      </div>
    </div>)}
  </>
}

function Settings({ id, onSaved }) {
  const [s, setS] = useState(null)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { orgSettings(id).then(setS).catch(e => setErr(errorText(e, 'Não foi possível carregar as configurações.'))) }, [id])
  if (err && !s) return <Err>{err}</Err>
  if (!s) return <div className="muted small">Carregando…</div>
  const set = (grp, k, v) => { setOk(false); setS(x => ({ ...x, [grp]: { ...x[grp], [k]: v } })) }
  const save = async e => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await saveOrgSettings(id, { brand: s.brand, ai: s.ai }); setOk(true); onSaved?.() } catch (x) { setErr(errorText(x, 'Não foi possível salvar.')) } finally { setBusy(false) }
  }
  const b = s.brand || {}
  const a = s.ai || {}
  return <form className="card" onSubmit={save}>
    <Err>{err}</Err>
    <label className="small muted" htmlFor="b-name">Nome exibido</label>
    <input id="b-name" className="input" maxLength={80} value={b.displayName || ''} onChange={e => set('brand', 'displayName', e.target.value)} />
    <label className="small muted" htmlFor="b-desc" style={{ display: 'block', marginTop: 10 }}>Descrição</label>
    <textarea id="b-desc" className="input" rows={3} maxLength={500} value={b.description || ''} onChange={e => set('brand', 'description', e.target.value)} />
    <label className="small muted" htmlFor="b-color" style={{ display: 'block', marginTop: 10 }}>Cor da academia</label>
    <input id="b-color" type="color" value={b.primaryColor || '#7c5cff'} onChange={e => set('brand', 'primaryColor', e.target.value)} aria-label="Cor da academia" />
    <label className="small muted" htmlFor="b-logo" style={{ display: 'block', marginTop: 10 }}>Endereço do logo (https)</label>
    <input id="b-logo" className="input" inputMode="url" value={b.logoUrl || ''} onChange={e => set('brand', 'logoUrl', e.target.value)} placeholder="https://…" />
    <label className="small muted" htmlFor="b-mail" style={{ display: 'block', marginTop: 10 }}>E-mail de contato</label>
    <input id="b-mail" className="input" type="email" value={b.contact?.email || ''} onChange={e => set('brand', 'contact', { ...(b.contact || {}), email: e.target.value })} />
    <label className="small muted" htmlFor="b-phone" style={{ display: 'block', marginTop: 10 }}>Telefone</label>
    <input id="b-phone" className="input" value={b.contact?.phone || ''} onChange={e => set('brand', 'contact', { ...(b.contact || {}), phone: e.target.value })} />
    <div style={{ fontWeight: 700, margin: '16px 0 6px' }}>Inteligência artificial</div>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={a.enabled !== false} onChange={e => set('ai', 'enabled', e.target.checked)} /> IA habilitada para esta academia</label>
    <label className="small muted" htmlFor="a-ins" style={{ display: 'block', marginTop: 10 }}>Instruções da academia para a IA</label>
    <textarea id="a-ins" className="input" rows={4} maxLength={2000} value={a.instructions || ''} onChange={e => set('ai', 'instructions', e.target.value)} placeholder="Ex.: Priorize treinos de até 50 minutos e exercícios com máquinas." />
    <label className="small muted" htmlFor="a-cap" style={{ display: 'block', marginTop: 10 }}>Limite mensal de mensagens de IA da academia (opcional)</label>
    <input id="a-cap" className="input" type="number" min={1} value={a.monthlyMessages || ''} onChange={e => set('ai', 'monthlyMessages', e.target.value === '' ? undefined : Number(e.target.value))} placeholder="Sem limite próprio" />
    <div className="dim small" style={{ marginTop: 6 }}>As instruções valem só para quem escolher usar a orientação desta academia na própria IA (veja a aba Visão geral). A plataforma tem um teto mensal; você pode apenas baixá-lo.</div>
    <div style={{ marginTop: 12 }}><Button variant="primary" type="submit" disabled={busy}>Salvar</Button>{ok && <span className="small" style={{ marginInlineStart: 10 }}>Salvo.</span>}</div>
  </form>
}

function Activity({ id }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { orgActivity(id).then(setRows).catch(e => setErr(errorText(e, 'Não foi possível carregar a atividade.'))) }, [id])
  if (err) return <Err>{err}</Err>
  if (!rows) return <div className="muted small">Carregando…</div>
  if (!rows.length) return <div className="card dim small">Nada por aqui ainda.</div>
  return rows.map(r => <div className="card" key={r.id} style={{ marginBottom: 8 }}>
    <div style={{ fontWeight: 600 }}>{ACTION_LABEL[r.action] || r.action}</div>
    <div className="muted small">{formatDateTime(r.at)}</div>
  </div>)
}

function AiUsage({ id }) {
  const [u, setU] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { orgAiUsage(id).then(setU).catch(e => setErr(errorText(e, 'Não foi possível carregar o consumo.'))) }, [id])
  if (err) return <Err>{err}</Err>
  if (!u) return <div className="muted small">Carregando…</div>
  const pct = Math.min(100, Math.round((u.messages / Math.max(1, u.cap)) * 100))
  return <>
    <div className="card">
      <div className="muted small">Mensagens de IA em {u.month}</div>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{u.messages} <span className="muted small">de {u.cap}</span></div>
      <div className="ff-meter" role="progressbar" aria-valuemin={0} aria-valuemax={u.cap} aria-valuenow={u.messages} aria-label="Mensagens de IA da academia no mês"><i style={{ width: pct + '%' }} /></div>
      <div className="small" style={{ marginTop: 8 }}>Tokens: {u.inputTokens} de entrada, {u.outputTokens} de saída</div>
      <div className="small">Custo estimado: {u.estimatedCostUsd === null ? 'indisponível (sem preços configurados)' : 'US$ ' + u.estimatedCostUsd.toFixed(2)}</div>
      {!u.enabled && <div className="small" style={{ marginTop: 6 }}>A IA está desligada para esta academia.</div>}
    </div>
    <div className="muted small" style={{ margin: '14px 4px 6px' }}>POR MEMBRO (SÓ CONTAGENS)</div>
    {u.members.length === 0 && <div className="card dim small">Ninguém usou a orientação da academia neste mês.</div>}
    {u.members.map(m => <div className="card" key={m.userId} style={{ marginBottom: 6 }}><div className="small"><b>{m.name || 'Membro'}</b>: {m.messages} mensagens</div></div>)}
    <div className="dim small" style={{ marginTop: 8 }}>A academia nunca vê o conteúdo das conversas nem os dados dos alunos.</div>
  </>
}

/** Escolha do usuário: usar ou não a orientação desta academia na própria IA. O espaço pessoal é o padrão. */
function AiChoice({ id }) {
  const [on, setOn] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { aiContext().then(c => setOn(c.tenantId === id)).catch(() => setOn(false)) }, [id])
  const toggle = async v => { setErr(null); try { await setAiContext(v ? id : null); setOn(v) } catch (e) { setErr(errorText(e, 'Não foi possível salvar.')) } }
  if (on === null) return null
  return <div className="card" style={{ marginTop: 16 }}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}><input type="checkbox" checked={on} onChange={e => toggle(e.target.checked)} /> Usar a orientação desta academia na minha IA</label>
    <div className="dim small" style={{ marginTop: 6 }}>Desligado, sua IA continua só com você. Ligado, as instruções de treino que a academia definiu entram como preferência. A academia não vê suas conversas nem seus dados; vê apenas quantas mensagens foram usadas.</div>
    <Err>{err}</Err>
  </div>
}

export function Gym() {
  const { id } = useParams()
  const nav = useNavigate()
  const [ctx, setCtx] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [stamp, setStamp] = useState(0)
  useEffect(() => {
    orgContexts().then(c => {
      const g = c.gyms.find(x => x.id === id && x.status === 'ACTIVE')
      if (!g) setError('Academia não encontrada.'); else setCtx(g)
    }).catch(e => setError(errorText(e, 'Não foi possível carregar a academia.')))
  }, [id, stamp])
  if (error) return <div className="page"><Header title="Academia" back="/academias" /><Err>{error}</Err></div>
  if (!ctx) return <div className="page"><Header title="Academia" back="/academias" /><div className="muted small">Carregando…</div></div>
  const tabs = [['dashboard', 'Visão geral'], ['members', 'Membros'], ['settings', 'Configurações'], ['activity', 'Atividade'], ['ai', 'Uso da IA']].filter(([k]) => SEES[ctx.role].includes(k))
  const active = tabs.some(([k]) => k === tab) ? tab : tabs[0]?.[0]
  const leave = async () => {
    if (!window.confirm('Sair desta academia? Você perde o acesso a ela.')) return
    try { await leaveOrg(id); nav('/academias') } catch (e) { setError(errorText(e, 'Não foi possível sair.')) }
  }
  return <div className="page">
    <Header title={ctx.name} sub={ROLE_LABEL[ctx.role]} back="/academias" />
    {tabs.length > 0 && <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={active === k} className={'btn ' + (active === k ? 'primary' : 'tinted')} onClick={() => setTab(k)}>{label}</button>)}
    </div>}
    {active === 'dashboard' && <Overview id={id} />}
    {active === 'members' && <Members id={id} role={ctx.role} />}
    {active === 'settings' && <Settings id={id} onSaved={() => setStamp(x => x + 1)} />}
    {active === 'activity' && <Activity id={id} />}
    {active === 'ai' && <AiUsage id={id} />}
    {tabs.length === 0 && <div className="card dim small">Você é aluno desta academia. Os recursos para alunos (treinos atribuídos e compartilhamento) chegam nas próximas fases.</div>}
    <AiChoice id={id} />
    <div style={{ marginTop: 24 }}><Button variant="tinted" onClick={leave}>Sair desta academia</Button></div>
  </div>
}
