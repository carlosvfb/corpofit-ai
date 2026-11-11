// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrainingEvolution from './TrainingEvolution.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const mount = async el => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => { root.render(el) }) }
afterEach(() => { act(() => root?.unmount()); host?.remove() })
const iso = n => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const base = { routines: [{ id: 'r1', name: 'A', ex: [] }], week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] }, coach: { profile: { daysPerWeek: 3 } } }

describe('evolução do treino pela frequência', () => {
  it('quem sumiu há semanas vê que vai recomeçar mais leve', async () => {
    const onReview = vi.fn()
    await mount(<TrainingEvolution S={{ ...base, workouts: [{ d: iso(40) }, { d: iso(45) }] }} onReview={onReview} />)
    expect(host.querySelector('[data-evolution]').dataset.evolution).toBe('reset')
    expect(host.textContent).toContain('Recomeçar mais leve')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('mais leve')).click() })
    expect(onReview).toHaveBeenCalled()
  })
  it('quem treinou pouco fica em manter; sem nada registrado também', async () => {
    await mount(<TrainingEvolution S={{ ...base, workouts: [{ d: iso(2) }] }} onReview={() => {}} />)
    expect(host.querySelector('[data-evolution]').dataset.evolution).toBe('hold')
    expect(host.textContent).toContain('Mantendo o treino')
    act(() => root.unmount()); host.remove()
    await mount(<TrainingEvolution S={{ ...base, workouts: [] }} />)
    expect(host.querySelector('[data-evolution]').dataset.evolution).toBe('hold')
  })
  it('sem rotinas nem treinos, não mostra nada', async () => {
    await mount(<TrainingEvolution S={{ routines: [], workouts: [] }} />)
    expect(host.querySelector('[data-evolution]')).toBeNull()
  })
})
