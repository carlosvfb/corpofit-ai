// Recepção da academia (computador): matrícula com cadastro completo, ficha do aluno, mensalidades, aparelhos e acesso (catraca).
// A mensalidade é REGISTRADA aqui (dinheiro, Pix, maquininha): o sistema nunca recebe nem guarda número de cartão.
// A foto de acesso (biometria facial) só é feita depois do consentimento do aluno, registrado com quem o recebeu.
// O servidor confere o papel em cada chamada; aqui só se decide o que mostrar.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui.jsx'
import QrCanvas from '../../components/QrCanvas.jsx'
import { resizeToAvatar } from '../../lib/avatar-image.js'
import { Err } from '../Gyms.jsx'
import {
  cancelGymCharge, createGymDevice, deleteGymDevice, deleteGymEquipment, enrollStudent, errorText, facePhotoUrl, generateGymCharges, gymAccessEvents, gymCharges, gymDevices,
  gymEquipment, gymPlans, gymStudent, gymStudents, payGymCharge, saveFacePhoto, saveGymEquipment, saveGymPlan, setFaceConsent, setGymStudentStatus, updateGymDevice, updateGymStudent
} from '../api.js'
import { formatDate, formatDateTime } from '../brand.js'

export const brl = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const STATUS = { ENROLLED: 'Matriculado (aguardando 1º pagamento)', ACTIVE: 'Ativo', SUSPENDED: 'Suspenso', CANCELLED: 'Cancelado' }
const METHODS = [['DINHEIRO', 'Dinheiro'], ['PIX', 'Pix'], ['CARTAO_MAQUININHA', 'Cartão (maquininha)'], ['TRANSFERENCIA', 'Transferência'], ['OUTRO', 'Outro']]
const REASON = { OK: 'Liberado', SAIDA: 'Saída', NAO_ENCONTRADO: 'Não encontrado', CANCELADO: 'Matrícula cancelada', SUSPENSO: 'Suspenso', AGUARDANDO_PAGAMENTO: 'Aguardando pagamento', MENSALIDADE_ATRASADA: 'Mensalidade em atraso' }
const Chip = ({ ok, children }) => <span className="small" style={{ padding: '2px 9px', borderRadius: 10, background: ok ? 'rgba(48,209,88,.16)' : 'rgba(255,69,58,.16)', color: ok ? 'var(--green, #30d158)' : 'var(--red, #ff453a)', whiteSpace: 'nowrap' }}>{children}</span>
const Field = ({ label, children, wide }) => <label style={{ display: 'grid', gap: 4, gridColumn: wide ? '1 / -1' : undefined }}><span className="small muted">{label}</span>{children}</label>
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }
const useLoad = (fn, deps) => {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(() => fn().then(d => { setData(d); setErr(null) }).catch(e => setErr(errorText(e, 'Não foi possível carregar.'))), deps) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  return { data, err, load }
}

/* ------------------------------ matrícula e lista ------------------------------ */

const EMPTY = { fullName: '', email: '', phone: '', document: '', birthDate: '', address: '', emergencyName: '', emergencyPhone: '', healthNotes: '', guardianName: '', guardianDocument: '', planId: '', billingDay: 10, graceDays: 3, termsAccepted: false, trainingConsent: true }

