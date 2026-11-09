// O cartão do plano (Início) e a faixa de consumo da IA (conversa com a CorpoFit AI). Só aparecem em
// SAAS_MODE; mostram o que o servidor diz e nunca decidem acesso.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import { useStore } from '../store/useStore.js'
import { emailVerification, getAiUsage, getBilling, listNotifications } from './api.js'
import { BRAND, formatDate, saasOn } from './brand.js'

export function PlanCard() {
  const nav = useNavigate()
  const on = useStore(s => saasOn(s.config))
  const user = useStore(s => s.user)
  const coachOn = useStore(s => !!s.config?.coach?.enabled)
  const [info, setInfo] = useState(null)
  const [alerts, setAlerts] = useState({ unread: 0, unverified: false })
  useEffect(() => {
    if (!on || !user) return
    Promise.all([listNotifications().catch(() => null), emailVerification().catch(() => null)]).then(([n, v]) => setAlerts({ unread: n?.unread || 0, unverified: !!(v && v.email && !v.verified) }))
  }, [on, user?.id])
  useEffect(() => {
    if (!on || !user) return
    let alive = true
    Promise.all([getBilling(), getAiUsage()]).then(([b, ai]) => { if (alive) setInfo({ b, ai }) }).catch(() => {})
    return () => { alive = false }
  }, [on, user?.id])
  if (!on || !user || !info) return null
  const { b, ai } = info
  const pct = Math.min(100, Math.round((ai.used / Math.max(1, ai.limit)) * 100))
  return <div className="card" style={{ marginBottom: 12 }}>
    {(alerts.unread > 0 || alerts.unverified) && <button className="btn tinted" onClick={() => nav('/notificacoes')} style={{ width: '100%', marginBottom: 10, minHeight: 40, borderRadius: 12 }}>
      {alerts.unread > 0 ? `${alerts.unread} notificação(ões) nova(s)` : 'Confirme seu e-mail'}{alerts.unread > 0 && alerts.unverified ? ' · confirme seu e-mail' : ''}
    </button>}
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
      <div><div className="muted small">Seu plano</div><div style={{ fontSize: 18, fontWeight: 700 }}>{b.plan.name}</div></div>
      <button className="btn tinted" onClick={() => nav(b.plan.isPremium ? '/assinatura' : '/checkout')} style={{ minHeight: 40, padding: '0 14px', borderRadius: 12 }}>
        {b.plan.isPremium ? 'Gerenciar' : 'Assinar Premium'}
      </button>
    </div>
    {coachOn
      ? <button className="btn" onClick={() => nav('/coach')} style={{ width: '100%', marginTop: 12, minHeight: 44, borderRadius: 12 }}>Conversar com a {BRAND.aiName}</button>
      : <div className="dim small" style={{ marginTop: 10 }}>A {BRAND.aiName} ainda não foi ativada neste servidor.</div>}
    <div className="small muted" style={{ marginTop: 10 }}>{BRAND.aiName}: {ai.used} de {ai.limit} mensagens neste mês</div>
    <div className="ff-meter" role="progressbar" aria-valuemin={0} aria-valuemax={ai.limit} aria-valuenow={ai.used} aria-label="Mensagens da IA no mês"><i style={{ width: pct + '%' }} /></div>
    {b.subscription?.status === 'PAST_DUE' && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>Cobrança vencida. Regularize até {formatDate(b.subscription.graceUntil)}.</div>}
    {!b.plan.isPremium && <div className="dim small" style={{ marginTop: 8 }}>No Premium: mais mensagens, análises completas e comparação de períodos.</div>}
  </div>
}

/** Uma linha de consumo, para o topo do chat. O limite em si é aplicado no servidor. */
export function AiUsageLine() {
  const on = useStore(s => saasOn(s.config))
  const user = useStore(s => s.user)
  const [ai, setAi] = useState(null)
  useEffect(() => { if (on && user) getAiUsage().then(setAi).catch(() => {}) }, [on, user?.id])
  if (!on || !ai) return null
  const left = Math.max(0, ai.limit - ai.used)
  return <div className="dim small" style={{ textAlign: 'center', margin: '4px 0' }}>
    {left > 0 ? `${left} de ${ai.limit} mensagens restantes neste mês` : <>Você usou todas as mensagens do mês. <a href="#/assinatura">Ver planos</a></>}
  </div>
}
