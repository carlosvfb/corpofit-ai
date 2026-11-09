// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GymPortal from './GymPortal.jsx'
import AdminPortal from './AdminPortal.jsx'
import TrainerPortal from './TrainerPortal.jsx'
import PortalLogin from './PortalLogin.jsx'
import { PORTALS, hasOwnNav, isDesktopPath, portalOf } from './portals.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const st = vi.hoisted(() => ({ user: { id: 'u1', name: 'Ana', admin: false }, signOut: vi.fn(), setUser: vi.fn(), adoptProfile: vi.fn(), pushState: vi.fn(), pullState: vi.fn() }))
vi.mock('../../store/useStore.js', () => {
  const useStore = sel => sel(st)
  useStore.getState = () => ({ ...st, S: {} })
  return { useStore, hasData: () => false }
})
vi.mock('../../store/useUI.js', () => { const u = { toast: vi.fn() }; const useUI = sel => (sel ? sel(u) : u); useUI.getState = () => u; return { useUI } })
vi.mock('../../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
vi.mock('../../lib/api.js', () => ({ passwordLogin: vi.fn() }))
vi.mock('../../lib/routine-link.js', () => ({ routineLinkBundle: vi.fn(), readRoutineBundle: vi.fn(), importRoutineLink: vi.fn() }))
vi.mock('../../views/Library.jsx', () => ({ default: () => <div>Biblioteca de exercícios</div> }))
vi.mock('../AdminFinance.jsx', () => ({ default: () => <div>Financeiro da plataforma</div> }))
vi.mock('../api.js', () => ({
  errorText: (e, f) => f,
  registerAccount: vi.fn(), orgContexts: vi.fn(), createOrg: vi.fn(), acceptOrgInvite: vi.fn(), orgMembers: vi.fn(), inviteOrgMember: vi.fn(),
  changeOrgRole: vi.fn(), removeOrgMember: vi.fn(), cancelPendingInvite: vi.fn(), orgDashboard: vi.fn(), orgSettings: vi.fn(), saveOrgSettings: vi.fn(),
  orgActivity: vi.fn(), orgAiUsage: vi.fn(), orgBilling: vi.fn(), startOrgCheckout: vi.fn(), cancelOrgSubscription: vi.fn(), aiContext: vi.fn(), setAiContext: vi.fn(),
  leaveOrg: vi.fn(), moderationQueue: vi.fn(), moderationQueuePlatform: vi.fn(), moderateItem: vi.fn(), adminGyms: vi.fn(),
  trainerProfile: vi.fn(), saveTrainerProfile: vi.fn(), trainerLinks: vi.fn(), trainerAssignments: vi.fn(), inviteStudent: vi.fn(), requestTrainer: vi.fn(),
  answerLink: vi.fn(), endLink: vi.fn(), assignWorkout: vi.fn(), assignSuggestion: vi.fn(), answerAssignment: vi.fn(), assignmentComments: vi.fn(),
  addAssignmentComment: vi.fn(), sharedWithMe: vi.fn(), shareCategories: vi.fn(), readStudentData: vi.fn(),
  trainerOverview: vi.fn(), trainerSessions: vi.fn(), createSessions: vi.fn(), updateSession: vi.fn(), answerSession: vi.fn(), cancelSession: vi.fn(),
  trainerNotes: vi.fn(), addTrainerNote: vi.fn(), deleteTrainerNote: vi.fn(), updateAssignment: vi.fn(), applyPreset: vi.fn(), myPermissions: vi.fn(),
  communityItems: vi.fn(), communityItem: vi.fn(), publishItem: vi.fn(), removeItem: vi.fn(), favoriteItem: vi.fn(), importCommunityItem: vi.fn(), reportItem: vi.fn(),
  listNotifications: vi.fn(), markNotificationsRead: vi.fn(), emailVerification: vi.fn(), sendEmailCode: vi.fn(), confirmEmailCode: vi.fn()
}))
import * as api from '../api.js'
import { passwordLogin } from '../../lib/api.js'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname}</div> }
const mount = async (path, el) => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/academia/*" element={el} /><Route path="/plataforma/*" element={el} /><Route path="/personal/*" element={el} /><Route path="*" element={el} /></Routes><Where /></MemoryRouter>) })
  await flush()
}
const where = () => host.querySelector('[data-testid=where]').textContent
const navText = () => [...host.querySelectorAll('.dk-link')].map(a => a.textContent)
const type = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  st.user = { id: 'u1', name: 'Ana', admin: false }
  api.orgContexts.mockResolvedValue({ personal: {}, gyms: [
    { id: 'g1', name: 'Alfa', role: 'GYM_OWNER', status: 'ACTIVE' }, { id: 'g2', name: 'Beta', role: 'GYM_MANAGER', status: 'ACTIVE' },
    { id: 'g3', name: 'Gama', role: 'STUDENT', status: 'ACTIVE' }, { id: 'g4', name: 'Delta', role: 'GYM_ADMIN', status: 'INVITED' }
  ] })
  api.orgDashboard.mockResolvedValue({ members: { active: 3, invited: 1, byRole: {} }, students: { active: 2, joinedLast30Days: 1 }, professionals: { active: 1 } })
  api.orgMembers.mockResolvedValue([
    { userId: 'u2', name: 'Bia', email: 'bia@x.com', role: 'STUDENT', status: 'ACTIVE', since: '2026-11-01T00:00:00Z' },
    { userId: null, pendingId: 'p1', name: null, email: 'nova@x.com', role: 'STUDENT', status: 'PENDING_SIGNUP', since: '2026-11-02T00:00:00Z' }
  ])
})
afterEach(() => { act(() => root?.unmount()); host?.remove(); document.body.classList.remove('desk') })

describe('portais: cada função na sua tela', () => {
  it('academia e administração são de computador; personal e aluno, de celular', () => {
    expect(PORTALS.academia.desktop && PORTALS.admin.desktop).toBe(true)
    expect(!PORTALS.personal.desktop && !PORTALS.student.desktop).toBe(true)
    expect(portalOf('/academia/abc/membros').key).toBe('academia')
    expect(portalOf('/plataforma/moderacao').key).toBe('admin')
    expect(portalOf('/personal/treinos').key).toBe('personal')
    expect(portalOf('/home').key).toBe('student')
    expect(portalOf('/academias').key).toBe('student')            // a lista do aluno não é o portal
    expect(isDesktopPath('/academia')).toBe(true)
    expect(hasOwnNav('/personal')).toBe(true)
    expect(hasOwnNav('/plan')).toBe(false)
  })

  it('portal da academia: lista só as academias que a pessoa gerencia, com o layout de computador', async () => {
    await mount('/academia', <GymPortal />)
    expect(document.body.classList.contains('desk')).toBe(true)
    expect(host.querySelector('.dk-side')).toBeTruthy()
    expect(host.textContent).toContain('Alfa')
    expect(host.textContent).toContain('Beta')
    expect(host.textContent).not.toContain('Gama')               // onde é aluno não aparece aqui
    expect(host.textContent).toContain('Convites')               // o convite de gestão pendente aparece
    expect(host.textContent).toContain('Cadastrar uma academia')
  })

  it('cria uma academia e abre o painel dela', async () => {
    api.createOrg.mockResolvedValue({ id: 'g9', name: 'Nova' })
    await mount('/academia', <GymPortal />)
    await type(host.querySelector('input[aria-label="Nome da academia"]'), 'Nova')
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(api.createOrg).toHaveBeenCalledWith('Nova')
    expect(where()).toBe('/academia/g9')
  })

  it('o dono vê todas as seções e a tabela de membros, convida e cancela convite pendente', async () => {
    api.inviteOrgMember.mockResolvedValue({})
    api.cancelPendingInvite.mockResolvedValue({})
    await mount('/academia/g1/membros', <GymPortal />)
    expect(navText()).toEqual(expect.arrayContaining(['Visão geral', 'Membros', 'Configurações', 'Atividade', 'Uso da IA', 'Plano e cobrança', 'Moderação da biblioteca']))
    expect(host.querySelector('table.dk-table')).toBeTruthy()
    expect(host.textContent).toContain('Bia')
    expect(host.textContent).toContain('Aguardando cadastro')
    await type(host.querySelector('input[aria-label="E-mail do convidado"]'), 'novo@x.com')
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(api.inviteOrgMember).toHaveBeenCalledWith('g1', 'novo@x.com', 'STUDENT')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancelar convite').click() }); await flush()
    expect(api.cancelPendingInvite).toHaveBeenCalledWith('g1', 'p1')
  })

  it('o gerente vê menos seções: sem configurações nem moderação', async () => {
    await mount('/academia/g2/geral', <GymPortal />)
    const items = navText()
    expect(items).toEqual(expect.arrayContaining(['Visão geral', 'Membros', 'Atividade', 'Plano e cobrança']))
    expect(items).not.toContain('Configurações')
    expect(items).not.toContain('Moderação da biblioteca')
  })

  it('quem não gerencia a academia não entra nela pelo portal', async () => {
    await mount('/academia/g3/geral', <GymPortal />)
    expect(host.textContent).toContain('Você não gerencia esta academia')
    expect(api.orgDashboard).not.toHaveBeenCalled()
  })

  it('administração: só admin entra; os demais veem acesso restrito', async () => {
    await mount('/plataforma', <AdminPortal />)
    expect(host.textContent).toContain('Acesso restrito')
    act(() => root.unmount()); host.remove()
    st.user = { id: 'a1', name: 'Admin', admin: true }
    api.adminGyms.mockResolvedValue([{ id: 'g1', name: 'Alfa', plan: 'Academia Grátis', paid: false, members: 3, invited: 1, createdAt: '2026-11-01T00:00:00Z', status: 'ACTIVE' }])
    await mount('/plataforma', <AdminPortal />)
    expect(navText()).toEqual(expect.arrayContaining(['Academias', 'Moderação', 'Financeiro e IA']))
    expect(host.textContent).toContain('Alfa')
    expect(host.textContent).toContain('3 membros ativos')
  })

  it('portal do personal: sem perfil, primeiro cria o perfil; com perfil, tem barra de abas própria', async () => {
    api.trainerProfile.mockResolvedValue(null)
    api.trainerLinks.mockResolvedValue([]); api.trainerAssignments.mockResolvedValue([]); api.sharedWithMe.mockResolvedValue([]); api.shareCategories.mockResolvedValue([]); api.trainerOverview.mockResolvedValue([])
    await mount('/personal', <TrainerPortal />)
    expect(host.textContent).toContain('Crie seu perfil profissional')
    expect(host.querySelector('.pt-nav')).toBeNull()
    act(() => root.unmount()); host.remove()
    api.trainerProfile.mockResolvedValue({ userId: 'u1', displayName: 'Prof. Ana', bio: '', specialties: [] })
    await mount('/personal', <TrainerPortal />)
    const tabs = [...host.querySelectorAll('.pt-nav a')].map(a => a.textContent)
    expect(tabs.join('|')).toMatch(/Alunos.*Agenda.*Exercícios.*Biblioteca.*Perfil/)
    expect(document.body.classList.contains('desk')).toBe(false)   // é celular, sem o layout de computador
    expect(host.textContent).toContain('Convidar aluno')
  })
})

describe('login por portal', () => {
  it('cada portal tem a sua tela de entrada, com texto próprio', async () => {
    await mount('/academia/entrar', <PortalLogin portal="academia" />)
    expect(host.querySelector('[data-portal=academia]')).toBeTruthy()
    expect(host.textContent).toContain('Portal da academia')
    expect(host.querySelector('.pl.mobile')).toBeNull()
    act(() => root.unmount()); host.remove()
    await mount('/personal/entrar', <PortalLogin portal="personal" />)
    expect(host.textContent).toContain('Portal do personal')
    expect(host.querySelector('.pl.mobile')).toBeTruthy()
  })

  it('entrar leva ao portal certo', async () => {
    passwordLogin.mockResolvedValue({ id: 'u1', name: 'Ana' })
    await mount('/academia/entrar', <PortalLogin portal="academia" />)
    await type(host.querySelector('#pl-email'), 'ana@x.com'); await type(host.querySelector('#pl-pw'), 'segredo-longo-123')
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(passwordLogin).toHaveBeenCalledWith('ana@x.com', 'segredo-longo-123')
    expect(where()).toBe('/academia')
  })

  it('a administração não tem cadastro; a academia e o personal têm', async () => {
    await mount('/plataforma/entrar', <PortalLogin portal="admin" />)
    expect(host.textContent).not.toContain('Criar conta')
    act(() => root.unmount()); host.remove()
    await mount('/personal/entrar', <PortalLogin portal="personal" />)
    expect([...host.querySelectorAll('a')].some(a => a.getAttribute('href') === '/personal/cadastro')).toBe(true)
  })

  it('o cadastro pede aceite dos termos e leva ao portal', async () => {
    api.registerAccount.mockResolvedValue({ id: 'u9', name: 'Bruno' })
    await mount('/personal/cadastro', <PortalLogin portal="personal" mode="register" />)
    await type(host.querySelector('#pl-name'), 'Bruno'); await type(host.querySelector('#pl-email'), 'b@x.com')
    await type(host.querySelector('#pl-pw'), 'segredo-longo-123'); await type(host.querySelector('#pl-again'), 'segredo-longo-123')
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(host.textContent).toContain('Aceite os Termos')
    await act(async () => { host.querySelector('input[type=checkbox]').click() })
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(api.registerAccount).toHaveBeenCalledWith('Bruno', 'b@x.com', 'segredo-longo-123')
    expect(where()).toBe('/personal')
  })
})
