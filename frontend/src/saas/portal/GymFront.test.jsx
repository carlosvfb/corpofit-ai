// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GymPortal from './GymPortal.jsx'
import MyGym from '../MyGym.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const st = vi.hoisted(() => ({ user: { id: 'u1', name: 'Rita', admin: false }, signOut: vi.fn() }))
vi.mock('../../store/useStore.js', () => { const useStore = sel => sel(st); useStore.getState = () => ({ ...st, S: {} }); return { useStore } })
vi.mock('../../components/QrCanvas.jsx', () => ({ default: ({ value }) => <div data-qr={value} /> }))
vi.mock('../Library.jsx', () => ({ Moderation: () => null, default: () => null }))
vi.mock('../api.js', () => {
  const names = ['errorText', 'orgContexts', 'createOrg', 'acceptOrgInvite', 'orgMembers', 'inviteOrgMember', 'changeOrgRole', 'removeOrgMember', 'cancelPendingInvite', 'orgDashboard', 'orgSettings', 'saveOrgSettings', 'orgActivity', 'orgAiUsage', 'orgBilling',
    'gymRoster', 'assignGymTrainer', 'gymSchedule', 'gymWorkouts', 'communityItems', 'gymPlans', 'saveGymPlan', 'gymStudents', 'enrollStudent', 'gymStudent', 'updateGymStudent', 'setGymStudentStatus', 'gymCharges', 'generateGymCharges', 'payGymCharge', 'cancelGymCharge',
    'setFaceConsent', 'saveFacePhoto', 'facePhotoUrl', 'gymEquipment', 'saveGymEquipment', 'deleteGymEquipment', 'gymDevices', 'createGymDevice', 'updateGymDevice', 'deleteGymDevice', 'gymAccessEvents', 'myGym', 'revokeMyFace']
  const o = Object.fromEntries(names.map(n => [n, vi.fn()]))
  o.errorText = (e, f) => f
  o.facePhotoUrl = () => '/face.jpg'
  return o
})
import * as api from '../api.js'

