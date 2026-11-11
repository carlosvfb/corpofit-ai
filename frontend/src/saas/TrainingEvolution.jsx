// Evolução do treino pela frequência: mostra se o treino pode ficar mais difícil, deve ser mantido ou recomeçar.
// É o mesmo cálculo que o servidor usa para barrar a IA (api/coach/core/attendance.js): só a frequência decide.
import { attendance } from '../../../api/coach/core/attendance.js'
import { Button } from '../components/ui.jsx'
import { todayISO } from '../lib/format.js'

const COPY = {
  advance: { icon: '📈', title: 'Pronto para evoluir', color: 'var(--green, #30d158)' },
  hold: { icon: '⏸️', title: 'Mantendo o treino', color: 'var(--orange, #ff9f0a)' },
  reset: { icon: '🔄', title: 'Recomeçar mais leve', color: 'var(--red, #ff453a)' }
}
const BUTTON = { advance: 'Pedir à IA para evoluir o treino', hold: 'Pedir uma revisão mesmo assim', reset: 'Pedir à IA um treino de volta mais leve' }

export default function TrainingEvolution({ S, onReview, disabled }) {
  const workouts = (S?.workouts || []).filter(w => w && w.d)
  if (workouts.length === 0 && !(S?.routines || []).length) return null
  const planned = Object.keys(S?.week || {}).filter(k => S.week[k]?.length).length
  const a = attendance({
    workoutDays: workouts.map(w => w.d), targetPerWeek: S?.coach?.profile?.daysPerWeek || planned || 3,
    today: todayISO(), lastAdvanceOn: S?.coach?.phase?.lastAdvanceOn || null
  })
  const c = COPY[a.verdict]
  return <div className="card" style={{ margin: '10px 0' }} data-evolution={a.verdict}>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <span aria-hidden="true" style={{ fontSize: 22 }}>{c.icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, color: c.color }}>{c.title}</div>
        <div className="small">{a.reasons[0]}</div>
      </div>
    </div>
    <div className="dim small" style={{ margin: '8px 0 6px' }}>O treino só fica mais difícil quando você treina com regularidade. Se faltar, ele fica igual até você voltar; se passar semanas sem treinar, ele recomeça mais leve.</div>
    {a.perWeek.length > 0 && <div style={{ display: 'flex', gap: 4, margin: '6px 0' }} aria-label="Treinos por semana, das mais antigas às mais recentes">
      {a.perWeek.map(w => <span key={w.weekStart} title={`Semana de ${w.weekStart}: ${w.days} treino(s)`} style={{ flex: 1, height: 8, borderRadius: 4, background: w.good ? 'var(--green, #30d158)' : w.days ? 'var(--orange, #ff9f0a)' : 'rgba(128,128,128,.3)' }} />)}
    </div>}
    {onReview && <Button variant={a.verdict === 'advance' ? 'primary' : 'tinted'} size="sm" disabled={disabled} onClick={onReview}>{BUTTON[a.verdict]}</Button>}
  </div>
}
