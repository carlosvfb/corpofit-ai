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

// Privacidade e compartilhamento: o aluno decide o que cada personal vê; o servidor confere a cada leitura.
export const shareCategories = () => api('/api/privacy/categories')
export const myPermissions = () => api('/api/privacy/permissions')
export const setPermission = (trainerId, category, level) => put('/api/privacy/permissions', { trainerId, category, level })
export const revokeAllSharing = trainerId => post('/api/privacy/revoke', { trainerId })
export const consentHistory = trainerId => api('/api/privacy/history' + (trainerId ? qs('trainer', trainerId) : ''))
export const accessLog = () => api('/api/privacy/access-log')
export const sharedWithMe = () => api('/api/trainer/shared')
export const readStudentData = (linkId, category) => api('/api/trainer/student?link=' + encodeURIComponent(linkId) + '&category=' + encodeURIComponent(category))
export const assignSuggestion = (linkId, title, note, bundle, target) => post('/api/trainer/assignments', { linkId, title, note, bundle, kind: 'SUGGESTION', target })

// IA por academia: o usuário escolhe se o Coach usa a orientação de uma academia; o dono vê o consumo.
export const aiContext = () => api('/api/orgs/ai-context')
export const setAiContext = tenantId => put('/api/orgs/ai-context', { tenantId })
export const orgAiUsage = id => api('/api/orgs/ai-usage' + q(id))

// Biblioteca comunitária. O servidor higieniza o que é publicado e confere visibilidade e moderação.
export const communityItems = params => api('/api/community/items?' + new URLSearchParams(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString())
export const communityItem = id => api('/api/community/item' + qs('id', id))
export const publishItem = body => post('/api/community/items', body)
export const removeItem = id => api('/api/community/items' + qs('id', id), { method: 'DELETE' })
export const favoriteItem = (id, on) => post('/api/community/favorite', { id, on })
export const importCommunityItem = id => post('/api/community/import', { id })
export const reportItem = (id, reason, note) => post('/api/community/report', { id, reason, note })
export const moderationQueue = tenantId => api('/api/community/moderation' + qs('tenant', tenantId))
export const moderateItem = (id, action, tenantId, scope) => post('/api/community/moderate', { id, action, tenantId, scope })
export const moderationQueuePlatform = () => api('/api/community/moderation?scope=platform')

// Plano da academia. Preço e limites vêm do servidor; aqui só se escolhe plano e forma de pagamento.
export const orgBilling = id => api('/api/orgs/billing' + q(id))
export const startOrgCheckout = (id, planCode, method, cpfCnpj) => post('/api/orgs/billing/checkout' + q(id), { planCode, method, cpfCnpj })
export const cancelOrgSubscription = id => post('/api/orgs/billing/cancel' + q(id))

// E-mail confirmado, avisos e painel da plataforma.
export const emailVerification = () => api('/api/account/verification')
export const sendEmailCode = () => post('/api/account/verification/send')
export const confirmEmailCode = code => post('/api/account/verification/confirm', { code })
export const listNotifications = () => api('/api/notifications')
export const markNotificationsRead = ids => post('/api/notifications/read', { ids })
export const cancelPendingInvite = (id, pendingId) => api('/api/orgs/pending' + q(id) + '&id=' + encodeURIComponent(pendingId), { method: 'DELETE' })
export const adminGyms = () => api('/api/admin/saas/orgs')

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

// Agenda, anotações privadas e visão geral do personal. Datas sempre em ISO (o app mostra no fuso de quem olha).
export const updateAssignment = (id, body) => put('/api/trainer/assignments', { id, ...body })
export const trainerOverview = () => api('/api/trainer/overview')
export const trainerSessions = (p = {}) => api('/api/trainer/sessions' + (Object.keys(p).length ? '?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v)).toString() : ''))
export const createSessions = (linkId, body) => post('/api/trainer/sessions', { linkId, ...body })
export const updateSession = (id, body) => put('/api/trainer/sessions', { id, ...body })
export const answerSession = (id, action) => put('/api/trainer/sessions', { id, action }) // confirm | decline | done | missed
export const cancelSession = (id, reason, series) => api('/api/trainer/sessions?id=' + encodeURIComponent(id) + '&reason=' + encodeURIComponent(reason || '') + (series ? '&series=1' : ''), { method: 'DELETE' })
export const trainerNotes = linkId => api('/api/trainer/notes' + qs('link', linkId))
export const addTrainerNote = (linkId, body) => post('/api/trainer/notes', { linkId, body })
export const deleteTrainerNote = id => api('/api/trainer/notes' + qs('id', id), { method: 'DELETE' })
export const applyPreset = (trainerId, preset) => post('/api/privacy/preset', { trainerId, preset })

// Foto de perfil (data URL JPEG/PNG/WebP de até 200 KB, já reduzida no aparelho).
export const uploadAvatar = image => put('/api/account/avatar', { image })
export const removeAvatar = () => api('/api/account/avatar', { method: 'DELETE' })

// Gestão da academia: operação, vínculo aluno-personal, agenda e treinos enviados.
export const gymRoster = id => api('/api/orgs/roster' + q(id))
export const assignGymTrainer = (id, studentId, trainerId) => post('/api/orgs/assign-trainer' + q(id), { studentId, trainerId })
export const gymSchedule = (id, p = {}) => api('/api/orgs/schedule' + q(id) + Object.entries(p).filter(([, v]) => v).map(([k, v]) => '&' + k + '=' + encodeURIComponent(v)).join(''))
export const gymWorkouts = id => api('/api/orgs/workouts' + q(id))
