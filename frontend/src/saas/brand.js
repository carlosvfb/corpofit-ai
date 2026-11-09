// A identidade do produto num só lugar. Para renomear (nome, IA, e-mail de suporte), altere aqui e em
// api/saas/brand.js (ou use BRAND_NAME no servidor). As cores da página pública estão em saas.css.
export const BRAND = {
  name: 'CorpoFit AI',
  aiName: 'CorpoFit AI',
  tagline: 'Seus treinos, sua evolução e uma IA que conhece o seu histórico.'
}

/** O modo SaaS vem de GET /api/config (público): sem ele o app é o openGym de sempre. */
export const saasOn = config => !!config?.saas?.enabled

export const formatBRL = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const formatDate = d => (d ? new Date(d).toLocaleDateString('pt-BR') : '–')
export const formatDateTime = d => (d ? new Date(d).toLocaleString('pt-BR') : '–')
