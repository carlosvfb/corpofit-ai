// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Library from './Library.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ S: { unit: 'kg', routines: [{ id: 'r1', name: 'Push Day', ex: [{ id: '0025', weight: 80 }] }] }, update: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ S: m.S, update: m.update }) }))
vi.mock('../lib/routine-link.js', () => ({
  routineLinkBundle: vi.fn((S, r) => ({ opengym_plan: 1, routines: [{ name: r.name, ex: r.ex }] })),
  readRoutineBundle: vi.fn(b => ({ ...b, parsed: true })),
  importRoutineLink: vi.fn()
}))
vi.mock('./api.js', () => ({
  errorText: (e, f) => f,
  communityItems: vi.fn(), communityItem: vi.fn(), publishItem: vi.fn(), removeItem: vi.fn(), favoriteItem: vi.fn(),
  importCommunityItem: vi.fn(), reportItem: vi.fn(), moderationQueue: vi.fn(), moderateItem: vi.fn(), orgContexts: vi.fn()
}))
import * as api from './api.js'
import * as link from '../lib/routine-link.js'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const mount = async () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<Library />) }); await flush() }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const tab = text => [...host.querySelectorAll('[role=tab]')].find(b => b.textContent === text)
const type = async (el, value, ev = 'input') => { await act(async () => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : ev, { bubbles: true })) }) }

const ITEM = { id: 'i1', kind: 'ROUTINE', title: 'Push Day de 45 minutos', description: 'Peito e ombro', status: 'PUBLISHED', visibility: 'PUBLIC', imports: 3, author: 'Ana', mine: false, favorited: false }

beforeEach(() => {
  vi.clearAllMocks()
  api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', role: 'GYM_OWNER', status: 'ACTIVE' }] })
  api.communityItems.mockResolvedValue([ITEM])
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('Biblioteca', () => {
  it('lista os itens, mostra a origem e favorita', async () => {
    api.favoriteItem.mockResolvedValue({})
    await mount()
    expect(host.textContent).toContain('Push Day de 45 minutos')
    expect(host.textContent).toContain('por Ana')
    await act(async () => { btn('Favoritar').click() }); await flush()
    expect(api.favoriteItem).toHaveBeenCalledWith('i1', true)
  })

  it('importa a rotina pelo mesmo caminho dos links de amigos e nunca sobrescreve', async () => {
    api.importCommunityItem.mockResolvedValue({ id: 'i1', author: 'Ana', bundle: { routines: [{ name: 'Push Day', ex: [{ id: '0025' }] }] } })
    await mount()
    await act(async () => { btn('Adicionar às minhas rotinas').click() }); await flush()
    expect(link.readRoutineBundle).toHaveBeenCalledWith(expect.objectContaining({ from: 'Ana' }), 'kg')
    expect(m.update).toHaveBeenCalled()
    expect(host.textContent).toContain('Rotina adicionada')
  })

  it('denuncia com o motivo escolhido', async () => {
    api.reportItem.mockResolvedValue({})
    await mount()
    await act(async () => { btn('Denunciar').click() })
    await type(host.querySelector('select[aria-label="Motivo da denúncia"]'), 'COPYRIGHT')
    await act(async () => { btn('Enviar denúncia').click() }); await flush()
    expect(api.reportItem).toHaveBeenCalledWith('i1', 'COPYRIGHT', '')
  })

  it('o próprio conteúdo se remove, não se denuncia', async () => {
    api.communityItems.mockResolvedValue([{ ...ITEM, mine: true }])
    await mount()
    expect(btn('Denunciar')).toBeUndefined()
    expect(btn('Remover')).toBeTruthy()
  })

  it('publicar uma rotina exige a declaração de direitos e envia sem pesos', async () => {
    api.publishItem.mockResolvedValue({})
    await mount()
    await act(async () => { tab('Publicar').click() }); await flush()
    expect(host.querySelector('form button[type=submit]').disabled).toBe(true)
    await type(host.querySelector('input[aria-label="Título"]'), 'Meu Push')
    await type(host.querySelector('select[aria-label="Rotina a publicar"]'), 'r1')
    expect(host.querySelector('form button[type=submit]').disabled).toBe(true) // falta a declaração
    await act(async () => { host.querySelector('input[type=checkbox]').click() })
    expect(host.querySelector('form button[type=submit]').disabled).toBe(false)
    await act(async () => { host.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) }); await flush()
    expect(link.routineLinkBundle).toHaveBeenCalledWith(m.S, m.S.routines[0], { weights: false, from: '' })
    expect(api.publishItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ROUTINE', title: 'Meu Push', rightsConfirmed: true, visibility: 'PUBLIC' }))
  })

  it('só dono e admin de academia veem a moderação e decidem', async () => {
    api.moderationQueue.mockResolvedValue([{ id: 'i9', kind: 'TIP', title: 'Dica ruim', author: 'Beto', status: 'PUBLISHED', reports: [{ id: 'r1', reason: 'SPAM', note: 'propaganda', at: '2026-11-09T10:00:00Z' }] }])
    api.moderateItem.mockResolvedValue({})
    await mount()
    await act(async () => { tab('Moderação').click() }); await flush()
    expect(host.textContent).toContain('Dica ruim')
    expect(host.textContent).toContain('propaganda')
    await act(async () => { btn('Ocultar').click() }); await flush()
    expect(api.moderateItem).toHaveBeenCalledWith('i9', 'hide', 'g1')
  })

  it('quem não modera nenhuma academia não vê a aba de moderação', async () => {
    api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Alfa', role: 'PERSONAL_TRAINER', status: 'ACTIVE' }] })
    await mount()
    expect(tab('Moderação')).toBeUndefined()
  })
})
