// Aparece nas telas do aluno (Plano, Estatísticas, Medidas) quando ele tem um personal vinculado: um toque liga ou desliga o
// envio automático daquela informação. Não envia nada por conta própria: liga a permissão (a mesma de Privacidade e
// compartilhamento) e o personal passa a ler o dado atualizado, só enquanto a permissão existir. Desligar vale na hora.
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../components/ui.jsx'
import { errorText, myPermissions, setPermission, trainerLinks } from './api.js'

let cache = null // { at, links, perms }: evita refazer a consulta a cada tela
export const clearShareCache = () => { cache = null }
const fresh = () => cache && Date.now() - cache.at < 20_000

/** `categories`: categorias que esta tela alimenta; `what`: o que o aluno entende ("seu peso e medidas"). */
export default function ShareWithTrainer({ categories, what }) {
  const [data, setData] = useState(fresh() ? cache : null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const [links, perms] = await Promise.all([trainerLinks(), myPermissions()])
      cache = { at: Date.now(), links: links.filter(l => l.side === 'STUDENT' && l.status === 'ACTIVE'), perms }
      setData(cache)
    } catch { setData({ links: [], perms: [] }) }
  }, [])
  useEffect(() => { if (!fresh()) load() }, [load])
  if (!data || data.links.length === 0) return null
  const on = l => { const g = data.perms.find(p => p.trainerId === l.other.id)?.grants || {}; return categories.every(c => g[c] && g[c] !== 'OFF') }
  const toggle = async l => {
    setErr(null); setBusy(true)
    try {
      const turnOn = !on(l)
      for (const c of categories) {
        const cur = data.perms.find(p => p.trainerId === l.other.id)?.grants?.[c] || 'OFF'
        if (turnOn && cur === 'OFF') await setPermission(l.other.id, c, 'SEE')
        if (!turnOn && cur !== 'OFF') await setPermission(l.other.id, c, 'OFF')
      }
      cache = null; await load()
    } catch (e) { setErr(errorText(e, 'Não foi possível alterar o compartilhamento.')) } finally { setBusy(false) }
  }
  return <div className="card" style={{ marginBottom: 10 }} data-share-trainer>
    {data.links.map(l => <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div className="small" style={{ flex: 1, minWidth: 180 }}>
        {on(l) ? <>Enviando {what} para <b>{l.other.name || 'seu personal'}</b>, sempre atualizado.</> : <>Quer que <b>{l.other.name || 'seu personal'}</b> acompanhe {what}?</>}
      </div>
      <Button variant={on(l) ? 'tinted' : 'primary'} size="sm" disabled={busy} onClick={() => toggle(l)}>{on(l) ? 'Parar de enviar' : 'Enviar ao personal'}</Button>
    </div>)}
    {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 6 }}>{err}</div>}
    <div className="dim small" style={{ marginTop: 4 }}>Só ele vê, e só o que você liberar. Você controla tudo em Ajustes → Privacidade.</div>
  </div>
}
