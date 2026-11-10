// "Minha academia" (app do aluno): matrícula, plano, mensalidades, o QR de acesso e os aparelhos numerados da academia.
// O aluno só vê o que é dele. A foto de acesso (reconhecimento facial) ele pode retirar do consentimento quando quiser.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import QrCanvas from '../components/QrCanvas.jsx'
import { Button } from '../components/ui.jsx'
import { errorText, gymEquipment, myGym, revokeMyFace } from './api.js'
import { formatDate, formatDateTime } from './brand.js'

const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const STATUS = { ENROLLED: 'Matriculado', ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', CANCELLED: 'Cancelado' }
const EQ = { ACTIVE: 'Em uso', MAINTENANCE: 'Em manutenção', RETIRED: 'Desativado' }
const Section = ({ children }) => <div className="muted small" style={{ margin: '18px 4px 6px', letterSpacing: '.04em' }}>{children}</div>

function GymCard({ g, reload }) {
  const [eq, setEq] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)
  useEffect(() => { gymEquipment(g.gymId).then(setEq).catch(() => setEq([])) }, [g.gymId])
  const found = (eq || []).filter(e => !q || (e.name + ' ' + e.category + ' ' + e.muscles.join(' ')).toLowerCase().includes(q.toLowerCase()) || String(e.number) === q.trim())
  return <>
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><b style={{ fontSize: 17 }}>{g.gym}</b><span className="small">{STATUS[g.status]}</span></div>
      <div className="muted small">Matrícula nº {g.number}{g.plan ? ` · ${g.plan.name} · ${brl(g.plan.priceCents)}/mês, vence todo dia ${g.billingDay}` : ''}</div>
      <div className="small" style={{ marginTop: 6, color: g.access.allowed ? 'var(--green, #30d158)' : 'var(--red, #ff453a)' }}>{g.access.allowed ? '✓ ' : '✕ '}{g.access.label}</div>
      <div style={{ display: 'grid', placeItems: 'center', margin: '12px 0 2px' }}><QrCanvas value={g.accessCode} size={176} /></div>
      <div className="dim small" style={{ textAlign: 'center' }}>Mostre este QR na catraca. Não compartilhe: ele é só seu.</div>
    </div>
    <Section>MENSALIDADES</Section>
    {g.charges.length === 0 && <div className="card dim small">Nenhuma mensalidade ainda.</div>}
    {g.charges.map(c => <div className="card" key={c.id} style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <div><div style={{ fontWeight: 600 }}>{c.description}</div><div className="muted small">Vence em {formatDate(c.dueDate + 'T12:00:00')}</div></div>
      <div style={{ textAlign: 'end' }}><div>{brl(c.amountCents)}</div><div className="small" style={{ color: c.status === 'PAID' ? 'var(--green, #30d158)' : c.overdue ? 'var(--red, #ff453a)' : undefined }}>{c.status === 'PAID' ? 'Pago' : c.status === 'CANCELLED' ? 'Cancelada' : c.overdue ? 'Em atraso' : 'A vencer'}</div></div>
    </div>)}
    <div className="dim small" style={{ margin: '6px 4px' }}>O pagamento é feito na recepção da academia (dinheiro, Pix ou cartão na maquininha) e registrado por ela.</div>
    <Section>APARELHOS DA ACADEMIA</Section>
    <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por número, nome ou músculo" aria-label="Buscar aparelho" />
    {eq && found.length === 0 && <div className="card dim small" style={{ marginTop: 8 }}>{eq.length === 0 ? 'A academia ainda não cadastrou os aparelhos.' : 'Nenhum aparelho encontrado.'}</div>}
    {found.map(e => <div className="card" key={e.id} style={{ marginTop: 6, opacity: e.status === 'ACTIVE' ? 1 : .6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>Aparelho {e.number} · {e.name}</b><span className="small">{EQ[e.status]}</span></div>
      <div className="muted small">{[e.category, e.muscles.join(', '), e.location].filter(Boolean).join(' · ')}</div>
    </div>)}
    <Section>PRIVACIDADE</Section>
    <div className="card small">
      {g.faceConsentAt ? <>
        <div>Você autorizou a foto de acesso para reconhecimento facial em {formatDateTime(g.faceConsentAt)}.</div>
        <div className="dim" style={{ margin: '4px 0 8px' }}>Você pode retirar o consentimento a qualquer momento. A foto é apagada e você passa a entrar pelo QR.</div>
        {err && <div role="alert" style={{ color: 'var(--red)' }}>{err}</div>}
        <Button variant="tinted" onClick={() => { if (window.confirm('Retirar o consentimento e apagar a foto de acesso?')) revokeMyFace(g.gymId).then(reload).catch(x => setErr(errorText(x, 'Não foi possível retirar.'))) }}>Retirar consentimento e apagar a foto</Button>
      </> : <div>Você não tem foto de acesso cadastrada. Sem ela, a entrada é pelo QR.</div>}
      <div className="dim" style={{ marginTop: 8 }}>{g.trainingConsentAt ? 'Você autorizou os professores da academia a acompanhar o seu treino.' : 'Os professores só acompanham o seu treino se você autorizar.'}</div>
    </div>
  </>
}

export default function MyGym() {
  const nav = useNavigate()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(() => myGym().then(setList).catch(e => setError(errorText(e, 'Não foi possível carregar.'))), [])
  useEffect(() => { load() }, [load])
  return <div className="page">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Minha academia</h1><div className="sub">Plano, mensalidades, acesso e aparelhos</div></div>
    </div>
    {error && <div className="small" role="alert" style={{ color: 'var(--red)' }}>{error}</div>}
    {!list && !error && <div className="muted small">Carregando…</div>}
    {list?.length === 0 && <div className="card small">Você ainda não está matriculado em uma academia por aqui. Quando a recepção da sua academia fizer sua matrícula com o seu e-mail, ela aparece nesta tela depois que você entrar e confirmar o e-mail.</div>}
    {list?.map(g => <GymCard key={g.gymId} g={g} reload={load} />)}
  </div>
}
