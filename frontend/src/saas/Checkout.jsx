// Contratação do Premium: resumo (nome, valor, periodicidade), forma de pagamento e retorno do
// pagamento. O preço NUNCA é enviado: o servidor usa o do plano. Cartão leva à página segura do
// Asaas e volta para /checkout/sucesso|cancelado|expirado; Pix mostra o QR Code aqui mesmo.
// O Premium só aparece depois que o servidor confirma o pagamento (webhook), nunca pelo retorno.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { errorText, getBilling, getPlans, startCheckout } from './api.js'
import { BRAND, formatBRL } from './brand.js'

const COPY = {
  sucesso: { title: 'Recebemos o seu retorno', text: 'Estamos aguardando a confirmação do pagamento pelo Asaas. O Premium é liberado automaticamente assim que ela chegar.' },
  cancelado: { title: 'Pagamento cancelado', text: 'Nenhuma cobrança foi feita. Você pode tentar de novo quando quiser.' },
  expirado: { title: 'Link de pagamento expirado', text: 'O tempo para pagar acabou. Inicie uma nova contratação.' }
}

function Header({ title }) {
  const nav = useNavigate()
  return <div className="hdr">
    <button className="iconbtn" data-back="/assinatura" onClick={() => nav('/assinatura')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{title}</h1></div>
  </div>
}

export function CheckoutResult() {
  const { status } = useParams()
  const nav = useNavigate()
  const c = COPY[status] || COPY.sucesso
  const [premium, setPremium] = useState(false)
  useEffect(() => {
    if (status !== 'sucesso') return
    let alive = true
    const tick = () => getBilling().then(b => { if (alive && b.plan.isPremium) setPremium(true) }).catch(() => {})
    tick()
    const id = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(id) }
  }, [status])
  return <>
    <Header title={premium ? 'Premium ativo! 🎉' : c.title} />
    <div className="card small" role="status">{premium ? 'Pagamento confirmado. Aproveite os recursos Premium.' : c.text}</div>
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <Button variant="primary" onClick={() => nav('/assinatura')}>Ver assinatura</Button>
      <Button onClick={() => nav('/home')}>Ir ao início</Button>
    </div>
  </>
}

export default function Checkout() {
  const nav = useNavigate()
  const [plan, setPlan] = useState(null)
  const [billing, setBilling] = useState(null)
  const [method, setMethod] = useState(null)
  const [doc, setDoc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const [paid, setPaid] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    getPlans().then(d => setPlan(d.plans.find(p => p.code === 'PREMIUM'))).catch(() => setErr('Não foi possível carregar o plano.'))
    getBilling().then(b => { setBilling(b); setMethod(m => m || b.methods[0]?.id || null) }).catch(e => setErr(errorText(e)))
  }, [])

  // Com o QR Code na tela, consulta o servidor: o Premium só chega quando o pagamento for confirmado.
  useEffect(() => {
    if (!result || result.kind === 'redirect') return
    timer.current = setInterval(() => getBilling().then(b => {
      if (b.plan.isPremium) { setPaid(true); clearInterval(timer.current); setTimeout(() => nav('/checkout/sucesso'), 1200) }
    }).catch(() => {}), 5000)
    return () => clearInterval(timer.current)
  }, [result, nav])

  if (!plan || !billing) return <><Header title="Assinar Premium" />{err ? <div className="card small" role="alert">{err}</div> : <div className="muted">Carregando…</div>}</>

  if (billing.plan.isPremium && billing.plan.source === 'subscription') {
    return <><Header title="Assinar Premium" /><div className="card small">Você já é Premium. <a href="#/assinatura">Gerenciar assinatura</a></div></>
  }
  if (billing.methods.length === 0) {
    return <><Header title="Assinar Premium" /><div className="card small">Os pagamentos ainda não estão disponíveis nesta instalação (integração com o Asaas não configurada).</div></>
  }

  const start = async e => {
    e.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const r = await startCheckout(method, doc)
      if (r.kind === 'redirect') window.location.assign(r.url)
      else setResult(r)
    } catch (ex) { setErr(errorText(ex, 'Não foi possível iniciar o pagamento.')) }
    finally { setBusy(false) }
  }

  if (result && result.kind !== 'redirect') {
    const auto = result.kind === 'pix_automatic'
    return <>
      <Header title={auto ? 'Autorize o Pix Automático' : 'Pague com Pix'} />
      <div className="card" style={{ textAlign: 'center' }}>
        {paid ? <div className="small" role="status">Pagamento confirmado! Liberando o Premium…</div> : <>
          <p className="small muted">{auto
            ? 'Escaneie o QR Code no app do seu banco para pagar a primeira cobrança e autorizar os débitos mensais. O Premium é liberado quando o pagamento e a autorização forem confirmados.'
            : 'Escaneie o QR Code ou use o Pix Copia e Cola. É um pagamento mensal: você receberá uma nova cobrança a cada mês e precisará pagá-la.'}</p>
          {result.image && <img className="ff-qr" alt="QR Code Pix" src={`data:image/png;base64,${result.image}`} />}
          <Button onClick={async () => { await navigator.clipboard.writeText(result.payload); setCopied(true) }}>{copied ? 'Código copiado!' : 'Copiar código Pix'}</Button>
          {result.dueDate && <p className="dim small">Vencimento: {new Date(`${result.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}</p>}
          <p className="dim small" aria-live="polite">Aguardando a confirmação do pagamento. Esta tela atualiza sozinha.</p>
        </>}
      </div>
    </>
  }

  return <>
    <Header title="Assinar Premium" />
    <form onSubmit={start} noValidate>
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>{BRAND.name} {plan.name}</div>
        <ul className="small" style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>{plan.highlights.map(h => <li key={h}>{h}</li>)}</ul>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
        <legend className="small muted" style={{ marginBottom: 6 }}>Forma de pagamento</legend>
        {billing.methods.map(m => <label key={m.id} className="card" style={{ display: 'flex', gap: 10, marginBottom: 8, cursor: 'pointer', outline: method === m.id ? '2px solid var(--acc)' : 'none' }}>
          <input type="radio" name="method" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} style={{ marginTop: 3 }} />
          <span><strong>{m.label}</strong><span className="small muted" style={{ display: 'block' }}>{m.description}</span></span>
        </label>)}
      </fieldset>
      <label className="small muted" htmlFor="cpf">CPF ou CNPJ do pagador</label>
      <input id="cpf" className="input" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={doc} onChange={e => setDoc(e.target.value)} />
      <div className="dim small" style={{ margin: '4px 0 12px' }}>Exigido pelo processador de pagamentos. Guardamos apenas os 4 últimos dígitos.</div>
      <div className="card small" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Plano</span><strong>{plan.name}</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Valor</span><strong>{formatBRL(plan.priceCents)} / mês</strong></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Cobrança</span><span>Recorrente mensal</span></div>
        <div className="dim" style={{ marginTop: 8 }}>Cancele quando quiser em Assinatura; você mantém o Premium até o fim do período pago. O pagamento é processado pelo Asaas, e o nome dele pode aparecer na fatura ou no extrato.</div>
      </div>
      {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
      <Button type="submit" variant="primary" disabled={busy || !method}>{busy ? 'Aguarde…' : method === 'CREDIT_CARD' ? 'Continuar para o pagamento seguro' : 'Gerar QR Code'}</Button>
    </form>
  </>
}
