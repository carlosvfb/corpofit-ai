// O endereço público do CorpoFit AI, usado nos links que o app gera (compartilhar rotina, etiquetas NFC, User-Agent).
// Troque pelo seu domínio próprio com VITE_SITE_URL no build. Os links antigos (opengym.ch) continuam sendo lidos.
const raw = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SITE_URL) || 'https://corpofitai.vercel.app'
export const SITE_URL = String(raw).replace(/\/+$/, '')
export const SITE_HOST = new URL(SITE_URL).hostname.toLowerCase()
export const LEGACY_HOST = 'opengym.ch'
