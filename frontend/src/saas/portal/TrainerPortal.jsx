// Portal do personal trainer (celular): alunos, agenda, exercícios, biblioteca e perfil, com barra de abas própria.
// Quem ainda não tem perfil profissional começa criando o perfil.
import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import '../saas.css'
import './portal.css'
import { Button } from '../../components/ui.jsx'
import { useStore } from '../../store/useStore.js'
import { TrainerSide } from '../Personal.jsx'
import Library from '../Library.jsx'
import ExerciseLibrary from '../../views/Library.jsx'
import { Agenda, StudentDetail, StudentsHome } from './TrainerPages.jsx'
import Notifications from '../Notifications.jsx'
import { Err } from '../Gyms.jsx'
import { errorText, trainerAssignments, trainerLinks, trainerProfile } from '../api.js'
import { formatDateTime } from '../brand.js'

const STATUS = { ASSIGNED: 'Novo', IMPORTED: 'Adicionado pelo aluno', DECLINED: 'Recusado', ARCHIVED: 'Arquivado' }

function Page({ title, children, note }) {
  return <div className="page">
    <div className="pt-head"><h1>{title}</h1></div>
    {note && <p className="pt-note">{note}</p>}
    {children}
  </div>
}

function Sent() {
  const [rows, setRows] = useState(null)
  const [links, setLinks] = useState([])
  const [err, setErr] = useState(null)
  useEffect(() => { Promise.all([trainerAssignments(), trainerLinks()]).then(([a, l]) => { setRows(a.filter(x => x.kind !== undefined || true)); setLinks(l) }).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))) }, [])
  const who = id => links.find(l => l.id === id)?.other?.name || 'Aluno'
  const mine = (rows || []).filter(r => links.find(l => l.id === r.linkId && l.side === 'TRAINER'))
  return <Page title="Treinos enviados" note="Tudo o que você enviou aos seus alunos. Comentários e novas versões ficam dentro de cada aluno.">
    <Err>{err}</Err>
    {!rows && !err && <div className="muted small">Carregando…</div>}
    {rows && mine.length === 0 && <div className="card dim small">Você ainda não enviou treinos. Abra um aluno em “Alunos” e toque em “Enviar treino”.</div>}
    {mine.map(a => <div className="card" key={a.id} style={{ marginBottom: 8 }}>
      <div style={{ fontWeight: 700 }}>{a.title}</div>
      <div className="muted small">{a.kind === 'SUGGESTION' ? 'Sugestão' + (a.target ? ' para “' + a.target + '”' : '') + ' · ' : ''}{who(a.linkId)} · {STATUS[a.status]} · versão {a.revision}</div>
      <div className="muted small">{formatDateTime(a.createdAt)}</div>
    </div>)}
  </Page>
}

function Profile() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const signOut = useStore(s => s.signOut)
  return <Page title="Meu perfil">
    <TrainerSide part="profile" />
    <div className="card" style={{ marginTop: 14 }}>
      <div className="muted small">Conta: {user?.name}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <Button variant="tinted" onClick={() => nav('/personal/treinos')}>Treinos enviados</Button>
        <Button variant="tinted" onClick={() => nav('/personal/avisos')}>Notificações</Button>
        <Button variant="tinted" onClick={() => nav('/home')}>Meu treino (app do aluno)</Button>
        <Button variant="tinted" onClick={async () => { try { await signOut?.() } finally { nav('/', { replace: true }) } }}>Sair</Button>
      </div>
    </div>
  </Page>
}

export default function TrainerPortal() {
  const [profile, setProfile] = useState(undefined)
  useEffect(() => { trainerProfile().then(setProfile).catch(() => setProfile(null)) }, [])
  if (profile === undefined) return <div className="page"><div className="muted small">Carregando…</div></div>
  // Sem perfil profissional: primeiro o perfil. Depois o portal inteiro.
  if (!profile) return <Page title="Portal do personal" note="Crie seu perfil profissional para começar a convidar alunos."><TrainerSide part="profile" onSaved={setProfile} /></Page>
  const tabs = [['/personal', 'Alunos', '👥', true], ['/personal/agenda', 'Agenda', '📅'], ['/personal/exercicios', 'Exercícios', '🏋️'], ['/personal/biblioteca', 'Biblioteca', '📚'], ['/personal/perfil', 'Perfil', '👤']]
  return <>
    <Routes>
      <Route index element={<StudentsHome />} />
      <Route path="aluno/:linkId" element={<StudentDetail />} />
      <Route path="agenda" element={<Agenda />} />
      <Route path="exercicios" element={<ExerciseLibrary />} />
      <Route path="treinos" element={<Sent />} />
      <Route path="biblioteca" element={<Library back="/personal" />} />
      <Route path="perfil" element={<Profile />} />
      <Route path="avisos" element={<Notifications back="/personal/perfil" />} />
      <Route path="entrar" element={<Navigate to="/personal" replace />} />
      <Route path="cadastro" element={<Navigate to="/personal" replace />} />
      <Route path="*" element={<Navigate to="/personal" replace />} />
    </Routes>
    <nav className="pt-nav" aria-label="Portal do personal">
      {tabs.map(([to, label, icon, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => isActive ? 'active' : ''}><b aria-hidden="true">{icon}</b>{label}</NavLink>)}
    </nav>
  </>
}
