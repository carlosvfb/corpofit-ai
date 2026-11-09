// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Privacy from './Privacy.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('./api.js', () => ({
  errorText: (e, f) => f,
  shareCategories: vi.fn(), myPermissions: vi.fn(), trainerLinks: vi.fn(), consentHistory: vi.fn(), accessLog: vi.fn(),
  setPermission: vi.fn(), revokeAllSharing: vi.fn()
}))
import * as api from './api.js'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const mount = async () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<Privacy />) }); await flush() }
const select = label => host.querySelector(`select[aria-label="${label}"]`)
const pick = async (el, value) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })) }); await flush() }

const CATS = [
  { id: 'BODY_WEIGHT', label: 'Peso corporal', hint: 'Suas pesagens.', available: true },
  { id: 'ROUTINES', label: 'Rotinas', hint: 'Suas rotinas.', available: true, suggest: true },
  { id: 'PHOTOS', label: 'Fotos de evolução', hint: 'Ainda não pode ser compartilhada.', available: false }
]

beforeEach(() => {
  vi.clearAllMocks()
  api.shareCategories.mockResolvedValue(CATS)
  api.myPermissions.mockResolvedValue([{ linkId: 'l1', trainerId: 't1', grants: { BODY_WEIGHT: 'OFF', ROUTINES: 'SEE' } }])
  api.trainerLinks.mockResolvedValue([{ id: 'l1', side: 'STUDENT', trainerId: 't1', status: 'ACTIVE', other: { name: 'Prof. Ana' } }])
  api.consentHistory.mockResolvedValue([{ id: 'h1', trainerId: 't1', category: 'ROUTINES', from: 'OFF', to: 'SEE', action: 'GRANT', at: '2026-11-09T10:00:00Z' }])
  api.accessLog.mockResolvedValue([{ id: 'a1', actorId: 't1', category: 'ROUTINES', at: '2026-11-09T11:00:00Z' }])
  api.setPermission.mockResolvedValue({})
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('Privacidade e compartilhamento', () => {
  it('mostra, por personal, cada categoria com o nível atual e deixa tudo desligado por padrão', async () => {
    await mount()
    expect(host.textContent).toContain('Prof. Ana')
    expect(select('Peso corporal para Prof. Ana').value).toBe('OFF')
    expect(select('Rotinas para Prof. Ana').value).toBe('SEE')
    expect(select('Fotos de evolução para Prof. Ana').disabled).toBe(true)
    expect(host.textContent).toContain('Prof. Ana leu Rotinas')
    expect(host.textContent).toContain('Liberou: Rotinas')
  })

  it('só as rotinas oferecem "Ver e sugerir"', async () => {
    await mount()
    const opts = el => [...el.options].map(o => o.value)
    expect(opts(select('Rotinas para Prof. Ana'))).toEqual(['OFF', 'SEE', 'SUGGEST'])
    expect(opts(select('Peso corporal para Prof. Ana'))).toEqual(['OFF', 'SEE'])
  })

  it('mudar um nível e revogar tudo chamam a API do servidor', async () => {
    await mount()
    await pick(select('Peso corporal para Prof. Ana'), 'SEE')
    expect(api.setPermission).toHaveBeenCalledWith('t1', 'BODY_WEIGHT', 'SEE')
    window.confirm = vi.fn(() => true)
    api.revokeAllSharing.mockResolvedValue({ revoked: 1 })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Revogar tudo').click() }); await flush()
    expect(api.revokeAllSharing).toHaveBeenCalledWith('t1')
  })

  it('sem personal vinculado explica que nada é compartilhado', async () => {
    api.myPermissions.mockResolvedValue([])
    await mount()
    expect(host.textContent).toContain('nada é compartilhado')
  })
})