function EnrollForm({ id, plans, onDone, onCancel }) {
  const [f, setF] = useState(EMPTY)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const minor = f.birthDate && (Date.now() - new Date(f.birthDate).getTime()) / 31_557_600_000 < 18
  const submit = async e => {
    e.preventDefault(); setErr(null); setBusy(true)
    try { onDone(await enrollStudent(id, { ...f, planId: f.planId || undefined, billingDay: Number(f.billingDay), graceDays: Number(f.graceDays) })) } catch (x) { setErr(errorText(x, 'Não foi possível matricular.')) } finally { setBusy(false) }
  }
  return <form className="card" onSubmit={submit} style={{ marginBottom: 16 }}>
    <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 10 }}>Nova matrícula</div>
    <Err>{err}</Err>
    <div style={grid}>
      <Field label="Nome completo *"><input className="input" required maxLength={80} value={f.fullName} onChange={set('fullName')} /></Field>
      <Field label="E-mail * (o aluno entra com ele)"><input className="input" type="email" required value={f.email} onChange={set('email')} /></Field>
      <Field label="Celular"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
      <Field label="CPF"><input className="input" inputMode="numeric" value={f.document} onChange={set('document')} /></Field>
      <Field label="Data de nascimento"><input className="input" type="date" value={f.birthDate} onChange={set('birthDate')} /></Field>
      <Field label="Endereço"><input className="input" maxLength={200} value={f.address} onChange={set('address')} /></Field>
      <Field label="Contato de emergência"><input className="input" maxLength={80} value={f.emergencyName} onChange={set('emergencyName')} /></Field>
      <Field label="Telefone de emergência"><input className="input" inputMode="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} /></Field>
      {minor && <><Field label="Responsável (menor de idade) *"><input className="input" required value={f.guardianName} onChange={set('guardianName')} /></Field>
        <Field label="CPF do responsável *"><input className="input" required inputMode="numeric" value={f.guardianDocument} onChange={set('guardianDocument')} /></Field></>}
      <Field label="Plano"><select className="input" value={f.planId} onChange={set('planId')}><option value="">Sem plano por enquanto</option>{plans.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.name} · {brl(p.priceCents)}</option>)}</select></Field>
      <Field label="Dia do vencimento"><input className="input" type="number" min={1} max={28} value={f.billingDay} onChange={set('billingDay')} /></Field>
      <Field label="Tolerância de atraso (dias)"><input className="input" type="number" min={0} max={30} value={f.graceDays} onChange={set('graceDays')} /></Field>
      <Field label="Saúde (lesões, restrições, medicamentos)" wide><textarea className="input" rows={2} maxLength={1000} value={f.healthNotes} onChange={set('healthNotes')} /></Field>
    </div>
    <label style={{ display: 'flex', gap: 8, marginTop: 12, fontSize: 14 }}><input type="checkbox" checked={f.termsAccepted} onChange={set('termsAccepted')} style={{ marginTop: 3 }} /><span>O aluno leu e aceitou o termo de matrícula e a política de privacidade da academia. <b>*</b></span></label>
    <label style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 14 }}><input type="checkbox" checked={f.trainingConsent} onChange={set('trainingConsent')} style={{ marginTop: 3 }} /><span>O aluno autoriza os professores da academia a acompanhar o treino dele.</span></label>
    <div className="dim small" style={{ marginTop: 8 }}>Depois de salvar, o aluno entra no CorpoFit AI com este e-mail (Google ou e-mail e senha, confirmando o e-mail) e já aparece vinculado à academia. A foto de acesso é feita na ficha, com o consentimento dele.</div>
    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}><Button variant="primary" type="submit" disabled={busy || !f.termsAccepted}>{busy ? 'Salvando…' : 'Matricular'}</Button><Button variant="tinted" type="button" onClick={onCancel}>Cancelar</Button></div>
  </form>
}

export function ReceptionPanel({ id, role, sub }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [creating, setCreating] = useState(false)
  const list = useLoad(() => gymStudents(id, { q, status }), [id, q, status])
  const plans = useLoad(() => gymPlans(id), [id])
  const canEnroll = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER', 'RECEPTIONIST'].includes(role)
  if (sub) return <StudentFicha id={id} sid={sub} role={role} plans={plans.data || []} onBack={() => nav(`/academia/${id}/recepcao`)} />
  return <>
    <Err>{list.err}</Err>
    {creating && <EnrollForm id={id} plans={plans.data || []} onCancel={() => setCreating(false)} onDone={s => nav(`/academia/${id}/recepcao/${s.id}`)} />}
    <div className="dk-toolbar">
      <input className="input" style={{ minWidth: 280 }} value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nome, e-mail, matrícula ou CPF" aria-label="Buscar aluno" />
      <select className="input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Situação"><option value="">Todas as situações</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      {canEnroll && !creating && <Button variant="primary" onClick={() => setCreating(true)}>Nova matrícula</Button>}
      <span className="muted small">{list.data?.length ?? 0} alunos</span>
    </div>
    {!list.data && !list.err && <div className="muted">Carregando…</div>}
    {list.data && <div className="card" style={{ padding: 0, overflow: 'auto' }}>
      <table className="dk-table">
        <thead><tr><th>Nº</th><th>Aluno</th><th>E-mail</th><th>Plano</th><th>Situação</th><th>Acesso hoje</th><th>Conta</th></tr></thead>
        <tbody>
          {list.data.map(s => <tr key={s.id} onClick={() => nav(`/academia/${id}/recepcao/${s.id}`)} style={{ cursor: 'pointer' }}>
            <td>{s.number}</td><td><b>{s.fullName}</b></td><td>{s.email}</td><td>{s.plan?.name || '–'}</td><td>{STATUS[s.status]}</td>
            <td>{s.access ? <Chip ok={s.access.allowed}>{s.access.label}</Chip> : '–'}</td><td>{s.hasAccount ? 'Já entrou' : <span className="muted">Ainda não entrou</span>}</td>
          </tr>)}
          {list.data.length === 0 && <tr><td colSpan={7} className="dim">Nenhum aluno. Use “Nova matrícula”.</td></tr>}
        </tbody>
      </table>
    </div>}
  </>
}

/* ------------------------------- ficha do aluno ------------------------------- */

