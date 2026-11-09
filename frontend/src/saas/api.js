// Chamadas do CorpoFit AI SaaS ao backend. Tudo passa por lib/api.js (cookie de sessão, timeouts, erros).
// O frontend nunca define preço nem plano: só envia a forma de pagamento e o documento do pagador.
import { api } from '../lib/api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body || {}) })

export const getPlans = () => api('/api/saas/plans')
export const getBilling = () => api('/api/billing/status')
export const startCheckout = (method, cpfCnpj) => post('/api/billing/checkout', { method, cpfCnpj })
export const cancelSubscription = () => post('/api/billing/cancel')
export const getPixQr = paymentId => post('/api/billing/pix', { paymentId })
export const getAiUsage = () => api('/api/saas/ai')

export const registerAccount = (name, email, password) =>
  post('/api/register/password', { name, email, password, acceptTerms: true }).then(r => r.user)
export const forgotPassword = email => post('/api/login/password-forgot', { email })

export const adminOverview = () => api('/api/admin/saas/overview')
export const adminFinance = () => api('/api/admin/saas/finance')
export const adminPremium = body => post('/api/admin/saas/premium', body)
export const adminSettings = body => post('/api/admin/saas/settings', body)
export const adminReconcile = subscriptionId => post('/api/admin/saas/reconcile', { subscriptionId })

// Academias (multi-tenant). O servidor decide o que cada papel pode; aqui só se pede e se mostra.
const q = id => '?tenant=' + encodeURIComponent(id)
const put = (path, body) => api(path, { method: 'PUT', body: JSON.stringify(body || {}) })
export const orgContexts = () => api('/api/orgs')
export const createOrg = (name, slug) => post('/api/orgs', { name, slug: slug || undefined })
export const orgSettings = id => api('/api/orgs/settings' + q(id))
export const saveOrgSettings = (id, body) => put('/api/orgs/settings' + q(id), body)
export const orgDashboard = id => api('/api/orgs/dashboard' + q(id))
export const orgActivity = id => api('/api/orgs/activity' + q(id))
export const orgMembers = id => api('/api/orgs/members' + q(id))
export const inviteOrgMember = (id, email, role) => post('/api/orgs/members' + q(id), { email, role })
export const changeOrgRole = (id, userId, role) => put('/api/orgs/members' + q(id), { userId, role })
export const removeOrgMember = (id, userId) => api('/api/orgs/members' + q(id) + '&user=' + encodeURIComponent(userId), { method: 'DELETE' })
export const acceptOrgInvite = id => post('/api/orgs/accept' + q(id))
export const leaveOrg = id => post('/api/orgs/leave' + q(id))

// Personal trainers: vínculos, treinos enviados e comentários. O servidor decide quem vê o quê.
const qs = (k, v) => '?' + k + '=' + encodeURIComponent(v)
export const trainerProfile = () => api('/api/trainer/profile').then(r => r.profile)
export const saveTrainerProfile = body => put('/api/trainer/profile', body).then(r => r.profile)
export const trainerLinks = () => api('/api/trainer/links')
export const inviteStudent = email => post('/api/trainer/links', { email })
export const requestTrainer = email => post('/api/trainer/links', { email, as: 'student' })
export const answerLink = (id, accept) => put('/api/trainer/links', { id, accept })
export const endLink = id => api('/api/trainer/links' + qs('id', id), { method: 'DELETE' })
export const trainerAssignments = linkId => api('/api/trainer/assignments' + (linkId ? qs('link', linkId) : ''))
export const assignWorkout = (linkId, title, note, bundle) => post('/api/trainer/assignments', { linkId, title, note, bundle })
export const answerAssignment = (id, status) => put('/api/trainer/assignments', { id, status })
export const assignmentComments = id => api('/api/trainer/comments' + qs('assignment', id))
export const addAssignmentComment = (assignmentId, body) => post('/api/trainer/comments', { assignmentId, body })

// A mensagem do servidor em português: as rotas do SaaS já respondem em pt-BR; as de login e cadastro
// do openGym respondem em inglês com um `code` estável, traduzido aqui.
const CODES = {
  'bad-credentials': 'E-mail ou senha incorretos.',
  'email-required': 'Informe seu e-mail.',
  'terms-required': 'Aceite os Termos de Uso e a Política de Privacidade.',
  'email-invalid': 'Esse e-mail não parece válido.',
  'email-taken': 'Já existe uma conta com este e-mail.',
  'name-taken': 'Já existe uma conta com este nome.',
  'too-short': 'A senha deve ter ao menos 10 caracteres.',
  'too-long': 'A senha é longa demais.',
  'too-common': 'Essa senha é fácil de adivinhar. Use uma mais longa ou algumas palavras sem relação.',
  'reset-invalid': 'O código está errado ou expirou. Peça um novo.',
  disabled: 'Esta conta está desativada.',
  busy: 'O servidor está ocupado. Tente de novo em instantes.',
  locked: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
  'ai-quota-exceeded': null,
  'message-too-long': null
}

export function errorText(e, fallback = 'Algo deu errado. Tente novamente.') {
  const code = e?.data?.code || e?.code
  if (e?.status === 429) return 'Muitas tentativas. Aguarde um pouco e tente de novo.'
  if (e?.status === 0) return 'Sem conexão. Verifique sua internet e tente de novo.'
  if (code && CODES[code]) return CODES[code]
  return e?.message && !/^HTTP \d+$/.test(e.message) ? e.message : fallback
}
