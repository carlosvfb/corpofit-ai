// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Gyms, { Gym } from './Gyms.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ id: 'g1', nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => m.nav, useParams: () => ({ id: m.id }) }))
vi.mock('./api.js', () => ({
  errorText: (e, f) => f,
  orgContexts: vi.fn(), createOrg: vi.fn(), acceptOrgInvite: vi.fn(), orgDashboard: vi.fn(), orgMembers: vi.fn(),
  orgSettings: vi.fn(), saveOrgSettings: vi.fn(), orgActivity: vi.fn(), inviteOrgMember: vi.fn(), changeOrgRole: vi.fn(),
  removeOrgMember: vi.fn(), leaveOrg: vi.fn(), aiContext: vi.fn(), setAiContext: vi.fn(), orgAiUsage: vi.fn(),
  orgBilling: vi.fn(), startOrgCheckout: vi.fn(), cancelOrgSubscription: vi.fn()
}))
import * as api from './api.js'

let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const mount = async el => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(el) }); await flush() }
const tabs = () => [...host.querySelectorAll('[role=tab]')].map(b => b.textContent)

const BILLING = {
  plan: { code: 'GYM_FREE', name: 'Academia Grátis', priceCents: 0 }, paid: false, subscription: null, canManage: true,
  limits: { maxStudents: 10, maxProfessionals: 1, aiMonthlyMessages: 100 }, usage: { students: 4, professionals: 1 }, methods: ['CREDIT_CARD', 'PIX'],
  plans: [
    { code: 'GYM_FREE', name: 'Academia Grátis', priceCents: 0, limits: { maxStudents: 10, maxProfessionals: 1, aiMonthlyMessages: 100 }, purchasable: false },
    { code: 'GYM_START', name: 'Academia Start', priceCents: 19900, limits: { maxStudents: 100, maxProfessionals: 5, aiMonthlyMessages: 1500 }, purchasable: true },
    { code: 'GYM_PRO', name: 'Academia Pro', priceCents: null, limits: { maxStudents: 500, maxProfessionals: 25, aiMonthlyMessages: 8000 }, purchasable: false }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  api.orgDashboard.mockResolvedValue({ members: { active: 3, invited: 1, byRole: {} }, students: { active: 2, joinedLast30Days: 1 }, professionals: { active: 1 } })
  api.orgMembers.mockResolvedValue([])
  api.aiContext.mockResolvedValue({ tenantId: null, hasGuidance: false })
  api.setAiContext.mockResolvedValue({})
  api.orgBilling.mockResolvedValue(BILLING)
  api.orgAiUsage.mockResolvedValue({ month: '2026-11', enabled: true, cap: 2000, messages: 12, inputTokens: 900, outputTokens: 300, estimatedCostUsd: null, members: [{ userId: 'u1', name: 'Ana', messages: 12 }] })
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('Academias', () => {
  it('lista o espaço pessoal, convites pendentes e as academias do usuário', async () => {
    api.orgContexts.mockResolvedValue({
      personal: { id: 'personal', name: 'Eu' },
      gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'PERSONAL_TRAINER', status: 'ACTIVE' }, { id: 'g2', name: 'Beta', slug: 'beta', role: 'STUDENT', status: 'INVITED' }]
    })
    await mount(<Gyms />)
    expect(host.textContent).toContain('Espaço pessoal')
    expect(host.textContent).toContain('Alfa')
    expect(host.textContent).toContain('Aceitar convite')
    const accept = [...host.querySelectorAll('button')].find(b => b.textContent === 'Aceitar convite')
    await act(async () => { accept.click() }); await flush()
    expect(api.acceptOrgInvite).toHaveBeenCalledWith('g2')
  })

  it('cria uma academia e vai para o painel dela', async () => {
    api.orgContexts.mockResolvedValue({ personal: { id: 'personal', name: 'Eu' }, gyms: [] })
    api.createOrg.mockResolvedValue({ id: 'novo', name: 'Nova' })
    await mount(<Gyms />)
    const input = host.querySelector('#gym-name')
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(input, 'Nova'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(api.createOrg).toHaveBeenCalledWith('Nova')
    expect(m.nav).toHaveBeenCalledWith('/academias/novo')
  })

  it('quem gerencia vê só um atalho para o portal da academia, não as telas de gestão', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'GYM_OWNER', status: 'ACTIVE' }] })
    await mount(<Gym />)
    expect(host.textContent).toContain('Você gerencia esta academia')
    expect([...host.querySelectorAll('[role=tab]')]).toHaveLength(0)
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Abrir o portal da academia').click() })
    expect(m.nav).toHaveBeenCalledWith('/academia/g1')
  })

  it('o personal da academia vê o atalho do portal do personal', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'PERSONAL_TRAINER', status: 'ACTIVE' }] })
    await mount(<Gym />)
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Abrir o portal do personal').click() })
    expect(m.nav).toHaveBeenCalledWith('/personal')
  })

  it('o aluno vê a escolha da orientação da IA e sai da academia, sem nenhuma tela de gestão', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'STUDENT', status: 'ACTIVE' }] })
    await mount(<Gym />)
    expect(host.textContent).toContain('A academia não vê suas conversas')
    expect(host.textContent).not.toContain('portal')
    const box = host.querySelector('input[type=checkbox]')
    await act(async () => { box.click() }); await flush()
    expect(api.setAiContext).toHaveBeenCalledWith('g1')
    window.confirm = vi.fn(() => true)
    api.leaveOrg.mockResolvedValue({})
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Sair desta academia').click() }); await flush()
    expect(api.leaveOrg).toHaveBeenCalledWith('g1')
  })

  it('uma academia que não é do usuário aparece como não encontrada', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'outra', name: 'X', slug: 'x', role: 'STUDENT', status: 'ACTIVE' }] })
    await mount(<Gym />)
    expect(host.textContent).toContain('Academia não encontrada')
  })
})
