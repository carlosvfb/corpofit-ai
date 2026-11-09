// Entrada de cada portal: o mesmo login e o mesmo cadastro da conta, numa tela própria da função.
// Academia e administração têm tela de computador; personal e aluno, de celular.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../saas.css'
import './portal.css'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { passwordLogin } from '../../lib/api.js'
import { askAddDeviceData } from '../../sheets.jsx'
import { hasData } from '../../store/useStore.js'
import { BRAND } from '../brand.js'
import { errorText, registerAccount } from '../api.js'
import { PORTALS } from './portals.js'

const MIN_PASSWORD = 10
const Other = ({ current }) => <div className="pl-other">
  <div>Outra função?</div>
  {Object.values(PORTALS).filter(p => p.key !== current && p.key !== 'admin').map(p => <Link key={p.key} to={p.login}>{p.label}</Link>)}
</div>

export default function PortalLogin({ portal, mode = 'login' }) {
  const p = PORTALS[portal]
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', email: '', pw: '', again: '', terms: false })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const register = mode === 'register' && !!p.register
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setErr(null)
    if (!register) {
      if (!f.email.trim() || !f.pw) { setErr('Informe e-mail e senha.'); return }
      setBusy(true)
      try {
        const u = await passwordLogin(f.email.trim(), f.pw)
        const st = useStore.getState()
        st.setUser(u, { adopt: true })
        await st.adoptProfile(askAddDeviceData)
        useUI.getState().toast(`Bem-vindo de volta, ${u.name}`)
        nav(p.home, { replace: true })
      } catch (ex) { setErr(errorText(ex, 'Não foi possível entrar.')) } finally { setBusy(false) }
      return
    }
    const bad = !f.name.trim() ? 'Informe seu nome.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) ? 'Informe um e-mail válido.'
      : [...f.pw].length < MIN_PASSWORD ? `A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`
      : f.pw !== f.again ? 'As duas senhas não são iguais.'
      : !f.terms ? 'Aceite os Termos de Uso e a Política de Privacidade.' : null
    if (bad) { setErr(bad); return }
    setBusy(true)
    try {
      const u = await registerAccount(f.name.trim(), f.email.trim(), f.pw)
      const st = useStore.getState()
      st.setUser(u)
      if (hasData(useStore.getState().S)) await st.pushState(); else await st.pullState()
      nav(p.home, { replace: true })
    } catch (ex) { setErr(errorText(ex, 'Não foi possível criar a conta.')) } finally { setBusy(false) }
  }
  return <div className={'pl' + (p.desktop ? '' : ' mobile')} data-portal={p.key}>
    <section className="pl-brand">
      <div style={{ fontWeight: 800, fontSize: 18 }}>⚡ {BRAND.name}</div>
      <h1>{p.title}</h1>
      <p style={{ margin: 0, fontSize: 17, opacity: .9 }}>{p.tagline}</p>
      <ul>{p.bullets.map(b => <li key={b}>{b}</li>)}</ul>
    </section>
    <section className="pl-form">
      <form className="pl-card" onSubmit={submit} noValidate>
        <h2>{register ? 'Criar conta' : 'Entrar'}</h2>
        {register && <div className="pl-field"><label htmlFor="pl-name">Nome</label><input id="pl-name" className="input" autoComplete="name" maxLength={40} value={f.name} onChange={set('name')} /></div>}
        <div className="pl-field"><label htmlFor="pl-email">E-mail</label><input id="pl-email" className="input" type="email" autoComplete="username" inputMode="email" value={f.email} onChange={set('email')} /></div>
        <div className="pl-field"><label htmlFor="pl-pw">Senha</label><input id="pl-pw" className="input" type="password" autoComplete={register ? 'new-password' : 'current-password'} value={f.pw} onChange={set('pw')} /></div>
        {register && <div className="pl-field"><label htmlFor="pl-again">Repita a senha</label><input id="pl-again" className="input" type="password" autoComplete="new-password" value={f.again} onChange={set('again')} /></div>}
        {register && <label style={{ display: 'flex', gap: 8, fontSize: 13 }}><input type="checkbox" checked={f.terms} onChange={set('terms')} style={{ marginTop: 3 }} /><span>Li e aceito os <Link to="/termos" target="_blank">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank">Política de Privacidade</Link>.</span></label>}
        {err && <div className="pl-err" role="alert">{err}</div>}
        <button className="btn primary" disabled={busy} style={{ minHeight: 46 }}>{busy ? 'Aguarde…' : register ? 'Criar conta' : 'Entrar'}</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          {register ? <Link to={p.login}>Já tenho conta</Link> : <Link to="/recuperar">Esqueci a senha</Link>}
          {!register && p.register && <Link to={p.register}>Criar conta</Link>}
        </div>
        <Other current={p.key} />
        <div style={{ fontSize: 12, opacity: .6 }}>Uma conta só serve para todas as funções (aluno, personal, academia). Cada função abre no seu portal.</div>
      </form>
    </section>
  </div>
}
