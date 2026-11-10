// Foto de perfil: o círculo com a foto (ou a inicial do nome) e o bloco para trocar ou remover a foto.
// Quem entrou pelo Google já vem com a foto do Google; quem entrou de outro jeito escolhe uma aqui.
// A foto fica no servidor, só a própria pessoa a recebe de volta (GET /api/account/avatar).
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { resizeToAvatar } from '../lib/avatar-image.js'
import { errorText, removeAvatar, uploadAvatar } from './api.js'

export const avatarSrc = user => (user?.avatar ? '/api/account/avatar?v=' + encodeURIComponent(user.avatar) : null)

export function Avatar({ user, size = 40 }) {
  const src = avatarSrc(user)
  const box = { width: size, height: size, borderRadius: '50%', flex: 'none', objectFit: 'cover', display: 'inline-grid', placeItems: 'center' }
  if (src) return <img src={src} alt="" width={size} height={size} style={box} />
  return <span aria-hidden="true" style={{ ...box, background: 'var(--acc-soft, rgba(124,92,255,.16))', color: 'var(--acc, #7c5cff)', fontWeight: 700, fontSize: size * 0.42 }}>{String(user?.name || '?').trim().charAt(0).toUpperCase()}</span>
}

export function ProfilePhoto() {
  const user = useStore(s => s.user)
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = avatar => useStore.setState(s => ({ user: s.user ? (avatar ? { ...s.user, avatar } : (({ avatar: _a, ...rest }) => rest)(s.user)) : s.user }))
  const pick = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(null); setBusy(true)
    try { set((await uploadAvatar(await resizeToAvatar(file))).avatar) } catch (x) { setErr(errorText(x, x?.message || 'Não foi possível salvar a foto.')) } finally { setBusy(false) }
  }
  const remove = async () => { setErr(null); setBusy(true); try { await removeAvatar(); set(null) } catch (x) { setErr(errorText(x, 'Não foi possível remover.')) } finally { setBusy(false) } }
  if (!user) return null
  return <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '10px 0' }} data-profile-photo>
    <Avatar user={user} size={72} />
    <div style={{ flex: 1, minWidth: 180 }}>
      <div style={{ fontWeight: 700 }}>Foto de perfil</div>
      <div className="muted small">{user.avatar ? 'Aparece no seu perfil e nos portais.' : 'Escolha uma foto sua. Quem entra com o Google já recebe a do Google.'}</div>
      {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 4 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => input.current?.click()}>{user.avatar ? 'Trocar foto' : 'Escolher foto'}</Button>
        {user.avatar && <Button variant="tinted" size="sm" disabled={busy} onClick={remove}>Remover</Button>}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
    </div>
  </div>
}

/** Página "Foto de perfil" dos Ajustes. */
export default function ProfilePhotoPage() {
  const nav = useNavigate()
  return <div className="page">
    <div className="hdr">
      <button className="iconbtn" data-back="/settings" onClick={() => nav('/settings')} aria-label="Voltar"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>Foto de perfil</h1><div className="sub">Como você aparece no app</div></div>
    </div>
    <ProfilePhoto />
  </div>
}
