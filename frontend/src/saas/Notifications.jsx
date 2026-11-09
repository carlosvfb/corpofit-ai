// Notificações dentro do app e confirmação do e-mail da conta (o código de 6 dígitos também libera os
// convites feitos ao seu e-mail antes de você ter conta).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { confirmEmailCode, emailVerification, errorText, listNotifications, markNotificationsRead, sendEmailCode } from './api.js'
import { formatDateTime } from './brand.js'

const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null

function EmailBox() {
  const [st, setSt] = useState(null)
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { emailVerification().then(setSt).catch(() => setSt(null)) }, [])
  if (!st) return null
  if (st.verified) return <div className="card dim small" style={{ marginBottom: 12 }}>E-mail confirmado: {st.email}</div>
  const run = async fn => { setBusy(true); setErr(null); setNotice(null); try { await fn() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  return <div className="card" style={{ marginBottom: 12 }}>
    <div style={{ fontWeight: 700 }}>Confirme seu e-mail</div>
    <div className="muted small">{st.email ? `Vamos enviar um código para ${st.email}.` : 'Sua conta não tem e-mail.'} Confirmar libera convites feitos a você antes de ter conta.</div>
    <Err>{err}</Err>
    {notice && <div className="small" role="status" style={{ marginTop: 6 }}>{notice}</div>}
    {st.email && <div style={{ marginTop: 8 }}><Button variant="tinted" disabled={busy} onClick={() => run(async () => { await sendEmailCode(); setSent(true); setNotice('Código enviado. Confira sua caixa de entrada.') })}>{sent ? 'Enviar outro código' : 'Enviar código'}</Button></div>}
    {sent && <form style={{ display: 'flex', gap: 6, marginTop: 8 }} onSubmit={e => { e.preventDefault(); run(async () => { const r = await confirmEmailCode(code.trim()); setSt({ ...st, verified: true }); setNotice(r.invitesClaimed ? `E-mail confirmado. ${r.invitesClaimed} convite(s) liberado(s) em Academias.` : 'E-mail confirmado.') }) }}>
      <input className="input" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Código de 6 números" aria-label="Código de 6 números" />
      <Button type="submit" variant="primary" disabled={busy || code.length !== 6}>Confirmar</Button>
    </form>}
  </div>
}

export default function Notifications() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(() => listNotifications().then(setData).catch(e => setError(errorText(e, 'Não foi possível carregar as notificações.'))), [])
  useEffect(() => { load() }, [load])
  const open = async n => { if (!n.read) { await markNotificationsRead([n.id]).catch(() => {}) } if (n.link) nav(n.link); else load() }
  return <div className="page">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Notificações</h1><div className="sub">Convites, treinos, comentários e mudanças de compartilhamento</div></div>
    </div>
    <Err>{error}</Err>
    <EmailBox />
    {!data && !error && <div className="muted small">Carregando…</div>}
    {data && data.items.length === 0 && <div className="card dim small">Nenhuma notificação por enquanto.</div>}
    {data && data.unread > 0 && <div style={{ margin: '0 0 8px' }}><Button variant="tinted" onClick={async () => { await markNotificationsRead('all'); load() }}>Marcar todas como lidas</Button></div>}
    {data?.items.map(n => <button key={n.id} className="card" onClick={() => open(n)} style={{ width: '100%', textAlign: 'start', marginBottom: 8, cursor: 'pointer', opacity: n.read ? 0.7 : 1 }}>
      <div style={{ fontWeight: n.read ? 500 : 700, overflowWrap: 'anywhere' }}>{!n.read && <span aria-label="não lida">● </span>}{n.title}</div>
      {n.body && <div className="small" style={{ overflowWrap: 'anywhere' }}>{n.body}</div>}
      <div className="muted small">{formatDateTime(n.at)}</div>
    </button>)}
  </div>
}