let host, root
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve() }) }
const Where = () => <span data-where>{useLocation().pathname}</span>
const mount = async (path, el = <GymPortal />) => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/academia/*" element={<>{el}<Where /></>} /><Route path="/minha-academia" element={el} /></Routes></MemoryRouter>) }); await flush() }
const where = () => host.querySelector('[data-where]')?.textContent
const navText = () => [...host.querySelectorAll('.dk-side nav a')].map(a => a.textContent)
const btn = t => [...host.querySelectorAll('button')].find(b => b.textContent === t)
const setVal = async (el, v) => { await act(async () => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement; Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }) }
const check = async el => { await act(async () => { el.click() }) }

const student = { id: 's1', number: 7, fullName: 'Bia Souza', email: 'bia@x.com', status: 'ENROLLED', hasAccount: false, plan: { id: 'p1', name: 'Mensal', priceCents: 12900 }, billingDay: 10, graceDays: 3, birthDate: '1995-04-10', healthNotes: '', phone: '11999', document: '52998224725', address: '', guardianName: '', guardianDocument: '', notes: '', emergencyName: '', emergencyPhone: '', accessCode: 'ac_abc', access: { allowed: true, label: 'Liberado (matrícula recente)' }, faceConsentAt: null, hasFacePhoto: false, termsAcceptedAt: '2026-11-10T10:00:00Z', trainingConsentAt: '2026-11-10T10:00:00Z', charges: [{ id: 'c1', description: 'Mensalidade Mensal (matrícula)', amountCents: 12900, dueDate: '2026-11-10', status: 'PENDING', overdue: false }] }

beforeEach(() => {
  vi.clearAllMocks()
  api.orgContexts.mockResolvedValue({ personal: {}, gyms: [{ id: 'g1', name: 'Forte', role: 'RECEPTIONIST', status: 'ACTIVE' }, { id: 'g2', name: 'Forte Dois', role: 'GYM_MANAGER', status: 'ACTIVE' }] })
  api.gymPlans.mockResolvedValue([{ id: 'p1', name: 'Mensal', priceCents: 12900, description: '', active: true }])
  api.gymStudents.mockResolvedValue([{ ...student, access: undefined }])
  api.gymStudent.mockResolvedValue(student)
  api.gymCharges.mockResolvedValue([{ id: 'c1', description: 'Mensalidade Mensal', amountCents: 12900, dueDate: '2026-11-10', status: 'PENDING', overdue: true, student: { id: 's1', number: 7, name: 'Bia Souza' } }])
  api.gymEquipment.mockResolvedValue([{ id: 'e1', number: 12, name: 'Leg press 45', category: 'Pernas', muscles: ['quadríceps'], exerciseIds: [], location: 'Térreo', status: 'ACTIVE', notes: '' }])
  api.gymAccessEvents.mockResolvedValue([{ id: 'v1', at: '2026-11-10T12:00:00Z', allowed: false, reason: 'MENSALIDADE_ATRASADA', method: 'QR', direction: 'IN', student: { id: 's1', name: 'Bia Souza', number: 7 }, device: 'Catraca' }])
  api.gymDevices.mockResolvedValue([])
  api.orgDashboard.mockResolvedValue({ members: { active: 3, invited: 0 }, students: { active: 1, joinedLast30Days: 1 }, professionals: { active: 1 } })
  api.gymRoster.mockResolvedValue({ summary: { students: 1, withoutTrainer: 1, withTrainer: 0, waitingStudent: 0, trainers: 0, activeLinks: 0, sessionsNext7Days: 0, doneLast30: 0, missedLast30: 0 }, students: [], team: [] })
})
afterEach(() => { act(() => root?.unmount()); host?.remove() })

describe('recepção da academia', () => {
  it('a recepção vê só o que é dela: recepção, mensalidades, aparelhos e acesso; o gerente vê também a gestão', async () => {
    await mount('/academia/g1/recepcao')
    const rec = navText()
    expect(rec).toEqual(expect.arrayContaining(['Recepção e matrícula', 'Mensalidades e planos', 'Aparelhos', 'Acesso (catraca)']))
    expect(rec).not.toContain('Configurações'); expect(rec).not.toContain('Equipe'); expect(rec).not.toContain('Visão geral')
    act(() => root.unmount()); host.remove()
    await mount('/academia/g2/geral')
    expect(navText()).toEqual(expect.arrayContaining(['Visão geral', 'Recepção e matrícula', 'Alunos', 'Equipe', 'Aparelhos']))
  })

  it('nova matrícula: exige o termo, envia o cadastro completo e abre a ficha do aluno', async () => {
    api.enrollStudent.mockResolvedValue({ ...student })
    await mount('/academia/g1/recepcao')
    expect(host.textContent).toContain('Bia Souza')
    await act(async () => { btn('Nova matrícula').click() }); await flush()
    const input = label => [...host.querySelectorAll('label')].find(l => l.textContent.startsWith(label)).querySelector('input,select,textarea')
    await setVal(input('Nome completo'), 'Bia Souza'); await setVal(input('E-mail'), 'bia@x.com'); await setVal(input('CPF'), '52998224725'); await setVal(input('Plano'), 'p1')
    expect(btn('Matricular').disabled).toBe(true) // sem o aceite do termo
    await check([...host.querySelectorAll('input[type=checkbox]')][0])
    await act(async () => { btn('Matricular').click() }); await flush()
    expect(api.enrollStudent).toHaveBeenCalledTimes(1)
    const [gym, body] = api.enrollStudent.mock.calls[0]
    expect(gym).toBe('g1'); expect(body).toMatchObject({ fullName: 'Bia Souza', email: 'bia@x.com', document: '52998224725', planId: 'p1', termsAccepted: true, billingDay: 10 })
    expect(where()).toBe('/academia/g1/recepcao/s1')
  })

  it('ficha: registra pagamento escolhendo a forma, mostra o QR e pede o consentimento antes da foto', async () => {
    api.payGymCharge.mockResolvedValue({})
    api.setFaceConsent.mockResolvedValue({})
    await mount('/academia/g1/recepcao/s1')
    expect(host.textContent).toContain('Matrícula nº 7'); expect(host.querySelector('[data-qr="ac_abc"]')).toBeTruthy()
    expect(btn('Tirar foto')).toBeUndefined() // ainda sem consentimento
    await act(async () => { btn('Registrar pagamento').click() }); await flush()
    await setVal(host.querySelector('select[aria-label="Forma de pagamento"]'), 'CARTAO_MAQUININHA')
    await act(async () => { btn('Confirmar').click() }); await flush()
    expect(api.payGymCharge).toHaveBeenCalledWith('g1', 'c1', 'CARTAO_MAQUININHA')
    window.confirm = () => true
    await act(async () => { btn('Registrar consentimento do aluno').click() }); await flush()
    expect(api.setFaceConsent).toHaveBeenCalledWith('g1', 's1', true)
  })

  it('mensalidades em atraso aparecem; aparelhos e acesso listam os registros', async () => {
    await mount('/academia/g1/mensalidades')
    expect(host.textContent).toContain('Em atraso'); expect(host.textContent).toContain('Bia Souza')
    act(() => root.unmount()); host.remove()
    await mount('/academia/g1/aparelhos')
    expect(host.textContent).toContain('Leg press 45'); expect(host.textContent).not.toContain('Novo aparelho') // recepção só lê
    act(() => root.unmount()); host.remove()
    await mount('/academia/g1/acesso')
    expect(host.textContent).toContain('Mensalidade em atraso'); expect(host.textContent).not.toContain('Catracas e leitores')
    act(() => root.unmount()); host.remove()
    await mount('/academia/g2/aparelhos')
    expect(host.textContent).toContain('Novo aparelho')
    act(() => root.unmount()); host.remove()
    api.createGymDevice.mockResolvedValue({ id: 'd1', name: 'Catraca', token: 'gd_segredo' })
    await mount('/academia/g2/acesso')
    expect(host.textContent).toContain('Catracas e leitores')
    await setVal(host.querySelector('input[aria-label="Nome do leitor"]'), 'Catraca')
    await act(async () => { btn('Cadastrar leitor').click() }); await flush()
    expect(api.createGymDevice).toHaveBeenCalledWith('g2', 'Catraca'); expect(host.textContent).toContain('gd_segredo')
  })

  it('app do aluno: matrícula, QR, mensalidades, aparelhos e retirada do consentimento da foto', async () => {
    api.myGym.mockResolvedValue([{ gymId: 'g1', gym: 'Forte', number: 7, status: 'ACTIVE', accessCode: 'ac_abc', plan: { name: 'Mensal', priceCents: 12900 }, billingDay: 10, access: { allowed: true, label: 'Liberado' }, charges: [{ id: 'c1', description: 'Mensalidade', amountCents: 12900, dueDate: '2026-11-10', status: 'PAID' }], hasFacePhoto: true, faceConsentAt: '2026-11-10T10:00:00Z', trainingConsentAt: null }])
    api.revokeMyFace.mockResolvedValue({ revoked: true })
    window.confirm = () => true
    await mount('/minha-academia', <MyGym />)
    expect(host.textContent).toContain('Forte'); expect(host.textContent).toContain('Matrícula nº 7'); expect(host.textContent).toContain('Aparelho 12'); expect(host.querySelector('[data-qr="ac_abc"]')).toBeTruthy()
    await act(async () => { btn('Retirar consentimento e apagar a foto').click() }); await flush()
    expect(api.revokeMyFace).toHaveBeenCalledWith('g1')
  })
})