function WebcamCapture({ onPhoto, onClose }) {
  const video = useRef(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let stream
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'user' } }).then(s => { stream = s; if (video.current) video.current.srcObject = s }).catch(() => setErr('Não foi possível abrir a câmera. Use “Enviar arquivo”.'))
    return () => stream?.getTracks().forEach(t => t.stop())
  }, [])
  const shoot = () => {
    const v = video.current; if (!v?.videoWidth) return
    const side = Math.min(v.videoWidth, v.videoHeight), c = document.createElement('canvas'); c.width = c.height = 320
    c.getContext('2d').drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, 320, 320)
    let out = c.toDataURL('image/jpeg', 0.8)
    for (const q of [0.65, 0.5, 0.4]) { if (out.length * 0.75 <= 70 * 1024) break; out = c.toDataURL('image/jpeg', q) }
    onPhoto(out)
  }
  return <div style={{ marginTop: 8 }}>
    <Err>{err}</Err>
    {!err && <video ref={video} autoPlay playsInline muted style={{ width: 240, height: 240, objectFit: 'cover', borderRadius: 12, background: '#000' }} />}
    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>{!err && <Button variant="primary" onClick={shoot}>Tirar foto</Button>}<Button variant="tinted" onClick={onClose}>Fechar câmera</Button></div>
  </div>
}

