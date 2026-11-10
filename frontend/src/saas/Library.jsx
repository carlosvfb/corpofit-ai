// Biblioteca comunitária: rotinas, dicas e artigos compartilhados por outros usuários (todos) ou pela
// academia. Explorar, favoritar, importar uma rotina para as suas, publicar o seu conteúdo e denunciar.
// Dono e admin de uma academia moderam o conteúdo dela. O servidor higieniza e confere tudo; aqui só se mostra.
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './saas.css'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { importRoutineLink, readRoutineBundle, routineLinkBundle } from '../lib/routine-link.js'
import {
  communityItem, communityItems, errorText, favoriteItem, importCommunityItem, moderateItem, moderationQueue, orgContexts,
  publishItem, removeItem, reportItem
} from './api.js'
import { formatDateTime } from './brand.js'

const KIND = { ROUTINE: 'Rotina', TIP: 'Dica', ARTICLE: 'Artigo', PLAN: 'Plano' }
const REASON = { INAPPROPRIATE: 'Conteúdo inadequado', COPYRIGHT: 'Direitos autorais', PERSONAL_DATA: 'Dados pessoais', SPAM: 'Spam', OTHER: 'Outro motivo' }
const RANK = { GYM_OWNER: 7, GYM_ADMIN: 6, GYM_MANAGER: 5, INSTRUCTOR: 4, RECEPTIONIST: 3, PERSONAL_TRAINER: 2, STUDENT: 1 }
const Err = ({ children }) => children ? <div className="small" role="alert" style={{ color: 'var(--red)', margin: '8px 0' }}>{children}</div> : null

