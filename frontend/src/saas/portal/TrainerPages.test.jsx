// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Agenda, StudentDetail, StudentsHome, WorkoutBuilder } from './TrainerPages.jsx'
import { SessionRow } from '../Sessions.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const st = vi.hoisted(() => ({ S: { unit: 'kg', routines: [], customEx: [] } }))
vi.mock('../../sheets.jsx', () => ({ exercisePicker: vi.fn(), exConfigSheet: vi.fn() }))
vi.mock('../../store/useStore.js', () => ({ useStore: sel => sel(st) }))
vi.mock('../api.js', () => ({
  errorText: (e, f) => f,
  trainerOverview: vi.fn(), trainerLinks: vi.fn(), trainerSessions: vi.fn(), trainerAssignments: vi.fn(), answerLink: vi.fn(), inviteStudent: vi.fn(), endLink: vi.fn(),
  createSessions: vi.fn(), updateSession: vi.fn(), answerSession: vi.fn(), cancelSession: vi.fn(), assignWorkout: vi.fn(), updateAssignment: vi.fn(),
  trainerNotes: vi.fn(), addTrainerNote: vi.fn(), deleteTrainerNote: vi.fn(), sharedWithMe: vi.fn(), shareCategories: vi.fn(), readStudentData: vi.fn(),
  assignmentComments: vi.fn(), addAssignmentComment: vi.fn(), saveTrainerProfile: vi.fn(), trainerProfile: vi.fn(), assignSuggestion: vi.fn(), answerAssignment: vi.fn(),
  applyPreset: vi.fn(), myPermissions: vi.fn()
}))
import * as api from '../api.js'
import * as sh from '../../sheets.jsx'