function StudentFicha({ id, sid, role, plans, onBack }) {
  const { data: s, err, load } = useLoad(() => gymStudent(id, sid), [id, sid])
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [cam, setCam] = useState(false)
  const [payFor, setPayFor] = useState(null)
  const [method, setMethod] = useState('DINHEIRO')
  const [photoV, setPhotoV] = useState(0)
  const file = useRef(null)
  useEffect(() => { if (s) setForm(f => f || { fullName: s.fullName, phone: s.phone || '', document: s.document || '', birthDate: s.birthDate || '', address: s.address || '', emergencyName: s.emergencyName || '', emergencyPhone: s.emergencyPhone || '', healthNotes: s.healthNotes || '', guardianName: s.guardianName || '', guardianDocument: s.guardianDocument || '', notes: s.notes || '', planId: s.plan?.id || '', billingDay: s.billingDay, graceDays: s.graceDays }) }, [s])
  const run = async (fn, ok) => { setBusy(true); setError(null); setNotice(null); try { await fn(); if (ok) setNotice(ok); await load() } catch (e) { setError(errorText(e, 'Não foi possível concluir.')) } finally { setBusy(false) } }
  if (err) return <><Err>{err}</Err><Button variant="tinted" onClick={onBack}>Voltar</Button></>
  if (!s || !form) return <div className="muted">Carregando…</div>
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const money = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER', 'RECEPTIONIST'].includes(role)
  const photo = async image => { setCam(false); await run(async () => { await saveFacePhoto(id, sid, image); setPhotoV(v => v + 1) }, 'Foto de acesso salva.') }
  const pick = async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { await photo(await resizeToAvatar(f)) } catch (x) { setError(x.message) } }
  return <>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
      <Button variant="tinted" onClick={onBack}>‹ Alunos</Button>
      <h2 style={{ margin: 0 }}>{s.fullName}</h2><span className="muted">Matrícula nº {s.number}</span>
      {s.access && <Chip ok={s.access.allowed}>{s.access.label}</Chip>}
    </div>
    <Err>{error}</Err>
    {notice && <div className="small" role="status" style={{ marginBottom: 10 }}>{notice}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 16, alignItems: 'start' }}>
      <div>
        <form className="card" onSubmit={e => { e.preventDefault(); run(() => updateGymStudent(id, sid, { ...form, planId: form.planId || null, billingDay: Number(form.billingDay), graceDays: Number(form.graceDays) }), 'Cadastro salvo.') }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Cadastro</div>
          <div style={grid}>
            <Field label="Nome completo"><input className="input" value={form.fullName} onChange={set('fullName')} /></Field>
            <Field label="E-mail (fixo: é o login do aluno)"><input className="input" value={s.email} disabled /></Field>
            <Field label="Celular"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
            <Field label="CPF"><input className="input" value={form.document} onChange={set('document')} /></Field>
            <Field label="Nascimento"><input className="input" type="date" value={form.birthDate} onChange={set('birthDate')} /></Field>
            <Field label="Endereço"><input className="input" value={form.address} onChange={set('address')} /></Field>
            <Field label="Contato de emergência"><input className="input" value={form.emergencyName} onChange={set('emergencyName')} /></Field>
            <Field label="Telefone de emergência"><input className="input" value={form.emergencyPhone} onChange={set('emergencyPhone')} /></Field>
            <Field label="Responsável (se menor)"><input className="input" value={form.guardianName} onChange={set('guardianName')} /></Field>
            <Field label="CPF do responsável"><input className="input" value={form.guardianDocument} onChange={set('guardianDocument')} /></Field>
            <Field label="Plano"><select className="input" value={form.planId} onChange={set('planId')}><option value="">Sem plano</option>{plans.filter(p => p.active || p.id === form.planId).map(p => <option key={p.id} value={p.id}>{p.name} · {brl(p.priceCents)}</option>)}</select></Field>
            <Field label="Dia do vencimento"><input className="input" type="number" min={1} max={28} value={form.billingDay} onChange={set('billingDay')} /></Field>
            <Field label="Tolerância (dias)"><input className="input" type="number" min={0} max={30} value={form.graceDays} onChange={set('graceDays')} /></Field>
            <Field label="Saúde" wide><textarea className="input" rows={2} value={form.healthNotes} onChange={set('healthNotes')} /></Field>
            <Field label="Observações da recepção" wide><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></Field>
          </div>
          <div style={{ marginTop: 10 }}><Button variant="primary" type="submit" disabled={busy}>Salvar cadastro</Button></div>
        </form>

        {money && <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Mensalidades</div>
          <table className="dk-table"><thead><tr><th>Cobrança</th><th>Vence</th><th>Valor</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {(s.charges || []).map(c => <tr key={c.id}>
                <td>{c.description}</td><td>{formatDate(c.dueDate + 'T12:00:00')}</td><td>{brl(c.amountCents)}</td>
                <td>{c.status === 'PAID' ? <Chip ok>Pago em {formatDate(c.paidAt)} ({METHODS.find(m => m[0] === c.method)?.[1]})</Chip> : c.status === 'CANCELLED' ? <span className="muted">Cancelada</span> : c.overdue ? <Chip>Em atraso</Chip> : <span>A vencer</span>}</td>
                <td style={{ textAlign: 'end' }}>{c.status === 'PENDING' && (payFor === c.id
                  ? <span style={{ display: 'inline-flex', gap: 6 }}><select className="input" style={{ width: 'auto' }} value={method} onChange={e => setMethod(e.target.value)} aria-label="Forma de pagamento">{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <Button variant="primary" disabled={busy} onClick={() => run(async () => { await payGymCharge(id, c.id, method); setPayFor(null) }, 'Pagamento registrado.')}>Confirmar</Button></span>
                  : <><Button variant="primary" onClick={() => setPayFor(c.id)}>Registrar pagamento</Button> <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Cancelar esta cobrança?')) run(() => cancelGymCharge(id, c.id, ''), 'Cobrança cancelada.') }}>Cancelar</Button></>)}</td>
              </tr>)}
              {(s.charges || []).length === 0 && <tr><td colSpan={5} className="dim">Nenhuma cobrança. Escolha um plano e use “Gerar mensalidades do mês” em Mensalidades.</td></tr>}
            </tbody></table>
          <div className="dim small" style={{ marginTop: 8 }}>O pagamento no cartão é feito na maquininha da academia e registrado aqui. O sistema não guarda número de cartão.</div>
        </div>}
      </div>

      <div>
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Situação</div>
          <div className="small">{STATUS[s.status]}</div>
          <div className="small muted">{s.hasAccount ? 'O aluno já entrou e está vinculado.' : 'O aluno ainda não entrou com ' + s.email + '.'}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {s.status !== 'ACTIVE' && s.status !== 'CANCELLED' && <Button variant="primary" disabled={busy} onClick={() => run(() => setGymStudentStatus(id, sid, 'ACTIVE'), 'Aluno ativado.')}>{s.status === 'SUSPENDED' ? 'Reativar' : 'Ativar'}</Button>}
            {s.status === 'ACTIVE' && <Button variant="tinted" disabled={busy} onClick={() => { const r = window.prompt('Motivo da suspensão:', ''); if (r !== null) run(() => setGymStudentStatus(id, sid, 'SUSPENDED', r), 'Aluno suspenso.') }}>Suspender acesso</Button>}
            {s.status !== 'CANCELLED' && <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Cancelar a matrícula? O acesso termina agora.')) run(() => setGymStudentStatus(id, sid, 'CANCELLED', 'Cancelamento na recepção'), 'Matrícula cancelada.') }}>Cancelar matrícula</Button>}
          </div>
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Acesso (catraca)</div>
          {s.accessCode && <div style={{ display: 'grid', placeItems: 'center', margin: '6px 0' }}><QrCanvas value={s.accessCode} size={160} /></div>}
          <div className="dim small" style={{ textAlign: 'center' }}>QR de acesso. Também aparece no app do aluno, em Minha academia.</div>
          <div style={{ marginTop: 12, fontWeight: 650 }}>Foto de acesso (reconhecimento facial)</div>
          {s.faceConsentAt ? <>
            <div className="small muted">Consentimento registrado em {formatDateTime(s.faceConsentAt)}.</div>
            {s.hasFacePhoto && <img src={facePhotoUrl(id, sid) + '&v=' + photoV} alt="Foto de acesso" width={120} height={120} style={{ borderRadius: 12, objectFit: 'cover', margin: '8px 0', display: 'block' }} />}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <Button variant="primary" onClick={() => setCam(true)}>{s.hasFacePhoto ? 'Tirar outra' : 'Tirar foto'}</Button>
              <Button variant="tinted" onClick={() => file.current?.click()}>Enviar arquivo</Button>
              <Button variant="tinted" disabled={busy} onClick={() => { if (window.confirm('Revogar o consentimento e apagar a foto de acesso?')) run(() => setFaceConsent(id, sid, false), 'Consentimento revogado e foto apagada.') }}>Revogar e apagar</Button>
            </div>
            {cam && <WebcamCapture onPhoto={photo} onClose={() => setCam(false)} />}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
          </> : <>
            <div className="small" style={{ margin: '4px 0 8px' }}>A foto serve só para o reconhecimento facial na catraca. É um dado sensível: só com consentimento específico do aluno{s.guardianName ? ' (do responsável, se menor)' : ''}. Ele pode revogar quando quiser e a foto é apagada.</div>
            <Button variant="primary" disabled={busy} onClick={() => { if (window.confirm('O aluno consente, de forma livre e específica, o uso da foto dele para controle de acesso por reconhecimento facial?')) run(() => setFaceConsent(id, sid, true), 'Consentimento registrado.') }}>Registrar consentimento do aluno</Button>
          </>}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Termos</div>
          <div className="small">Termo de matrícula: {s.termsAcceptedAt ? 'aceito em ' + formatDateTime(s.termsAcceptedAt) : 'não registrado'}</div>
          <div className="small">Acompanhamento do treino pelos professores: {s.trainingConsentAt ? 'autorizado em ' + formatDateTime(s.trainingConsentAt) : 'não autorizado'}</div>
        </div>
      </div>
    </div>
  </>
}

/* -------------------------------- mensalidades -------------------------------- */

export function ChargesPanel({ id, role }) {
  const [status, setStatus] = useState('PENDING')
  const [month, setMonth] = useState('')
  const [q, setQ] = useState('')
  const [method, setMethod] = useState('DINHEIRO')
  const [payFor, setPayFor] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [tab, setTab] = useState('cobrancas')
  const list = useLoad(() => gymCharges(id, { status, month, q }), [id, status, month, q])
  const run = async (fn, ok) => { setError(null); setNotice(null); try { const r = await fn(); setNotice(typeof ok === 'function' ? ok(r) : ok); await list.load() } catch (e) { setError(errorText(e, 'Não foi possível concluir.')) } }
  const manage = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER'].includes(role)
  const sum = (list.data || []).reduce((n, c) => n + c.amountCents, 0)
  const late = (list.data || []).filter(c => c.overdue)
  return <>
    <div className="ts-tabs" role="tablist" style={{ marginBottom: 14 }}>
      <button role="tab" aria-selected={tab === 'cobrancas'} className={tab === 'cobrancas' ? 'active' : ''} onClick={() => setTab('cobrancas')}>Cobranças</button>
      <button role="tab" aria-selected={tab === 'planos'} className={tab === 'planos' ? 'active' : ''} onClick={() => setTab('planos')}>Planos</button>
    </div>
    {tab === 'planos' ? <PlansPanel id={id} manage={manage} /> : <>
      <Err>{error || list.err}</Err>
      {notice && <div className="small" role="status" style={{ marginBottom: 10 }}>{notice}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <div className="card" style={{ flex: '1 1 160px' }}><div className="muted small">Cobranças listadas</div><div style={{ fontSize: 26, fontWeight: 800 }}>{list.data?.length ?? '–'}</div><div className="dim small">{brl(sum)}</div></div>
        <div className="card" style={{ flex: '1 1 160px' }}><div className="muted small">Em atraso</div><div style={{ fontSize: 26, fontWeight: 800, color: late.length ? 'var(--red, #ff453a)' : undefined }}>{late.length}</div><div className="dim small">{brl(late.reduce((n, c) => n + c.amountCents, 0))}</div></div>
      </div>
      <div className="dk-toolbar">
        <select className="input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Situação da cobrança"><option value="PENDING">Pendentes</option><option value="PAID">Pagas</option><option value="CANCELLED">Canceladas</option><option value="">Todas</option></select>
        <input className="input" type="month" value={month} onChange={e => setMonth(e.target.value)} aria-label="Mês" />
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Aluno ou matrícula" aria-label="Buscar" />
        <Button variant="tinted" onClick={() => { if (window.confirm('Gerar as mensalidades deste mês para os alunos ativos com plano? Quem já tem a do mês não ganha outra.')) run(() => generateGymCharges(id, month || undefined), r => `${r.created} mensalidades geradas (${r.skipped} já existiam).`) }}>Gerar mensalidades do mês</Button>
      </div>
      {!list.data && !list.err && <div className="muted">Carregando…</div>}
      {list.data && <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="dk-table">
          <thead><tr><th>Aluno</th><th>Cobrança</th><th>Vence</th><th>Valor</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {list.data.map(c => <tr key={c.id}>
              <td><b>{c.student.name}</b><div className="muted small">Matrícula {c.student.number}</div></td><td>{c.description}</td><td>{formatDate(c.dueDate + 'T12:00:00')}</td><td>{brl(c.amountCents)}</td>
              <td>{c.status === 'PAID' ? <Chip ok>Pago ({METHODS.find(m => m[0] === c.method)?.[1]})</Chip> : c.status === 'CANCELLED' ? <span className="muted">Cancelada</span> : c.overdue ? <Chip>Em atraso</Chip> : 'A vencer'}</td>
              <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{c.status === 'PENDING' && (payFor === c.id
                ? <span style={{ display: 'inline-flex', gap: 6 }}><select className="input" style={{ width: 'auto' }} value={method} onChange={e => setMethod(e.target.value)} aria-label="Forma de pagamento">{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><Button variant="primary" onClick={() => { setPayFor(null); run(() => payGymCharge(id, c.id, method), 'Pagamento registrado.') }}>Confirmar</Button></span>
                : <Button variant="primary" onClick={() => setPayFor(c.id)}>Registrar pagamento</Button>)}</td>
            </tr>)}
            {list.data.length === 0 && <tr><td colSpan={6} className="dim">Nada por aqui.</td></tr>}
          </tbody>
        </table>
      </div>}
    </>}
  </>
}

function PlansPanel({ id, manage }) {
  const plans = useLoad(() => gymPlans(id), [id])
  const [f, setF] = useState({ name: '', price: '', description: '' })
  const [err, setErr] = useState(null)
  const add = async e => {
    e.preventDefault(); setErr(null)
    try { await saveGymPlan(id, { name: f.name, description: f.description, priceCents: Math.round(Number(String(f.price).replace(',', '.')) * 100) }); setF({ name: '', price: '', description: '' }); await plans.load() } catch (x) { setErr(errorText(x, 'Não foi possível salvar.')) }
  }
  return <>
    <Err>{err || plans.err}</Err>
    {manage && <form className="card" onSubmit={add} style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Novo plano</div>
      <div className="dk-toolbar" style={{ marginBottom: 0 }}>
        <input className="input" placeholder="Nome (ex.: Mensal)" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} aria-label="Nome do plano" />
        <input className="input" placeholder="Valor mensal (R$)" inputMode="decimal" value={f.price} onChange={e => setF(s => ({ ...s, price: e.target.value }))} aria-label="Valor do plano" />
        <input className="input" style={{ minWidth: 240 }} placeholder="Descrição (opcional)" value={f.description} onChange={e => setF(s => ({ ...s, description: e.target.value }))} aria-label="Descrição" />
        <Button variant="primary" type="submit" disabled={f.name.trim().length < 2 || !f.price}>Criar plano</Button>
      </div>
    </form>}
    <div className="card" style={{ padding: 0, overflow: 'auto' }}><table className="dk-table"><thead><tr><th>Plano</th><th>Valor</th><th>Descrição</th><th>Situação</th><th /></tr></thead>
      <tbody>{(plans.data || []).map(p => <tr key={p.id}><td><b>{p.name}</b></td><td>{brl(p.priceCents)}</td><td>{p.description}</td><td>{p.active ? 'Ativo' : 'Desativado'}</td>
        <td style={{ textAlign: 'end' }}>{manage && <Button variant="tinted" onClick={() => saveGymPlan(id, { id: p.id, name: p.name, description: p.description, priceCents: p.priceCents, active: !p.active }).then(plans.load)}>{p.active ? 'Desativar' : 'Reativar'}</Button>}</td></tr>)}
        {plans.data?.length === 0 && <tr><td colSpan={5} className="dim">Nenhum plano. {manage ? 'Crie o primeiro acima.' : 'O gerente ou o administrador cria os planos.'}</td></tr>}</tbody></table></div>
    <div className="dim small" style={{ marginTop: 8 }}>Mudar o valor de um plano vale para as próximas mensalidades geradas; as já geradas não mudam.</div>
  </>
}

/* --------------------------------- aparelhos --------------------------------- */

const EQ_STATUS = { ACTIVE: 'Em uso', MAINTENANCE: 'Em manutenção', RETIRED: 'Desativado' }
export function EquipmentPanel({ id, role }) {
  const list = useLoad(() => gymEquipment(id), [id])
  const manage = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER'].includes(role)
  const blank = { number: '', name: '', category: '', muscles: '', exerciseIds: '', location: '', status: 'ACTIVE', notes: '' }
  const [f, setF] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [err, setErr] = useState(null)
  const set = k => e => setF(s => ({ ...s, [k]: e.target.value }))
  const submit = async e => {
    e.preventDefault(); setErr(null)
    try {
      await saveGymEquipment(id, { id: editing || undefined, number: Number(f.number), name: f.name, category: f.category, location: f.location, status: f.status, notes: f.notes, muscles: f.muscles.split(',').map(x => x.trim()).filter(Boolean), exerciseIds: f.exerciseIds.split(',').map(x => x.trim()).filter(Boolean) })
      setF(blank); setEditing(null); await list.load()
    } catch (x) { setErr(errorText(x, 'Não foi possível salvar o aparelho.')) }
  }
  const edit = e => { setEditing(e.id); setF({ number: String(e.number), name: e.name, category: e.category, muscles: e.muscles.join(', '), exerciseIds: e.exerciseIds.join(', '), location: e.location, status: e.status, notes: e.notes }) }
  return <>
    <Err>{err || list.err}</Err>
    {manage && <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{editing ? 'Editar aparelho' : 'Novo aparelho'}</div>
      <div style={grid}>
        <Field label="Número *"><input className="input" type="number" min={1} max={9999} value={f.number} onChange={set('number')} required /></Field>
        <Field label="Nome *"><input className="input" value={f.name} onChange={set('name')} required maxLength={60} placeholder="Ex.: Leg press 45°" /></Field>
        <Field label="Categoria"><input className="input" value={f.category} onChange={set('category')} placeholder="Musculação, cardio…" /></Field>
        <Field label="Local"><input className="input" value={f.location} onChange={set('location')} placeholder="Térreo, sala de cardio…" /></Field>
        <Field label="Músculos (separados por vírgula)"><input className="input" value={f.muscles} onChange={set('muscles')} /></Field>
        <Field label="Exercícios do catálogo (ids, vírgula)"><input className="input" value={f.exerciseIds} onChange={set('exerciseIds')} /></Field>
        <Field label="Situação"><select className="input" value={f.status} onChange={set('status')}>{Object.entries(EQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Observações"><input className="input" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><Button variant="primary" type="submit">{editing ? 'Salvar' : 'Cadastrar aparelho'}</Button>{editing && <Button variant="tinted" type="button" onClick={() => { setEditing(null); setF(blank) }}>Cancelar</Button>}</div>
    </form>}
    {!list.data && !list.err && <div className="muted">Carregando…</div>}
    {list.data && <div className="card" style={{ padding: 0, overflow: 'auto' }}><table className="dk-table"><thead><tr><th>Nº</th><th>Aparelho</th><th>Categoria</th><th>Músculos</th><th>Local</th><th>Situação</th><th /></tr></thead>
      <tbody>{list.data.map(e => <tr key={e.id}><td><b>{e.number}</b></td><td>{e.name}</td><td>{e.category}</td><td>{e.muscles.join(', ')}</td><td>{e.location}</td><td>{EQ_STATUS[e.status]}</td>
        <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>{manage && <><Button variant="tinted" onClick={() => edit(e)}>Editar</Button> <Button variant="tinted" onClick={() => { if (window.confirm('Remover o aparelho ' + e.number + '?')) deleteGymEquipment(id, e.id).then(list.load).catch(x => setErr(errorText(x, 'Não foi possível remover.'))) }}>Remover</Button></>}</td></tr>)}
        {list.data.length === 0 && <tr><td colSpan={7} className="dim">Nenhum aparelho. {manage ? 'Cadastre acima, com o número que está na etiqueta do aparelho.' : ''}</td></tr>}</tbody></table></div>}
    <div className="dim small" style={{ marginTop: 8 }}>Alunos e professores veem esta lista no app (Ajustes → Minha academia), para saber qual é o aparelho nº tal do treino.</div>
  </>
}

/* ----------------------------------- acesso ----------------------------------- */

export function AccessPanel({ id, role }) {
  const events = useLoad(() => gymAccessEvents(id), [id])
  const manage = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER'].includes(role)
  const devices = useLoad(() => (manage ? gymDevices(id) : Promise.resolve([])), [id, manage])
  const [name, setName] = useState('')
  const [token, setToken] = useState(null)
  const [err, setErr] = useState(null)
  const act = async fn => { setErr(null); try { await fn(); await devices.load() } catch (e) { setErr(errorText(e, 'Não foi possível concluir.')) } }
  return <>
    <Err>{err || events.err || devices.err}</Err>
    {manage && <>
      <h3>Catracas e leitores</h3>
      <form className="dk-toolbar" onSubmit={e => { e.preventDefault(); act(async () => { const d = await createGymDevice(id, name); setToken(d); setName('') }) }}>
        <input className="input" style={{ minWidth: 260 }} value={name} onChange={e => setName(e.target.value)} placeholder="Nome (ex.: Catraca da entrada)" aria-label="Nome do leitor" />
        <Button variant="primary" type="submit" disabled={name.trim().length < 2}>Cadastrar leitor</Button>
      </form>
      {token && <div className="card" role="status" style={{ marginBottom: 12 }}><b>Token de “{token.name}”</b>: copie agora, ele não aparece de novo.<div style={{ fontFamily: 'monospace', wordBreak: 'break-all', margin: '8px 0', userSelect: 'all' }}>{token.token}</div><Button variant="tinted" onClick={() => setToken(null)}>Já copiei</Button></div>}
      <div className="card" style={{ padding: 0, overflow: 'auto', marginBottom: 12 }}><table className="dk-table"><thead><tr><th>Leitor</th><th>Última consulta</th><th>Situação</th><th /></tr></thead>
        <tbody>{(devices.data || []).map(d => <tr key={d.id}><td><b>{d.name}</b></td><td>{d.lastSeenAt ? formatDateTime(d.lastSeenAt) : 'Nunca'}</td><td>{d.active ? 'Ativo' : 'Desativado'}</td>
          <td style={{ textAlign: 'end', whiteSpace: 'nowrap' }}>
            <Button variant="tinted" onClick={() => act(() => updateGymDevice(id, d.id, { active: !d.active }))}>{d.active ? 'Desativar' : 'Ativar'}</Button>{' '}
            <Button variant="tinted" onClick={() => { if (window.confirm('Gerar um novo token? O atual para de funcionar.')) act(async () => setToken({ name: d.name, ...(await updateGymDevice(id, d.id, { rotate: true })) })) }}>Novo token</Button>{' '}
            <Button variant="tinted" onClick={() => { if (window.confirm('Remover o leitor?')) act(() => deleteGymDevice(id, d.id)) }}>Remover</Button></td></tr>)}
          {devices.data?.length === 0 && <tr><td colSpan={4} className="dim">Nenhum leitor cadastrado.</td></tr>}</tbody></table></div>
      <details className="card" style={{ marginBottom: 16 }}><summary style={{ cursor: 'pointer', fontWeight: 650 }}>Como ligar a catraca ou o terminal facial</summary>
        <div className="small" style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <div>O leitor chama a API com o token no cabeçalho <code>Authorization: Bearer gd_…</code>:</div>
          <div><code>POST /api/access/check</code> com <code>{'{ "code": "ac_…" }'}</code> (QR do aluno) ou <code>{'{ "number": 12 }'}</code> (matrícula, quando o terminal facial já reconheceu a pessoa) e opcional <code>{'"direction": "OUT"'}</code>. Resposta: <code>allowed</code>, <code>reason</code>, <code>message</code>, <code>name</code>.</div>
          <div><code>GET /api/access/people</code> lista matrícula, nome e se pode entrar hoje; <code>GET /api/access/face?number=12</code> entrega a foto de quem consentiu, para o terminal cadastrar.</div>
          <div>O servidor decide pela matrícula e pela mensalidade; a saída nunca é bloqueada. Cada passagem fica registrada abaixo. A comparação do rosto é feita pelo próprio terminal: este sistema só guarda a foto de cadastro, com consentimento.</div>
        </div></details>
    </>}
    <h3>Últimas passagens</h3>
    {!events.data && !events.err && <div className="muted">Carregando…</div>}
    {events.data && <div className="card" style={{ padding: 0, overflow: 'auto' }}><table className="dk-table"><thead><tr><th>Quando</th><th>Aluno</th><th>Leitor</th><th>Como</th><th>Resultado</th></tr></thead>
      <tbody>{events.data.map(e => <tr key={e.id}><td>{formatDateTime(e.at)}</td><td>{e.student ? <>{e.student.name} <span className="muted">nº {e.student.number}</span></> : <span className="muted">Não identificado</span>}</td><td>{e.device || '–'}</td><td>{e.method === 'QR' ? 'QR' : 'Face'} · {e.direction === 'OUT' ? 'saída' : 'entrada'}</td><td><Chip ok={e.allowed}>{e.allowed ? 'Liberado' : (REASON[e.reason] || 'Negado')}</Chip></td></tr>)}
        {events.data.length === 0 && <tr><td colSpan={5} className="dim">Nenhuma passagem registrada ainda.</td></tr>}</tbody></table></div>}
  </>
}
