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
  removeOrgMember: vi.fn(), leaveOrg: vi.fn(), aiContext: vi.fn(), setAiContext: vi.fn(), orgAiUsage: vi.fn()
}))
import * as api from './api.js'

let host, root
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() }) }
const mount = async el => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(el) }); await flush() }
const tabs = () => [...host.querySelectorAll('[role=tab]')].map(b => b.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  api.orgDashboard.mockResolvedValue({ members: { active: 3, invited: 1, byRole: {} }, students: { active: 2, joinedLast30Days: 1 }, professionals: { active: 1 } })
  api.orgMembers.mockResolvedValue([])
  api.aiContext.mockResolvedValue({ tenantId: null, hasGuidance: false })
  api.setAiContext.mockResolvedValue({})
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

  it('o painel mostra as abas conforme o papel', async () => {
    for (const [role, expected] of [
      ['GYM_OWNER', ['Visão geral', 'Membros', 'Configurações', 'Atividade', 'Uso da IA']],
      ['GYM_MANAGER', ['Visão geral', 'Membros', 'Atividade']],
      ['PERSONAL_TRAINER', ['Visão geral']],
      ['STUDENT', []]
    ]) {
      api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role, status: 'ACTIVE' }] })
      await mount(<Gym />)
      expect(tabs(), role).toEqual(expected)
      act(() => root.unmount()); host.remove()
    }
  })

  it('uma academia que não é do usuário aparece como não encontrada', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'outra', name: 'X', slug: 'x', role: 'STUDENT', status: 'ACTIVE' }] })
    await mount(<Gym />)
    expect(host.textContent).toContain('Academia não encontrada')
    expect(api.orgDashboard).not.toHaveBeenCalled()
  })

  it('o dono vê os membros e convida por e-mail com o papel escolhido', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'GYM_OWNER', status: 'ACTIVE' }] })
    api.orgMembers.mockResolvedValue([{ userId: 'u9', name: 'Ana', email: 'ana@x.com', role: 'STUDENT', status: 'ACTIVE' }])
    api.inviteOrgMember.mockResolvedValue({})
    await mount(<Gym />)
    await act(async () => { [...host.querySelectorAll('[role=tab]')].find(b => b.textContent === 'Membros').click() }); await flush()
    expect(host.textContent).toContain('Ana')
    const email = host.querySelector('input[type=email]')
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(email, 'novo@x.com'); email.dispatchEvent(new Event('input', { bubbles: true })) })
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(api.inviteOrgMember).toHaveBeenCalledWith('g1', 'novo@x.com', 'STUDENT')
  })

  it('qualquer membro escolhe usar (ou não) a orientação da academia na própria IA', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'STUDENT', status: 'ACTIVE' }] })
    await mount(<Gym />)
    const box = host.querySelector('input[type=checkbox]')
    expect(box.checked).toBe(false)
    expect(host.textContent).toContain('A academia não vê suas conversas')
    await act(async () => { box.click() }); await flush()
    expect(api.setAiContext).toHaveBeenCalledWith('g1')
  })

  it('o dono vê o consumo de IA da academia, sem conteúdo, com o custo indisponível quando não há preços', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', slug: 'alfa', role: 'GYM_OWNER', status: 'ACTIVE' }] })
    await mount(<Gym />)
    await act(async () => { [...host.querySelectorAll('[role=tab]')].find(b => b.textContent === 'Uso da IA').click() }); await flush()
    expect(api.orgAiUsage).toHaveBeenCalledWith('g1')
    expect(host.textContent).toContain('12')
    expect(host.textContent).toContain('indisponível')
    expect(host.textContent).toContain('Ana')
    expect(host.textContent).toContain('nunca vê o conteúdo')
  })
})
