// Assinatura: plano atual, forma de pagamento, status, próxima cobrança, histórico de cobranças e
// cancelamento. Tudo vem do servidor (GET /api/billing/status); nada aqui decide acesso ou preço.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { cancelSubscription, errorText, getBilling, getPixQr } from './api.js'
import { BRAND, formatBRL, formatDate } from './brand.js'

export const METHOD_LABEL = { CREDIT_CARD: 'Cartão de crédito', PIX_AUTOMATIC: 'Pix Automático', PIX: 'Pix (pagamento mensal)' }
const SUB_LABEL = { PENDING: 'Aguardando pagamento', ACTIVE: 'Ativa', PAST_DUE: 'Pagamento em atraso', CANCELED: 'Cancelada', EXPIRED: 'Expirada', SUSPENDED: 'Suspensa' }
const PAY_LABEL = { PENDING: 'Pendente', CONFIRMED: 'Confirmado', RECEIVED: 'Recebido', OVERDUE: 'Vencido', REFUNDED: 'Estornado', REFUSED: 'Recusado', CANCELED: 'Cancelado' }

function Header({ title, sub, back = '/settings' }) {
  const nav = useNavigate()
  return <div className="hdr">
    <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label="Voltar"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
  </div>
}

function PixCharge({ paymentId }) {
  const [qr, setQr] = useState(null)
  const [err, setErr] = useState(null)
  const [copied, setCopied] = useState(false)
  if (qr) return <div>
    <img className="ff-qr" alt="QR Code Pix" src={`data:image/png;base64,${qr.image}`} />
    <Button onClick={async () => { await navigator.clipboard.writeText(qr.payload); setCopied(true) }}>{copied ? 'Código copiado!' : 'Copiar código Pix'}</Button>
  </div>
  return <div>
    {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginBottom: 6 }}>{err}</div>}
    <Button variant="tinted" onClick={async () => { setErr(null); try { setQr(await getPixQr(paymentId)) } catch (e) { setErr(errorText(e, 'Não foi possível gerar o QR Code.')) } }}>Pagar com Pix</Button>
  </div>
}

export default function Subscription() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const load = useCallback(() => getBilling().then(setData).catch(e => setError(errorText(e, 'Não foi possível carregar a assinatura.'))), [])
  useEffect(() => { load() }, [load])

  if (error) return <><Header title="Assinatura" /><div className="card small" role="alert">{error}</div></>
  if (!data) return <><Header title="Assinatura" /><div className="muted">Carregando…</div></>

  const sub = data.subscription
  const live = sub && ['ACTIVE', 'PAST_DUE'].includes(sub.status)
  const pending = sub?.status === 'PENDING'
  const cancel = async () => {
    if (!window.confirm('Cancelar a assinatura? Você mantém o Premium até o fim do período já pago.')) return
    setBusy(true); setNotice(null)
    try { await cancelSubscription(); setNotice('Assinatura cancelada. Seu acesso segue até o fim do período pago.'); await load() }
    catch (e) { setNotice(errorText(e, 'Não foi possível cancelar agora.')) }
    finally { setBusy(false) }
  }

  return <>
    <Header title="Assinatura" sub={`Plano ${data.plan.name}`} />
    {notice && <div className="card small" role="status" style={{ marginBottom: 12 }}>{notice}</div>}
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><div className="muted small">Plano</div><div style={{ fontSize: 20, fontWeight: 700 }}>{data.plan.name}</div>
          {data.plan.source === 'manual' && <div className="dim small">Acesso concedido pela equipe do {BRAND.name}.</div>}</div>
        {!data.plan.isPremium && !pending && <Button variant="primary" onClick={() => nav('/checkout')}>Assinar Premium</Button>}
      </div>
      {sub && <dl className="small" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, margin: '14px 0 0' }}>
        <div><dt className="muted">Status</dt><dd style={{ margin: 0 }}>{SUB_LABEL[sub.status]}</dd></div>
        <div><dt className="muted">Forma de pagamento</dt><dd style={{ margin: 0 }}>{METHOD_LABEL[sub.paymentMethod]}</dd></div>
        <div><dt className="muted">Valor</dt><dd style={{ margin: 0 }}>{formatBRL(data.premiumPriceCents)} / mês</dd></div>
        <div><dt className="muted">{sub.status === 'CANCELED' ? 'Acesso até' : 'Período pago até'}</dt><dd style={{ margin: 0 }}>{formatDate(sub.currentPeriodEnd)}</dd></div>
        {data.nextCharge && <div><dt className="muted">Próxima cobrança</dt><dd style={{ margin: 0 }}>{formatDate(data.nextCharge.dueDate)} · {formatBRL(data.nextCharge.valueCents)}</dd></div>}
        {sub.status === 'PAST_DUE' && <div><dt className="muted">Regularizar até</dt><dd style={{ margin: 0 }}>{formatDate(sub.graceUntil)}</dd></div>}
      </dl>}
      {pending && <div className="small" style={{ marginTop: 12 }}>Seu pagamento ainda não foi confirmado. O Premium é liberado assim que o pagamento for confirmado. <a href="#/checkout">Retomar pagamento</a></div>}
      {sub?.status === 'PAST_DUE' && <div className="small" style={{ marginTop: 12, color: 'var(--red)' }}>Há uma cobrança vencida. Regularize para manter o Premium.</div>}
      {sub?.status === 'SUSPENDED' && <div className="small" style={{ marginTop: 12, color: 'var(--red)' }}>Assinatura suspensa por estorno ou contestação. Fale com o suporte.</div>}
      {sub?.status === 'CANCELED' && sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > new Date() && <div className="small" style={{ marginTop: 12 }}>Assinatura cancelada. Você mantém o Premium até {formatDate(sub.currentPeriodEnd)}.</div>}
      {(live || pending) && <div style={{ marginTop: 14 }}><Button variant="destructive" disabled={busy} onClick={cancel}>{busy ? 'Cancelando…' : 'Cancelar assinatura'}</Button></div>}
    </div>

    <div className="card">
      <h3 style={{ margin: '0 0 8px' }}>Histórico de cobranças</h3>
      {data.payments.length === 0 ? <div className="muted small">Nenhuma cobrança ainda.</div> : data.payments.map(p => <div key={p.id} style={{ padding: '10px 0', borderTop: '1px solid var(--sep, rgba(128,128,128,.2))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }} className="small">
          <span>{formatDate(p.dueDate)} · {formatBRL(p.valueCents)} · {METHOD_LABEL[p.method]}</span><strong>{PAY_LABEL[p.status]}</strong>
        </div>
        {p.method === 'PIX' && ['PENDING', 'OVERDUE'].includes(p.status) && <div style={{ marginTop: 8 }}><PixCharge paymentId={p.id} /></div>}
        {p.invoiceUrl && <a className="small" href={p.invoiceUrl} target="_blank" rel="noopener noreferrer">Ver fatura</a>}
      </div>)}
    </div>
    <div className="dim small" style={{ marginTop: 12 }}>Cancelar não apaga o histórico financeiro. Pagamentos processados pelo Asaas.</div>
  </>
}
