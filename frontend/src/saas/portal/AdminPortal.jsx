// Administração da plataforma (computador): academias, moderação da biblioteca e financeiro. Só admin.
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui.jsx'
import { useStore } from '../../store/useStore.js'
import DesktopShell from './DesktopShell.jsx'
import AdminFinance from '../AdminFinance.jsx'
import { PlatformGyms, PlatformModeration } from '../AdminPlatform.jsx'

const NAV = [
  { to: '/plataforma', label: 'Academias', end: true },
  { to: '/plataforma/moderacao', label: 'Moderação' },
  { to: '/plataforma/financeiro', label: 'Financeiro e IA' },
  { to: '/admin', label: 'Configurações da instância' }
]

function Denied() {
  const nav = useNavigate()
  return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
    <div className="card" style={{ maxWidth: 440 }}>
      <h2 style={{ marginTop: 0 }}>Acesso restrito</h2>
      <p className="muted">Esta conta não é administradora da plataforma. Se você deveria ter acesso, peça ao dono do produto.</p>
      <div style={{ display: 'flex', gap: 8 }}><Button variant="primary" onClick={() => nav('/home')}>Ir para o meu treino</Button><Button variant="tinted" onClick={() => nav('/academia')}>Portal da academia</Button></div>
    </div>
  </div>
}

export default function AdminPortal() {
  const user = useStore(s => s.user)
  if (!user?.admin) return <Denied />
  return <Routes>
    <Route index element={<DesktopShell role="Administração" nav={NAV} title="Academias" sub="Todas as academias da plataforma, com plano e contagens."><PlatformGyms /></DesktopShell>} />
    <Route path="moderacao" element={<DesktopShell role="Administração" nav={NAV} title="Moderação" sub="Denúncias abertas na biblioteca comunitária."><PlatformModeration /></DesktopShell>} />
    <Route path="financeiro" element={<DesktopShell role="Administração" nav={NAV} title="Financeiro e IA"><AdminFinance /></DesktopShell>} />
    <Route path="entrar" element={<Navigate to="/plataforma" replace />} />
    <Route path="*" element={<Navigate to="/plataforma" replace />} />
  </Routes>
}
