// Painel financeiro do CorpoFit AI (somente admin; o servidor valida de novo): indicadores, assinaturas,
// cobranças, eventos do webhook, erros de integração, usuários Premium, consumo da IA e configurações.
// Ações: conceder/revogar Premium (com motivo, auditado), tolerância de atraso, Pix Automático e
// reconciliação com o Asaas. Nada aqui altera uma cobrança "na mão".
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { adminFinance, adminOverview, adminPremium, adminReconcile, adminSettings, errorText } from './api.js'
import { formatBRL, formatDate, formatDateTime, saasOn } from './brand.js'

/** Entrada no painel do openGym: só existe em SAAS_MODE. */
export function SaasAdminLink() {
  const nav = useNavigate()
  const on = useStore(s => saasOn(s.config))
  if (!on) return null
  return <div className="card" style={{ marginBottom: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div><h2 style={{ margin: 0 }}>Financeiro e IA</h2><div className="small muted">Assinaturas, cobranças, webhooks, Premium manual e consumo da IA.</div></div>
      <Button variant="primary" onClick={() => nav('/admin/financeiro')}>Abrir</Button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
      <div><h2 style={{ margin: 0 }}>Academias e moderação</h2><div className="small muted">As academias, seus planos e a fila de denúncias da biblioteca.</div></div>
      <Button variant="primary" onClick={() => nav('/plataforma')}>Abrir o portal da plataforma</Button>
    </div>
  </div>
}

function Tile({ label, value }) {
  return <div className="tile"><div className="l">{label}</div><div className="v">{value}</div></div>
}

function Table({ head, rows, empty }) {
  if (!rows.length) return <div className="muted small">{empty}</div>
  return <div className="ff-scroll"><table className="ff-table"><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
}

export default function AdminFinance() {
  const nav = useNavigate()
  const [ov, setOv] = useState(null)
  const [fin, setFin] = useState(null)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const load = useCallback(async () => {
    try { const [a, b] = await Promise.all([adminOverview(), adminFinance()]); setOv(a); setFin(b); setErr(null) }
    catch (e) { setErr(errorText(e, 'Não foi possível carregar o painel.')) }
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (fn, ok) => {
    setMsg(null)
    try { await fn(); setMsg(ok); await load() } catch (e) { setMsg(errorText(e)) }
  }
  const grant = userId => {
    const reason = window.prompt('Motivo da concessão (obrigatório):')
    if (!reason || reason.trim().length < 3) return
    const d = window.prompt('Quantos dias de Premium? (vazio = sem prazo)')
    const days = d ? Math.floor(Number(d)) : null
    if (d && !(days >= 1)) { setMsg('Dias inválidos.'); return }
    run(() => adminPremium({ userId, action: 'grant', days, reason: reason.trim() }), 'Premium concedido.')
  }
  const revoke = userId => {
    const reason = window.prompt('Motivo da revogação (obrigatório):')
    if (!reason || reason.trim().length < 3) return
    run(() => adminPremium({ userId, action: 'revoke', reason: reason.trim() }), 'Premium manual revogado.')
  }

  const Head = <div className="hdr">
    <button className="iconbtn" data-back="/admin" onClick={() => nav('/admin')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 12 }}><h1 style={{ margin: 0 }}>Financeiro e IA</h1><div className="sub">Somente administradores</div></div>
    <button className="iconbtn" onClick={load} aria-label="Atualizar">↻</button>
  </div>
  if (err) return <div className="narrow">{Head}<div className="card small" role="alert">{err}</div></div>
  if (!ov || !fin) return <div className="narrow">{Head}<div className="muted">Carregando…</div></div>

  const o = ov.overview
  return <div className="narrow">
    {Head}
    {msg && <div className="card small" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
    <div className="tiles" style={{ marginBottom: 12 }}>
      <Tile label="Usuários" value={o.users} />
      <Tile label="Assinaturas ativas ou em atraso" value={o.premiumSubs} />
      <Tile label="Cobranças pendentes" value={o.pending} />
      <Tile label="Cobranças vencidas" value={o.overdue} />
      <Tile label="Mensagens de IA no mês" value={o.ai.messages} />
      <Tile label="Eventos com falha / erros 24h" value={`${o.failedEvents} / ${o.errors24h}`} />
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Configurações</h2>
      <label className="small muted" htmlFor="grace">Tolerância para cobrança vencida (dias)</label>
      <div style={{ display: 'flex', gap: 8, margin: '4px 0 12px' }}>
        <input id="grace" className="input" type="number" min="0" max="30" defaultValue={ov.settings.graceDays} style={{ maxWidth: 110 }}
          onBlur={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== ov.settings.graceDays) run(() => adminSettings({ graceDays: v }), 'Tolerância atualizada.') }} />
      </div>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" checked={ov.settings.pixAutomaticEnabled} style={{ marginTop: 3 }}
          onChange={e => run(() => adminSettings({ pixAutomaticEnabled: e.target.checked }), e.target.checked ? 'Pix Automático ligado.' : 'Pix Automático desligado.')} />
        <span>Oferecer Pix Automático no checkout<span className="dim" style={{ display: 'block' }}>Ligue apenas depois de confirmar com o Asaas que a conta está habilitada.</span></span>
      </label>
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Assinaturas</h2>
      <Table empty="Nenhuma assinatura ainda." head={['Usuário', 'Status', 'Forma', 'Período até', 'IDs Asaas', '']}
        rows={fin.subscriptions.map(s => [
          <span key="u">{s.user?.name}<br /><span className="dim">{s.user?.email}</span></span>, s.status, s.paymentMethod, formatDate(s.currentPeriodEnd),
          <span key="i" className="ff-mono">{[s.asaasSubscriptionId, s.asaasAuthorizationId, s.asaasCheckoutId].filter(Boolean).join(' · ') || '–'}</span>,
          s.asaasSubscriptionId ? <Button key="r" size="sm" onClick={() => run(() => adminReconcile(s.id), 'Reconciliado com o Asaas.')}>Reconciliar</Button> : null
        ])} />
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Cobranças</h2>
      <Table empty="Nenhuma cobrança ainda." head={['Usuário', 'Status', 'Valor', 'Vencimento', 'Pago em', 'ID Asaas']}
        rows={fin.payments.map(p => [p.user?.email, <strong key="s" style={p.status === 'OVERDUE' ? { color: 'var(--red)' } : undefined}>{p.status}</strong>, formatBRL(p.valueCents), formatDate(p.dueDate), formatDate(p.paidAt), <span key="i" className="ff-mono">{p.asaasPaymentId}</span>])} />
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Usuários Premium</h2>
      <Table empty="Ninguém é Premium agora." head={['Usuário', 'Origem', 'Manual até', '']}
        rows={fin.premium.map(u => [<span key="u">{u.name}<br /><span className="dim">{u.email}</span></span>, u.source === 'manual' ? 'Concedido' : 'Assinatura', u.manualPremium ? (u.manualPremiumUntil ? formatDate(u.manualPremiumUntil) : 'sem prazo') : '–',
          u.manualPremium ? <Button key="r" size="sm" variant="destructive" onClick={() => revoke(u.id)}>Revogar</Button> : null])} />
      <div className="dim small" style={{ marginTop: 8 }}>Para conceder Premium a alguém, abra o usuário no painel principal, ou informe o ID aqui:</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input id="uid" className="input" placeholder="ID do usuário" aria-label="ID do usuário" />
        <Button onClick={() => { const v = document.getElementById('uid').value.trim(); if (v) grant(v) }}>Conceder</Button>
      </div>
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Eventos do webhook</h2>
      <Table empty="Nenhum evento recebido." head={['Recebido', 'Tipo', 'Status', 'Cobrança', 'Erro']}
        rows={fin.events.map(e => [formatDateTime(e.receivedAt), <span key="t" className="ff-mono">{e.type}</span>, <strong key="s" style={e.status === 'FAILED' ? { color: 'var(--red)' } : undefined}>{e.status}</strong>, <span key="p" className="ff-mono">{e.asaasPaymentId || '–'}</span>, e.error || ''])} />
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Consumo de IA no mês</h2>
      <div className="small muted" style={{ marginBottom: 8 }}>Tokens: {o.ai.inputTokens.toLocaleString('pt-BR')} de entrada · {o.ai.outputTokens.toLocaleString('pt-BR')} de saída · {o.aiFailures} falhas do provedor</div>
      <Table empty="Sem consumo neste mês." head={['Usuário', 'Mensagens', 'Tokens entrada', 'Tokens saída']}
        rows={fin.aiUsage.map(u => [u.email || u.name, u.messages, u.inputTokens, u.outputTokens])} />
    </div>

    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Erros de integração</h2>
      <Table empty="Nenhum erro registrado." head={['Quando', 'Origem', 'Mensagem']}
        rows={fin.errors.map(e => [formatDateTime(e.createdAt), e.scope, e.message])} />
    </div>

    <div className="card">
      <h2 style={{ marginTop: 0 }}>Auditoria das ações</h2>
      <Table empty="Nenhuma ação administrativa ainda." head={['Quando', 'Admin', 'Ação', 'Alvo']}
        rows={fin.audit.map(a => [formatDateTime(a.createdAt), a.actor?.name, a.action, <span key="t" className="ff-mono">{a.targetType} {a.targetId}</span>])} />
    </div>
  </div>
}
