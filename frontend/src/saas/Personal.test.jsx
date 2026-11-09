// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Personal from './Personal.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ S: { unit: 'kg', routines: [{ id: 'r1', name: 'Push Day', ex: [{ id: '0025' }] }] }, update: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../store/useStore.js', () => {
  const useStore = sel => sel({ S: m.S, update: m.update })
  return { useStore }
})
vi.mock('../lib/routine-link.js', () => ({
  routineLinkBundle: vi.fn((S, r, o) => ({ opengym_plan: 1, routines: [{ name: r.name, ex: r.ex }], from: o.from })),
  readRoutineBundle: vi.fn(b => ({ ...b, parsed: true })),
  importRoutineLink: vi.fn()
}))
vi.mock('./api.js', () => ({
  errorText: (e, f) => f,
  trainerProfile: vi.fn(), saveTrainerProfile: vi.fn(), trainerLinks: vi.fn(), inviteStudent: vi.fn(), requestTrainer: vi.fn(),
  answerLink: vi.fn(), endLink: vi.fn(), trainerAssignments: vi.fn(), assignWorkout: vi.fn(), answerAssignment: vi.fn(),
  assignmentComments: vi.fn(), addAssignmentComment: vi.fn()
}))
import * as api from './api.js'
import * as link from '../lib/routine-link.js'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const mount = async () => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<Personal />) }); await flush() }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const type = async (el, value) => { await act(async () => { const set = Object.getOwnPropertyDescriptor(el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }) }

beforeEach(() => {
  vi.clearAllMocks()
  api.assignmentComments.mockResolvedValue([])
  api.trainerProfile.mockResolvedValue({ userId: 't', displayName: 'Prof. Ana', bio: '', specialties: [] })
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('Personal trainer', () => {
  it('o aluno aceita o convite do personal e adiciona o treino recebido às suas rotinas', async () => {
    api.trainerLinks.mockResolvedValue([
      { id: 'l1', side: 'STUDENT', status: 'PENDING', initiatedBy: 'TRAINER', other: { name: 'Prof. Ana', email: 'a@x.com' } },
      { id: 'l2', side: 'STUDENT', status: 'ACTIVE', initiatedBy: 'STUDENT', other: { name: 'Prof. Caio', email: 'c@x.com' } }
    ])
    api.trainerAssignments.mockResolvedValue([{ id: 'a1', linkId: 'l2', title: 'Treino A', note: 'Foque na técnica', status: 'ASSIGNED', revision: 1, createdAt: '2026-11-09T10:00:00Z', bundle: { opengym_plan: 1, routines: [{ name: 'Treino A', ex: [{ id: '0025' }] }] } }])
    await mount()
    expect(host.textContent).toContain('Convidou você para ser aluno')
    await act(async () => { host.querySelectorAll('button').forEach(b => { if (b.textContent === 'Aceitar') b.click() }) }); await flush()
    expect(api.answerLink).toHaveBeenCalledWith('l1', true)
    await act(async () => { btn('Adicionar às minhas rotinas').click() }); await flush()
    expect(link.readRoutineBundle).toHaveBeenCalled()
    expect(m.update).toHaveBeenCalled()
    expect(api.answerAssignment).toHaveBeenCalledWith('a1', 'IMPORTED')
  })

  it('o personal envia uma das suas rotinas a um aluno ativo, sem pesos', async () => {
    api.trainerLinks.mockResolvedValue([{ id: 'l9', side: 'TRAINER', status: 'ACTIVE', initiatedBy: 'TRAINER', other: { name: 'Beto', email: 'b@x.com' } }])
    api.trainerAssignments.mockResolvedValue([])
    api.assignWorkout.mockResolvedValue({})
    await mount()
    await act(async () => { btn('Enviar treino').click() })
    await type(host.querySelector('select[aria-label="Rotina a enviar"]'), 'r1')
    await act(async () => { btn('Enviar treino').click() }); await flush()
    expect(link.routineLinkBundle).toHaveBeenCalledWith(m.S, m.S.routines[0], { weights: false, from: 'Prof. Ana' })
    expect(api.assignWorkout).toHaveBeenCalledWith('l9', 'Push Day', '', expect.objectContaining({ from: 'Prof. Ana' }))
  })

  it('sem perfil profissional não há como convidar alunos', async () => {
    api.trainerProfile.mockResolvedValue(null)
    api.trainerLinks.mockResolvedValue([])
    api.trainerAssignments.mockResolvedValue([])
    await mount()
    expect(host.textContent).toContain('Virar personal trainer')
    expect(host.textContent).not.toContain('Convidar aluno')
  })
})