function Card({ it, onChange, onNotice }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [open, setOpen] = useState(null)
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('INAPPROPRIATE')
  const [note, setNote] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const run = async fn => { setBusy(true); setErr(null); try { await fn() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  const view = () => run(async () => setOpen(open ? null : await communityItem(it.id)))
  const add = () => run(async () => {
    const got = await importCommunityItem(it.id)
    const parsed = readRoutineBundle({ ...got.bundle, from: got.author }, S?.unit || 'kg')
    update(s => { importRoutineLink(s, parsed) })
    onNotice('Rotina adicionada às suas rotinas (aba Plano).'); onChange()
  })
  return <div className="card" style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{it.title}</div>
        <div className="muted small">{KIND[it.kind] || it.kind} · por {it.author}{it.visibility === 'GYM' ? ' · só da academia' : ''}{it.status === 'HIDDEN' ? ' · oculto (em revisão)' : ''}</div>
      </div>
      {it.kind === 'ROUTINE' && <div className="muted small" style={{ whiteSpace: 'nowrap' }}>{it.imports} importações</div>}
    </div>
    {it.description && <div className="small" style={{ margin: '6px 0', overflowWrap: 'anywhere' }}>{it.description}</div>}
    <Err>{err}</Err>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      <Button variant="tinted" disabled={busy} onClick={view}>{open ? 'Fechar' : 'Ver'}</Button>
      <Button variant="tinted" disabled={busy} onClick={() => run(async () => { await favoriteItem(it.id, !it.favorited); onChange() })}>{it.favorited ? 'Desfavoritar' : 'Favoritar'}</Button>
      {it.kind === 'ROUTINE' && it.status === 'PUBLISHED' && <Button variant="primary" disabled={busy} onClick={add}>Adicionar às minhas rotinas</Button>}
      {it.mine ? <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Remover este conteúdo da biblioteca?')) run(async () => { await removeItem(it.id); onChange() }) }}>Remover</Button>
        : <Button variant="tinted" disabled={busy} onClick={() => setReporting(r => !r)}>Denunciar</Button>}
    </div>
    {reporting && <div style={{ marginTop: 8 }}>
      <select className="input" value={reason} onChange={e => setReason(e.target.value)} aria-label="Motivo da denúncia">{Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      <input className="input" style={{ marginTop: 6 }} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Detalhes (opcional)" aria-label="Detalhes da denúncia" />
      <div style={{ marginTop: 6 }}><Button variant="primary" disabled={busy} onClick={() => run(async () => { await reportItem(it.id, reason, note); setReporting(false); setNote(''); onNotice('Denúncia enviada. Obrigado.'); onChange() })}>Enviar denúncia</Button></div>
    </div>}
    {open && <div className="small" style={{ marginTop: 8, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
      {open.body}
      {open.bundle && <div>{(open.bundle.routines?.[0]?.ex || []).length} exercícios na rotina “{open.bundle.routines?.[0]?.name}”. Os pesos não são compartilhados.</div>}
    </div>}
  </div>
}

function Publish({ gyms, onDone }) {
  const S = useStore(s => s.S)
  const [f, setF] = useState({ kind: 'ROUTINE', title: '', description: '', body: '', routineId: '', visibility: 'PUBLIC', tenantId: '', rights: false })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const routines = (S?.routines || []).filter(r => Array.isArray(r.ex) && r.ex.length)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const body = { kind: f.kind, title: f.title, description: f.description, visibility: f.visibility, tenantId: f.visibility === 'GYM' ? f.tenantId : undefined, rightsConfirmed: f.rights }
      if (f.kind === 'ROUTINE') body.bundle = routineLinkBundle(S, routines.find(r => r.id === f.routineId), { weights: false, from: '' })
      else body.body = f.body
      await publishItem(body); onDone()
    } catch (x) { setErr(errorText(x, 'Não foi possível publicar.')) } finally { setBusy(false) }
  }
  const ok = f.rights && f.title.trim().length >= 3 && (f.kind === 'ROUTINE' ? !!f.routineId : f.body.trim().length >= 20) && (f.visibility === 'PUBLIC' || !!f.tenantId)
  return <form className="card" onSubmit={submit}>
    <Err>{err}</Err>
    <select className="input" value={f.kind} onChange={e => set('kind', e.target.value)} aria-label="Tipo de conteúdo">
      <option value="ROUTINE">Rotina</option><option value="TIP">Dica</option><option value="ARTICLE">Artigo</option>
    </select>
    <input className="input" style={{ marginTop: 8 }} value={f.title} maxLength={80} onChange={e => set('title', e.target.value)} placeholder="Título" aria-label="Título" />
    <textarea className="input" style={{ marginTop: 8 }} rows={2} maxLength={500} value={f.description} onChange={e => set('description', e.target.value)} placeholder="Descrição curta (opcional)" aria-label="Descrição" />
    {f.kind === 'ROUTINE'
      ? <select className="input" style={{ marginTop: 8 }} value={f.routineId} onChange={e => set('routineId', e.target.value)} aria-label="Rotina a publicar">
        <option value="">Escolha uma das suas rotinas</option>{routines.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      : <textarea className="input" style={{ marginTop: 8 }} rows={5} maxLength={f.kind === 'TIP' ? 1000 : 8000} value={f.body} onChange={e => set('body', e.target.value)} placeholder="Escreva o conteúdo (mínimo de 20 caracteres)" aria-label="Conteúdo" />}
    <select className="input" style={{ marginTop: 8 }} value={f.visibility} onChange={e => set('visibility', e.target.value)} aria-label="Quem pode ver">
      <option value="PUBLIC">Todos os usuários</option>{gyms.length > 0 && <option value="GYM">Só uma academia</option>}
    </select>
    {f.visibility === 'GYM' && <select className="input" style={{ marginTop: 8 }} value={f.tenantId} onChange={e => set('tenantId', e.target.value)} aria-label="Academia">
      <option value="">Escolha a academia</option>{gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>}
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10 }}><input type="checkbox" checked={f.rights} onChange={e => set('rights', e.target.checked)} style={{ marginTop: 3 }} /> <span className="small">Confirmo que este conteúdo é meu (ou que tenho o direito de compartilhá-lo) e que não contém dados pessoais nem imagens ou vídeos de terceiros.</span></label>
    <div className="dim small" style={{ marginTop: 6 }}>Em rotinas, os pesos, as mídias e os links são removidos automaticamente antes de publicar.</div>
    <div style={{ marginTop: 10 }}><Button variant="primary" type="submit" disabled={busy || !ok}>Publicar</Button></div>
  </form>
}

export function Moderation({ gyms, onNotice }) {
  const [tenant, setTenant] = useState(gyms[0]?.id || '')
  const [queue, setQueue] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => tenant ? moderationQueue(tenant).then(setQueue).catch(e => setErr(errorText(e, 'Não foi possível carregar a fila.'))) : null, [tenant])
  useEffect(() => { load() }, [load])
  const act = async (id, action) => { setErr(null); try { await moderateItem(id, action, tenant); onNotice('Decisão registrada.'); await load() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } }
  return <>
    <Err>{err}</Err>
    {gyms.length > 1 && <select className="input" value={tenant} onChange={e => setTenant(e.target.value)} aria-label="Academia">{gyms.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
    {queue && queue.length === 0 && <div className="card dim small" style={{ marginTop: 8 }}>Nenhuma denúncia aberta.</div>}
    {queue?.map(i => <div className="card" key={i.id} style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 700 }}>{i.title}</div>
      <div className="muted small">{KIND[i.kind]} · por {i.author} · {i.status === 'HIDDEN' ? 'oculto' : 'publicado'}</div>
      {i.reports.map(r => <div key={r.id} className="small" style={{ marginTop: 4 }}>{REASON[r.reason]}{r.note ? ': ' + r.note : ''} <span className="muted">({formatDateTime(r.at)})</span></div>)}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {i.status === 'PUBLISHED' && <Button variant="primary" onClick={() => act(i.id, 'hide')}>Ocultar</Button>}
        {i.status === 'HIDDEN' && <Button variant="primary" onClick={() => act(i.id, 'restore')}>Restaurar</Button>}
        <Button variant="tinted" onClick={() => act(i.id, 'dismiss')}>Ignorar denúncias</Button>
      </div>
    </div>)}
  </>
}

export default function Library({ back = '/settings' }) {
  const nav = useNavigate()
  const [tab, setTab] = useState('explore')
  const [gyms, setGyms] = useState([])
  const [scope, setScope] = useState('public')
  const [tenant, setTenant] = useState('')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  useEffect(() => { orgContexts().then(c => { setGyms(c.gyms.filter(g => g.status === 'ACTIVE')); }).catch(() => {}) }, [])
  const load = useCallback(() => {
    if (tab === 'publish' || tab === 'moderation') return
    const params = { kind: kind || undefined, q: q || undefined, scope, tenant: scope === 'gym' ? tenant : undefined, favorites: tab === 'favorites' ? 1 : undefined, mine: tab === 'mine' ? 1 : undefined }
    if (scope === 'gym' && !tenant) { setItems([]); return }
    communityItems(params).then(r => { setItems(r); setError(null) }).catch(e => setError(errorText(e, 'Não foi possível carregar a biblioteca.')))
  }, [tab, kind, q, scope, tenant])
  useEffect(() => { load() }, [load])
  const publishers = gyms.filter(g => RANK[g.role] >= RANK.PERSONAL_TRAINER)
  const moderators = gyms.filter(g => RANK[g.role] >= RANK.GYM_ADMIN)
  const tabs = [['explore', 'Explorar'], ['favorites', 'Favoritos'], ['mine', 'Meus'], ['publish', 'Publicar'], ...(moderators.length ? [['moderation', 'Moderação']] : [])]
  return <div className="page">
    <div className="hdr">
      <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Biblioteca</h1><div className="sub">Rotinas, dicas e artigos compartilhados</div></div>
    </div>
    <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
      {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={'btn ' + (tab === k ? 'primary' : 'tinted')} onClick={() => setTab(k)} style={{ width: 'auto', minHeight: 40, padding: '0 14px' }}>{label}</button>)}
    </div>
    {notice && <div className="small" role="status" style={{ margin: '6px 0' }}>{notice}</div>}
    <Err>{error}</Err>
    {(tab === 'explore' || tab === 'favorites') && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      <input className="input" style={{ flex: '1 1 160px' }} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar" aria-label="Buscar" />
      <select className="input" style={{ width: 'auto' }} value={kind} onChange={e => setKind(e.target.value)} aria-label="Tipo"><option value="">Todos os tipos</option><option value="ROUTINE">Rotinas</option><option value="TIP">Dicas</option><option value="ARTICLE">Artigos</option></select>
      <select className="input" style={{ width: 'auto' }} value={scope === 'gym' ? tenant : 'public'} onChange={e => { if (e.target.value === 'public') { setScope('public') } else { setScope('gym'); setTenant(e.target.value) } }} aria-label="Onde">
        <option value="public">Biblioteca pública</option>{gyms.map(g => <option key={g.id} value={g.id}>Academia: {g.name}</option>)}
      </select>
    </div>}
    {tab === 'publish' && <Publish gyms={publishers} onDone={() => { setNotice('Publicado!'); setTab('mine') }} />}
    {tab === 'moderation' && <Moderation gyms={moderators} onNotice={setNotice} />}
    {['explore', 'favorites', 'mine'].includes(tab) && <>
      {!items && !error && <div className="muted small">Carregando…</div>}
      {items && items.length === 0 && <div className="card dim small">{tab === 'favorites' ? 'Você ainda não favoritou nada.' : tab === 'mine' ? 'Você ainda não publicou nada.' : 'Nada encontrado.'}</div>}
      {items?.map(it => <Card key={it.id} it={it} onChange={load} onNotice={setNotice} />)}
    </>}
  </div>
}
