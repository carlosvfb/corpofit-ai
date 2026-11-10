// Moldura dos portais para computador (academia e administração): menu lateral, conteúdo largo.
import { useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import '../saas.css'
import './portal.css'
import { useStore } from '../../store/useStore.js'
import { BRAND } from '../brand.js'
import { Avatar } from '../Avatar.jsx'

/** nav: [{ to, label, end? }]; context: { title, sub } mostra a academia em uso. */
export default function DesktopShell({ role, nav, context, title, sub, children }) {
  const navigate = useNavigate()
  const user = useStore(s => s.user)
  const signOut = useStore(s => s.signOut)
  useEffect(() => { document.body.classList.add('desk'); return () => document.body.classList.remove('desk') }, [])
  const leave = async () => { try { await signOut?.() } finally { navigate('/', { replace: true }) } }
  return <div className="dk">
    <aside className="dk-side" aria-label="Menu do portal">
      <div className="dk-brand"><i aria-hidden="true">⚡</i>{BRAND.name}</div>
      <div className="dk-role">{role}</div>
      {context && <div className="dk-ctx"><b>{context.title}</b>{context.sub}</div>}
      <nav aria-label="Seções" style={{ display: 'grid', gap: 2 }}>
        {nav.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'dk-link' + (isActive ? ' active' : '')}>{n.label}</NavLink>)}
      </nav>
      <div className="dk-spacer" />
      <NavLink to="/home" className="dk-link">Meu treino (app do aluno)</NavLink>
      <NavLink to="/foto" className="dk-user" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'inherit', textDecoration: 'none' }} title="Alterar foto de perfil"><Avatar user={user} size={34} /><span>{user?.name}</span></NavLink>
      <button className="btn tinted" onClick={leave} style={{ minHeight: 40 }}>Sair</button>
    </aside>
    <main className="dk-main" id="conteudo">
      {title && <h1>{title}</h1>}
      {sub && <div className="dk-sub">{sub}</div>}
      {children}
    </main>
  </div>
}
