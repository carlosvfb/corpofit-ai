// Privacidade e compartilhamento: o aluno decide, por personal e por categoria, o que cada personal vê
// (ou vê e sugere), revoga tudo de uma vez e confere o histórico de consentimento e quem leu o quê. O
// servidor confere a permissão a cada leitura, então o que muda aqui vale na hora.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { accessLog, consentHistory, errorText, myPermissions, revokeAllSharing, setPermission, shareCategories, trainerLinks } from './api.js'
import { formatDateTime } from './brand.js'

const LEVEL_LABEL = { OFF: 'Não compartilhar', SEE: 'Ver', SUGGEST: 'Ver e sugerir' }
const ACTION_LABEL = { GRANT: 'Liberou', CHANGE: 'Alterou', REVOKE: 'Revogou' }
const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null

export default function Privacy() {
  const nav = useNavigate()
  const [cats, setCats] = useState(null)
  const [perms, setPerms] = useState(null)
  const [names, setNames] = useState({})
  const [history, setHistory] = useState([])
  const [log, setLog] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const [c, p, l, h, a] = await Promise.all([shareCategories(), myPermissions(), trainerLinks(), consentHistory(), accessLog()])
      setCats(c); setPerms(p); setHistory(h); setLog(a)
      setNames(Object.fromEntries(l.filter(x => x.side === 'STUDENT').map(x => [x.trainerId, x.other.name || x.other.email || 'Personal'])))
    } catch (e) { setError(errorText(e, 'Não foi possível carregar suas configurações.')) }
  }, [])
  useEffect(() => { load() }, [load])
  const act = async fn => { setBusy(true); setError(null); try { await fn(); await load() } catch (e) { setError(errorText(e, 'Não foi possível salvar.')) } finally { setBusy(false) } }
  const who = id => names[id] || 'Personal'
  return <div className="page">
    <div className="hdr">
      <button className="iconbtn" data-back="/personal" onClick={() => nav('/personal')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Privacidade e compartilhamento</h1><div className="sub">Você decide o que cada personal pode ver</div></div>
    </div>
    <Err>{error}</Err>
    {!perms && !error && <div className="muted small">Carregando…</div>}
    {perms && perms.length === 0 && <div className="card dim small">Você ainda não tem um personal vinculado. Quando tiver, é aqui que você libera ou bloqueia o que ele vê. Por padrão, nada é compartilhado.</div>}
    {perms?.map(p => <div className="card" key={p.linkId} style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{who(p.trainerId)}</div>
      <div className="muted small" style={{ marginBottom: 6 }}>Por padrão, nada é compartilhado. Mudanças valem na hora.</div>
      {cats?.map(c => <div key={c.id} style={{ padding: '8px 0', borderTop: '1px solid var(--sep, rgba(128,128,128,.25))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{c.label}</div><div className="muted small">{c.hint}</div></div>
          <select className="input" style={{ width: 'auto' }} disabled={busy || !c.available} aria-label={c.label + ' para ' + who(p.trainerId)}
            value={c.available ? (p.grants[c.id] || 'OFF') : 'OFF'} onChange={e => act(() => setPermission(p.trainerId, c.id, e.target.value))}>
            <option value="OFF">{LEVEL_LABEL.OFF}</option>
            {c.available && <option value="SEE">{LEVEL_LABEL.SEE}</option>}
            {c.available && c.suggest && <option value="SUGGEST">{LEVEL_LABEL.SUGGEST}</option>}
          </select>
        </div>
      </div>)}
      <div style={{ marginTop: 10 }}><Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Parar de compartilhar tudo com este personal?')) act(() => revokeAllSharing(p.trainerId)) }}>Revogar tudo</Button></div>
    </div>)}
    <div className="muted small" style={{ margin: '18px 4px 6px' }}>QUEM LEU SEUS DADOS</div>
    {log.length === 0 && <div className="card dim small">Ninguém acessou seus dados.</div>}
    {log.slice(0, 30).map(l => <div className="card" key={l.id} style={{ marginBottom: 6 }}>
      <div className="small"><b>{who(l.actorId)}</b> leu {cats?.find(c => c.id === l.category)?.label || l.category}</div>
      <div className="muted small">{formatDateTime(l.at)}</div>
    </div>)}
    <div className="muted small" style={{ margin: '18px 4px 6px' }}>HISTÓRICO DE CONSENTIMENTO</div>
    {history.length === 0 && <div className="card dim small">Nenhuma mudança ainda.</div>}
    {history.slice(0, 50).map(h => <div className="card" key={h.id} style={{ marginBottom: 6 }}>
      <div className="small">{ACTION_LABEL[h.action] || h.action}: {cats?.find(c => c.id === h.category)?.label || h.category} · {who(h.trainerId)}</div>
      <div className="muted small">{LEVEL_LABEL[h.from] || h.from} → {LEVEL_LABEL[h.to] || h.to} · {formatDateTime(h.at)}</div>
    </div>)}
    <div className="dim small" style={{ margin: '16px 4px' }}>A IA tem o próprio consentimento, na tela do Treinador. Fotos de evolução e dados de bem-estar ainda não podem ser compartilhados.</div>
  </div>
}
