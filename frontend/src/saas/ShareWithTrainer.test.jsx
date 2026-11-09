// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShareWithTrainer, { clearShareCache } from './ShareWithTrainer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./api.js', () => ({ errorText: (e, f) => f, trainerLinks: vi.fn(), myPermissions: vi.fn(), setPermission: vi.fn() }))
import * as api from './api.js'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const mount = async el => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(el) }); await flush() }
beforeEach(() => { vi.clearAllMocks(); clearShareCache(); api.trainerLinks.mockResolvedValue([{ id: 'l1', side: 'STUDENT', status: 'ACTIVE', other: { id: 't1', name: 'Prof. Ana' } }]) })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('compartilhar com o personal, dentro das telas do aluno', () => {
  it('sem personal vinculado não mostra nada', async () => {
    api.trainerLinks.mockResolvedValue([]); api.myPermissions.mockResolvedValue([])
    await mount(<ShareWithTrainer categories={['BODY_WEIGHT']} what="seu peso" key="a" />)
    expect(host.querySelector('[data-share-trainer]')).toBeNull()
  })
  it('um toque libera só as categorias daquela tela; outro toque revoga', async () => {
    api.myPermissions.mockResolvedValue([{ trainerId: 't1', grants: { BODY_WEIGHT: 'OFF', MEASUREMENTS: 'OFF' } }])
    await mount(<ShareWithTrainer categories={['BODY_WEIGHT', 'MEASUREMENTS']} what="seu peso e suas medidas" key="b" />)
    expect(host.textContent).toContain('Quer que Prof. Ana acompanhe seu peso e suas medidas?')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Enviar ao personal').click() }); await flush()
    expect(api.setPermission.mock.calls).toEqual([['t1', 'BODY_WEIGHT', 'SEE'], ['t1', 'MEASUREMENTS', 'SEE']])
    api.myPermissions.mockResolvedValue([{ trainerId: 't1', grants: { BODY_WEIGHT: 'SEE', MEASUREMENTS: 'SEE' } }])
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Enviar ao personal')?.click() }); await flush()
  })
})
