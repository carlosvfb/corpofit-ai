// "Continuar com o Google": só aparece quando o servidor tem o Google configurado (config.google_login). O clique leva a
// página inteira ao servidor, que cuida do OAuth e volta já com a sessão. Se algo falhar na volta, a tela de entrada recebe
// ?google=<motivo> e este bloco explica em português.
import { useStore } from '../store/useStore.js'

const WHY = {
  cancelled: 'Você cancelou a entrada com o Google.', state: 'A entrada expirou. Tente de novo.', failed: 'Não foi possível entrar com o Google. Tente de novo.',
  unverified: 'O Google informou que o e-mail dessa conta ainda não foi verificado.', invite: 'Este servidor só aceita novas contas por convite.',
  disabled: 'Esta conta está desativada.', off: 'O login com o Google não está disponível.'
}

export default function GoogleSignIn({ portal = '' }) {
  const on = useStore(s => !!s.config?.google_login)
  // HashRouter: o motivo vem em #/entrar?google=<motivo>. Lido da URL para funcionar mesmo fora de um Router.
  const why = WHY[new URLSearchParams((globalThis.location?.hash || '').split('?')[1] || '').get('google')]
  if (!on && !why) return null
  return <div className="google-signin" style={{ display: 'grid', gap: 10, margin: '4px 0' }}>
    {why && <div className="small" role="alert" style={{ color: 'var(--red, #ff453a)' }}>{why}</div>}
    {on && <>
      <a className="btn" href={'/api/auth/google/start' + (portal ? '?portal=' + encodeURIComponent(portal) : '')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 46, textDecoration: 'none', background: '#fff', color: '#1f1f1f', border: '1px solid rgba(128,128,128,.4)', borderRadius: 12, fontWeight: 600 }}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.1 5.5c4.3-4 6.7-9.9 6.7-16.9z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        Continuar com o Google
      </a>
      <div className="muted small" style={{ textAlign: 'center' }}>ou</div>
    </>}
  </div>
}