let host, root
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
const mount = async (el, path = '/') => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>) }); await flush() }
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const proto = el => (el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : el.tagName === 'SELECT' ? HTMLSelectElement : HTMLInputElement).prototype
const type = async (el, value) => { await act(async () => { Object.getOwnPropertyDescriptor(proto(el), 'value').set.call(el, value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }) }
const soon = h => new Date(Date.now() + h * 3_600_000).toISOString()
const session = (o = {}) => ({ id: 's1', linkId: 'l1', title: 'Treino de pernas', startsAt: soon(24), endsAt: soon(25), durationMin: 60, place: 'Sala 2', note: '', status: 'PLANNED', student: 'Bia', trainer: 'Ana', seriesId: null, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  api.trainerAssignments.mockResolvedValue([]); api.assignmentComments.mockResolvedValue([]); api.sharedWithMe.mockResolvedValue([]); api.shareCategories.mockResolvedValue([])
  api.trainerSessions.mockResolvedValue([]); api.trainerNotes.mockResolvedValue([]); api.trainerLinks.mockResolvedValue([])
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('portal do personal: alunos, agenda, ficha e montador', () => {
  it('lista de alunos mostra os sinais de atenção, o último treino e o próximo treino marcado', async () => {
    api.trainerOverview.mockResolvedValue([
      { linkId: 'l1', name: 'Bia', shares: 'ACTIVITY', lastWorkoutDay: '2026-10-20', daysSinceLastWorkout: 20, workoutsLast4Weeks: 2, nextSession: { id: 's', title: 'Treino A', startsAt: soon(30), status: 'PLANNED' }, flags: ['inactive'], pendingAssignments: 1 },
      { linkId: 'l2', name: 'Caio', shares: null, lastWorkoutDay: null, workoutsLast4Weeks: null, nextSession: null, flags: [], pendingAssignments: 0 }
    ])
    await mount(<StudentsHome />)
    const t = host.textContent
    expect(t).toContain('Está sem treinar'); expect(t).toContain('há 20 dias'); expect(t).toContain('Treino A'); expect(t).toContain('aguardando confirmação')
    expect(t).toContain('Frequência não compartilhada pelo aluno'); expect(t).toContain('Nenhum treino marcado')
  })

  it('agenda: calendário mensal; tocar no dia mostra os compromissos dele e permite marcar nele', async () => {
    const noon = h => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString() }
    api.trainerOverview.mockResolvedValue([{ linkId: 'l1', name: 'Bia', flags: [] }])
    api.trainerSessions.mockResolvedValue([session({ id: 'a', title: 'Treino de pernas', startsAt: noon(8), endsAt: noon(9) }), session({ id: 'b', title: 'Avaliação física', startsAt: noon(15), endsAt: noon(16), status: 'CONFIRMED' })])
    api.createSessions.mockResolvedValue([session()])
    await mount(<Agenda />)
    expect(host.querySelectorAll('.cal-d').length).toBeGreaterThanOrEqual(28)
    expect(host.querySelectorAll('.cal-d.sel .cal-dots i').length).toBe(2)
    expect(host.textContent).toContain('2 compromissos'); expect(host.textContent).toContain('Treino de pernas'); expect(host.textContent).toContain('Avaliação física')
    const other = [...host.querySelectorAll('.cal-d')].find(b => !b.classList.contains('sel') && b.querySelectorAll('i').length === 0)
    await act(async () => { other.click() }); await flush()
    expect(host.textContent).toContain('Nenhum compromisso')
    await act(async () => { btn('Marcar neste dia').click() }); await flush()
    await type(host.querySelector('input[aria-label="Nome do treino"]'), 'Treino B')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Marcar' && b.type === 'submit').click() }); await flush()
    const [linkId, body] = api.createSessions.mock.calls[0]
    expect(linkId).toBe('l1'); expect(body.title).toBe('Treino B'); expect(body.durationMin).toBe(60)
    expect(new Date(body.startsAt).toString()).not.toBe('Invalid Date')
  })

  it('o aluno confirma; o personal registra a presença depois do horário', async () => {
    const onChange = vi.fn()
    await mount(<SessionRow s={session()} role="student" onChange={onChange} />)
    await act(async () => { btn('Confirmar').click() }); await flush()
    expect(api.answerSession).toHaveBeenCalledWith('s1', 'confirm'); expect(onChange).toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
    await mount(<SessionRow s={session({ status: 'CONFIRMED', startsAt: soon(-2), endsAt: soon(-1) })} role="trainer" />)
    expect(btn('Remarcar')).toBeUndefined()
    await act(async () => { btn('Treino feito').click() }); await flush()
    expect(api.answerSession).toHaveBeenCalledWith('s1', 'done')
  })

  it('ficha do aluno: abas, aviso quando nada é compartilhado e anotação privada', async () => {
    api.trainerLinks.mockResolvedValue([{ id: 'l1', side: 'TRAINER', status: 'ACTIVE', other: { id: 'u2', name: 'Bia' } }])
    api.addTrainerNote.mockResolvedValue({ id: 'n1' })
    await mount(<Routes><Route path="/personal/aluno/:linkId" element={<StudentDetail />} /></Routes>, '/personal/aluno/l1')
    expect(host.textContent).toContain('Bia'); expect(host.textContent).toContain('Montar novo treino')
    await act(async () => { btn('Progresso').click() }); await flush()
    expect(host.textContent).toContain('ainda não compartilha nada com você')
    await act(async () => { btn('Notas').click() }); await flush()
    expect(host.textContent).toContain('o aluno nunca as vê')
    await type(host.querySelector('textarea[aria-label="Nova anotação"]'), 'Joelho direito')
    await act(async () => { btn('Salvar anotação').click() }); await flush()
    expect(api.addTrainerNote).toHaveBeenCalledWith('l1', 'Joelho direito')
  })

  it('montador: usa o seletor de exercícios do app e envia o treino configurado ao aluno', async () => {
    api.assignWorkout.mockResolvedValue({ id: 'a1' })
    const onDone = vi.fn()
    await mount(<WorkoutBuilder link={{ id: 'l1', other: { name: 'Bia' } }} onDone={onDone} onCancel={() => {}} />)
    expect(btn('Enviar ao aluno').disabled).toBe(true)
    await type(host.querySelector('input[aria-label="Nome do treino"]'), 'Treino A')
    await act(async () => { btn('Adicionar exercício').click() }); await flush()
    expect(sh.exercisePicker).toHaveBeenCalledTimes(1)
    await act(async () => { sh.exercisePicker.mock.calls[0][0]({ id: '0025' }, true) }); await flush()
    expect(host.textContent).toContain('1.')
    await act(async () => { btn('Enviar ao aluno').click() }); await flush()
    expect(api.assignWorkout).toHaveBeenCalledTimes(1)
    const [linkId, title, , bundle, reviewWeeks] = api.assignWorkout.mock.calls[0]
    expect(reviewWeeks).toBe(6)   // a ficha nova nasce com prazo de 6 semanas
    expect(linkId).toBe('l1'); expect(title).toBe('Treino A')
    expect(bundle.routines).toHaveLength(1); expect(bundle.routines[0].ex[0].id).toBe('0025')
    expect(onDone).toHaveBeenCalled()
  })
})
