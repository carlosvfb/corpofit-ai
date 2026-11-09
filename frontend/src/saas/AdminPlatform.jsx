// Painel da plataforma (só admin): as academias, com plano e contagens, e a fila de moderação da biblioteca.
// Nada do conteúdo das academias aparece aqui; o servidor confere que quem chama é o admin.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { adminGyms, errorText, moderateItem, moderationQueuePlatform } from './api.js'
import { formatDate } from './brand.js'

const REASON = { INAPPROPRIATE: 'Conteúdo inadequado', COPYRIGHT: 'Direitos autorais', PERSONAL_DATA: 'Dados pessoais', SPAM: 'Spam', OTHER: 'Outro motivo' }
const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null

function Gyms() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { adminGyms().then(setRows).catch(e => setErr(errorText(e, 'Não foi possível carregar as academias.'))) }, [])
  if (err) return <Err>{err}</Err>
  if (!rows) return <div className="muted small">Carregando…</div>
  if (!rows.length) return <div className="card dim small">Nenhuma academia criada ainda.</div>
  return rows.map(g => <div className="card" key={g.id} style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ overflowWrap: 'anywhere' }}>{g.name}</b><span className="muted small">{g.plan}{g.paid ? ' (pago)' : ''}</span></div>
    <div className="muted small">{g.members} membros ativos · {g.invited} convites · criada em {formatDate(g.createdAt)}{g.status !== 'ACTIVE' ? ' · ' + g.status : ''}</div>
  </div>)
}

function Moderation() {
  const [queue, setQueue] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => moderationQueuePlatform().then(setQueue).catch(e => setErr(errorText(e, 'Não foi possível carregar a fila.'))), [])
  useEffect(() => { load() }, [load])
  const act = async (id, action) => { setErr(null); try { await moderateItem(id, action, undefined, 'platform'); await load() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } }
  return <>
    <Err>{err}</Err>
    {queue && queue.length === 0 && <div className="card dim small">Nenhuma denúncia aberta.</div>}
    {queue?.map(i => <div className="card" key={i.id} style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{i.title}</div>
      <div className="muted small">{i.kind} · por {i.author} · {i.status === 'HIDDEN' ? 'oculto' : 'publicado'}{i.visibility === 'GYM' ? ' · conteúdo de academia' : ''}</div>
      {i.reports.map(r => <div key={r.id} className="small" style={{ marginTop: 4 }}>{REASON[r.reason] || r.reason}{r.note ? ': ' + r.note : ''}</div>)}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {i.status === 'PUBLISHED' && <Button variant="primary" onClick={() => act(i.id, 'hide')}>Ocultar</Button>}
        {i.status === 'HIDDEN' && <Button variant="primary" onClick={() => act(i.id, 'restore')}>Restaurar</Button>}
        <Button variant="tinted" onClick={() => act(i.id, 'dismiss')}>Ignorar denúncias</Button>
      </div>
    </div>)}
  </>
}

export default function AdminPlatform() {
  const nav = useNavigate()
  const [tab, setTab] = useState('gyms')
  return <div className="page">
    <div className="hdr">
      <button className="iconbtn" data-back="/admin" onClick={() => nav('/admin')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Plataforma</h1><div className="sub">Academias e moderação da biblioteca</div></div>
    </div>
    <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
      {[['gyms', 'Academias'], ['moderation', 'Moderação']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={'btn ' + (tab === k ? 'primary' : 'tinted')} onClick={() => setTab(k)} style={{ width: 'auto', minHeight: 40, padding: '0 14px' }}>{l}</button>)}
    </div>
    {tab === 'gyms' ? <Gyms /> : <Moderation />}
  </div>
}
