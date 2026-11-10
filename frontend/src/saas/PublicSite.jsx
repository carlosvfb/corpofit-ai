// O site público do CorpoFit AI (visitante sem sessão): início, funcionalidades, planos, termos,
// privacidade, contato, licença/código-fonte, e as telas de entrar, cadastrar e recuperar a senha.
// Aparece no lugar da tela de login do openGym quando o servidor está em SAAS_MODE (GET /api/config).
// Tudo em português do Brasil; o resto do app usa os pacotes de idioma do openGym (DEFAULT_LANG=pt-BR).
import GoogleSignIn from './GoogleSignIn.jsx'
import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import './saas.css'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { passwordLogin, passwordResetRedeem } from '../lib/api.js'
import { askAddDeviceData } from '../sheets.jsx'
import { hasData } from '../store/useStore.js'
import { BRAND, formatBRL } from './brand.js'
import { errorText, forgotPassword, getPlans, registerAccount, sendEmailCode } from './api.js'
import PortalLogin from './portal/PortalLogin.jsx'
import { portalOf } from './portal/portals.js'

const MIN_PASSWORD = 10

function Shell({ children }) {
  const config = useStore(s => s.config)
  const source = config?.saas?.sourceCodeUrl
  return (
    <div className="ff-site">
      <header className="ff-head">
        <div className="ff-wrap">
          <Link to="/" className="ff-logo" aria-label={`${BRAND.name}: início`}><i aria-hidden="true">⚡</i>{BRAND.name}</Link>
          <nav className="ff-nav" aria-label="Principal">
            <Link to="/funcionalidades">Funcionalidades</Link>
            <Link to="/planos">Planos</Link>
            <Link to="/contato">Contato</Link>
            <Link to="/academia/entrar">Para academias</Link>
            <Link to="/personal/entrar">Para personais</Link>
          </nav>
          <div className="ff-cta">
            <Link to="/entrar" className="ff-btn">Entrar</Link>
            <Link to="/cadastro" className="ff-btn primary">Começar grátis</Link>
          </div>
        </div>
      </header>
      <main id="conteudo">{children}</main>
      <footer className="ff-foot">
        <div className="ff-wrap">
          <span>© {new Date().getFullYear()} {BRAND.name}. Software livre sob a licença AGPL-3.0.</span>
          <nav aria-label="Rodapé">
            <Link to="/termos">Termos de Uso</Link>
            <Link to="/privacidade">Privacidade</Link>
            <Link to="/contato">Contato</Link>
            <Link to="/licenca">Licença e código-fonte</Link>
            <Link to="/plataforma/entrar">Administração</Link>
            {source && <a href={source} rel="noopener noreferrer" target="_blank">Código-fonte</a>}
          </nav>
        </div>
      </footer>
    </div>
  )
}

const features = [
  ['🏋️', 'Treinos do seu jeito', 'Monte rotinas por dia ou em rodízio, com séries, repetições, descanso, supersets e progressão de carga. Mais de 5.600 exercícios descritos em texto, com o seu próprio catálogo ao lado.'],
  ['📝', 'Registro simples', 'O treino do dia já vem preparado, com as cargas da última vez. Marque as séries, use o cronômetro de descanso e veja os recordes na hora.'],
  ['📈', 'Evolução de verdade', 'Frequência, volume, 1RM estimado e recuperação muscular calculados apenas com os seus registros. Sem números inventados.'],
  ['💬', `${BRAND.aiName} em português`, 'Tire dúvidas, monte e ajuste rotinas e resuma sua evolução com um assistente que lê o seu histórico real e propõe mudanças que você aprova.'],
  ['🔒', 'Seus dados são seus', 'Exporte tudo quando quiser, encerre a conta e peça a exclusão dos dados no próprio app.'],
  ['⭐', 'Plano Premium', 'Mais mensagens com a IA, análises completas do histórico e comparação entre períodos. Cancele quando quiser.']
]

function Home() {
  return <>
    <section className="ff-wrap ff-hero">
      <div className="ff-fade">
        <span className="ff-chip">Novo · assistente de IA para o seu treino</span>
        <h1 className="ff-h1">Treine com <em>clareza</em>. Evolua com dados.</h1>
        <p className="ff-lead">{BRAND.tagline} Crie seus treinos, registre cada sessão e converse com a {BRAND.aiName} sobre a sua rotina real.</p>
        <div className="ff-cta" style={{ marginTop: 24 }}>
          <Link to="/cadastro" className="ff-btn primary">Criar conta grátis</Link>
          <Link to="/planos" className="ff-btn">Ver planos</Link>
        </div>
        <p className="ff-muted" style={{ fontSize: 12, marginTop: 12 }}>Sem cartão para começar. A IA não substitui médico, fisioterapeuta ou nutricionista.</p>
      </div>
      <div className="ff-card ff-fade" aria-label="Exemplo de conversa com a IA">
        <div className="ff-chat">
          <div className="ff-muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase' }}>{BRAND.aiName}</div>
          <div className="ff-bubble me">Como foi a minha semana de treinos?</div>
          <div className="ff-bubble ai">Pelos seus registros, você concluiu os treinos que anotou no app. Posso comparar com o período anterior e destacar o que evoluiu e o que ficou parado. Quer que eu faça isso?</div>
          <div className="ff-muted" style={{ fontSize: 11 }}>Exemplo ilustrativo. As respostas reais usam apenas os dados da sua conta.</div>
        </div>
      </div>
    </section>
    <section className="ff-wrap ff-section">
      <h2>Tudo para manter a constância</h2>
      <div className="ff-grid c4">
        {features.slice(0, 4).map(([i, t, d]) => <div className="ff-card" key={t}><div className="ff-ico" aria-hidden="true">{i}</div><strong>{t}</strong><p className="ff-muted" style={{ fontSize: 14, margin: '6px 0 0' }}>{d}</p></div>)}
      </div>
    </section>
    <section className="ff-wrap ff-section">
      <div className="ff-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div><h2 style={{ margin: 0 }}>Premium por menos de um café por semana</h2><p className="ff-muted" style={{ margin: '6px 0 0' }}>Mais IA, análises completas e comparação de períodos. Cartão ou Pix, cancele quando quiser.</p></div>
        <Link to="/planos" className="ff-btn primary">Conhecer o Premium</Link>
      </div>
    </section>
  </>
}

function Features() {
  return <section className="ff-wrap ff-section">
    <h1 className="ff-h1" style={{ fontSize: 38 }}>Funcionalidades</h1>
    <p className="ff-lead">Uma plataforma para organizar o treino, acompanhar a evolução e tirar dúvidas com IA.</p>
    <div className="ff-grid c2" style={{ marginTop: 24 }}>
      {features.map(([i, t, d]) => <div className="ff-card" key={t}><div className="ff-ico" aria-hidden="true">{i}</div><strong>{t}</strong><p className="ff-muted" style={{ fontSize: 14, margin: '6px 0 0' }}>{d}</p></div>)}
    </div>
    <p className="ff-muted" style={{ fontSize: 13, marginTop: 20 }}>A {BRAND.aiName} oferece orientações gerais e não substitui profissionais de saúde.</p>
    <div style={{ marginTop: 18 }}><Link to="/cadastro" className="ff-btn primary">Criar conta grátis</Link></div>
  </section>
}

function Plans() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { getPlans().then(setData).catch(() => setFailed(true)) }, [])
  return <section className="ff-wrap ff-section">
    <h1 className="ff-h1" style={{ fontSize: 38, textAlign: 'center' }}>Planos e preços</h1>
    <p className="ff-lead" style={{ margin: '0 auto', textAlign: 'center' }}>Comece grátis. Faça upgrade quando quiser mais IA e análises. Cancelamento a qualquer momento.</p>
    {failed && <p className="ff-err" role="alert" style={{ textAlign: 'center', marginTop: 24 }}>Não foi possível carregar os planos agora. Tente novamente em instantes.</p>}
    {!data && !failed && <p className="ff-muted" style={{ textAlign: 'center', marginTop: 24 }}>Carregando…</p>}
    {data && <div className="ff-grid c2" style={{ maxWidth: 820, margin: '32px auto 0' }}>
      {data.plans.map(p => {
        const premium = p.code === 'PREMIUM'
        return <div key={p.code} className="ff-card" style={premium ? { borderColor: 'var(--ff-a)' } : undefined}>
          {premium && <span className="ff-chip" style={{ color: 'var(--ff-a)' }}>Mais completo</span>}
          <h2 style={{ margin: '10px 0 0', fontSize: 20 }}>{p.name}</h2>
          <div className="ff-price">{formatBRL(p.priceCents)}<small> /mês</small></div>
          <ul className="ff-list">{p.highlights.map(h => <li key={h}>{h}</li>)}</ul>
          <div style={{ marginTop: 20 }}><Link to="/cadastro" className={'ff-btn' + (premium ? ' primary' : '')} style={{ width: '100%' }}>{premium ? 'Criar conta e assinar' : 'Começar grátis'}</Link></div>
        </div>
      })}
    </div>}
    <div className="ff-card ff-muted" style={{ maxWidth: 820, margin: '24px auto 0', fontSize: 14, lineHeight: 1.6 }}>
      <strong style={{ color: 'var(--ff-fg)' }}>Como funciona a cobrança do Premium</strong>
      <ul style={{ margin: '8px 0 0', paddingInlineStart: 20 }}>
        <li><strong>Cartão de crédito:</strong> cobrança automática mensal.</li>
        <li><strong>Pix Automático</strong> (quando disponível): autorize uma vez e as próximas cobranças são debitadas conforme a autorização e as regras do banco.</li>
        <li><strong>Pix:</strong> você recebe uma nova cobrança a cada mês e precisa pagar cada uma. Não é débito automático.</li>
        <li>O Premium é liberado somente depois da confirmação do pagamento. Pagamentos processados pelo Asaas.</li>
      </ul>
    </div>
  </section>
}

function Prose({ children }) { return <section className="ff-wrap"><article className="ff-prose">{children}</article></section> }

function Terms({ plans }) {
  const price = plans ? formatBRL(plans.find(p => p.code === 'PREMIUM')?.priceCents || 0) : ''
  return <Prose>
    <h1>Termos de Uso</h1>
    <p className="ff-warn">Texto-modelo inicial. Antes de operar comercialmente, faça a revisão jurídica e preencha razão social, CNPJ e foro do responsável pelo serviço.</p>
    <h2>1. Serviço</h2><p>O {BRAND.name} é uma plataforma para organizar treinos, registrar atividades e conversar com um assistente de IA ({BRAND.aiName}).</p>
    <h2>2. Aviso de saúde</h2><p>O conteúdo e as respostas da IA são informativos e gerais. Não substituem avaliação de médico, fisioterapeuta, educador físico ou nutricionista. Em caso de dor, lesão ou mal-estar, interrompa a atividade e procure um profissional. Não prometemos resultados físicos.</p>
    <h2>3. Conta</h2><p>Você é responsável pela confidencialidade da sua senha e pelas informações fornecidas. Podemos suspender contas que violem estes termos ou a lei.</p>
    <h2>4. Planos e pagamento</h2><p>O plano Premium custa {price} por mês e é cobrado de forma recorrente por cartão de crédito, Pix Automático (quando disponível) ou Pix mensal (cada cobrança deve ser paga por você). Os pagamentos são processados pelo Asaas. O Premium é liberado após a confirmação do pagamento.</p>
    <h2>5. Cancelamento</h2><p>Você pode cancelar a qualquer momento em Perfil, Assinatura. Os benefícios permanecem até o fim do período já pago. O histórico financeiro é mantido conforme a legislação.</p>
    <h2>6. Uso da IA</h2><p>Há limites mensais de mensagens por plano. Não use a IA para conteúdo ilegal nem para obter diagnósticos médicos.</p>
    <h2>7. Software livre</h2><p>O código-fonte é licenciado sob a GNU AGPL-3.0. Veja <Link to="/licenca">Licença e código-fonte</Link>.</p>
  </Prose>
}

function Privacy({ email }) {
  return <Prose>
    <h1>Política de Privacidade</h1>
    <p className="ff-warn">Texto-modelo inicial (LGPD). Antes de operar comercialmente, faça a revisão jurídica e informe o controlador e o encarregado (DPO).</p>
    <h2>Dados que coletamos</h2><p>Nome, e-mail, senha (guardada apenas como hash), seus treinos, registros, medidas e preferências, conversas com a IA e o consumo da IA (quantidade de mensagens e tokens). No Premium: o CPF/CNPJ informado ao contratar (enviado ao Asaas; guardamos só os 4 últimos dígitos) e o histórico de cobranças. Não armazenamos dados de cartão.</p>
    <h2>Para que usamos</h2><p>Prestar o serviço, personalizar as respostas da IA com o seu histórico (com a sua autorização expressa na primeira vez), processar pagamentos, prevenir fraudes e cumprir obrigações legais.</p>
    <h2>Com quem compartilhamos</h2><p>Provedor de IA (apenas o contexto necessário para responder cada pedido), Asaas (pagamentos), provedores de hospedagem, banco de dados e e-mail. Não vendemos dados.</p>
    <h2>Seus direitos</h2><p>Você pode acessar, corrigir, exportar e excluir seus dados nas Configurações, ou pelo e-mail {email}. Registros financeiros podem ser mantidos pelo prazo exigido em lei.</p>
    <h2>Dados de saúde</h2><p>Informe limitações de saúde apenas se quiser que a IA as considere. Você pode removê-las a qualquer momento.</p>
    <h2>Segurança</h2><p>Conexões criptografadas (HTTPS), senhas com hash, controle de acesso por usuário e limites contra abuso.</p>
  </Prose>
}

function Contact({ email }) {
  return <Prose>
    <h1>Contato e suporte</h1>
    <p>Dúvidas, problemas com pagamento ou pedidos sobre os seus dados (LGPD)? Escreva para <a href={`mailto:${email}`}>{email}</a>.</p>
    <p>Para cobranças, informe o e-mail da sua conta. Nunca envie senhas ou dados completos de cartão por e-mail. O cancelamento da assinatura e a exclusão da conta podem ser feitos por você mesmo, dentro do app.</p>
  </Prose>
}

function License({ source }) {
  return <Prose>
    <h1>Licença e código-fonte</h1>
    <p>O {BRAND.name} é baseado no <strong>openGym</strong> e é software livre sob a <strong>GNU Affero General Public License v3.0 (AGPL-3.0)</strong>. Como o serviço é oferecido em rede, você tem o direito de receber o código-fonte correspondente da versão em execução.</p>
    <p><strong>Código-fonte correspondente: </strong>{source ? <a href={source} rel="noopener noreferrer" target="_blank">{source}</a> : <span>o operador ainda não informou o endereço (variável SOURCE_CODE_URL).</span>}</p>
    <p>Esta instalação não inclui as imagens e animações de exercícios do openGym, que têm licença própria (Gym visual) e não podem ser usadas comercialmente sem licença. O catálogo de exercícios é textual; os créditos e as licenças de terceiros estão no arquivo NOTICE.md e em LICENSES_AND_ATTRIBUTIONS.md do repositório.</p>
  </Prose>
}

function useSignedIn() {
  return async u => {
    const st = useStore.getState()
    st.setUser(u, { adopt: true })
    await st.adoptProfile(askAddDeviceData)
    useUI.getState().toast(`Bem-vindo de volta, ${u.name}`)
  }
}

function Field({ id, label, error, children }) {
  return <div className="ff-field"><label htmlFor={id}>{label}</label>{children}{error && <div className="ff-err" role="alert">{error}</div>}</div>
}

function Login() {
  const nav = useNavigate()
  const signedIn = useSignedIn()
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !pw) { setErr('Informe e-mail e senha.'); return }
    setBusy(true); setErr(null)
    try { await signedIn(await passwordLogin(email.trim(), pw)); nav('/home', { replace: true }) }
    catch (ex) { setErr(errorText(ex, 'Não foi possível entrar.')) }
    finally { setBusy(false) }
  }
  return <section className="ff-wrap"><div className="ff-auth ff-fade">
    <h1 className="ff-h1" style={{ fontSize: 30 }}>Entrar</h1>
    <form className="ff-form" onSubmit={submit} noValidate>
      <Field id="email" label="E-mail"><input id="email" className="ff-input" type="email" autoComplete="username" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field id="pw" label="Senha"><input id="pw" className="ff-input" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      {err && <div className="ff-err" role="alert">{err}</div>}
      <button className="ff-btn primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
        <Link to="/recuperar" className="ff-muted">Esqueci a senha</Link>
        <Link to="/cadastro" className="ff-muted">Criar conta</Link>
      </div>
    </form>
  </div></section>
}

function Register() {
  const nav = useNavigate()
  const [f, setF] = useState({ name: '', email: '', pw: '', again: '', terms: false })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = k => e => setF(s => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    const bad = !f.name.trim() ? 'Informe seu nome.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) ? 'Informe um e-mail válido.'
      : [...f.pw].length < MIN_PASSWORD ? `A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`
      : f.pw !== f.again ? 'As duas senhas não são iguais.'
      : !f.terms ? 'Aceite os Termos de Uso e a Política de Privacidade.' : null
    if (bad) { setErr(bad); return }
    setBusy(true); setErr(null)
    try {
      const u = await registerAccount(f.name.trim(), f.email.trim(), f.pw)
      const st = useStore.getState()
      st.setUser(u)
      if (hasData(useStore.getState().S)) await st.pushState(); else await st.pullState()
      useUI.getState().toast(`Bem-vindo, ${u.name}! Enviamos um código para o seu e-mail.`)
      // Confirmar o e-mail libera os convites e a matrícula feita por uma academia com este endereço.
      Promise.resolve(sendEmailCode()).catch(() => {})
      nav('/notificacoes', { replace: true })
    } catch (ex) { setErr(errorText(ex, 'Não foi possível criar a conta.')) }
    finally { setBusy(false) }
  }
  return <section className="ff-wrap"><div className="ff-auth ff-fade">
    <h1 className="ff-h1" style={{ fontSize: 30 }}>Criar conta</h1>
    <p className="ff-muted" style={{ marginTop: -6 }}>Grátis, sem cartão de crédito.</p>
    <form className="ff-form" onSubmit={submit} noValidate>
      <GoogleSignIn />
      <Field id="name" label="Nome"><input id="name" className="ff-input" autoComplete="name" maxLength={40} value={f.name} onChange={set('name')} /></Field>
      <Field id="email" label="E-mail"><input id="email" className="ff-input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} /></Field>
      <Field id="pw" label="Senha"><input id="pw" className="ff-input" type="password" autoComplete="new-password" value={f.pw} onChange={set('pw')} /><div className="ff-muted" style={{ fontSize: 12, marginTop: 4 }}>Ao menos {MIN_PASSWORD} caracteres. Algumas palavras sem relação formam uma boa senha.</div></Field>
      <Field id="again" label="Repita a senha"><input id="again" className="ff-input" type="password" autoComplete="new-password" value={f.again} onChange={set('again')} /></Field>
      <label style={{ display: 'flex', gap: 9, fontSize: 13 }} className="ff-muted">
        <input type="checkbox" checked={f.terms} onChange={set('terms')} style={{ marginTop: 3 }} />
        <span>Li e aceito os <Link to="/termos" target="_blank">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank">Política de Privacidade</Link>.</span>
      </label>
      {err && <div className="ff-err" role="alert">{err}</div>}
      <button className="ff-btn primary" disabled={busy}>{busy ? 'Criando…' : 'Criar conta'}</button>
      <div className="ff-muted" style={{ fontSize: 13, textAlign: 'center' }}>Já tem conta? <Link to="/entrar">Entrar</Link></div>
    </form>
  </div></section>
}

function Recover() {
  const nav = useNavigate()
  const signedIn = useSignedIn()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const ask = async e => {
    e.preventDefault()
    if (busy) return
    if (!email.trim()) { setErr('Informe o e-mail da conta.'); return }
    setBusy(true); setErr(null)
    try { await forgotPassword(email.trim()); setStep(2) }
    catch (ex) { setErr(errorText(ex, 'Não foi possível enviar o código.')) }
    finally { setBusy(false) }
  }
  const redeem = async e => {
    e.preventDefault()
    if (busy) return
    if (!code.trim()) { setErr('Informe o código recebido por e-mail.'); return }
    if ([...pw].length < MIN_PASSWORD) { setErr(`A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`); return }
    setBusy(true); setErr(null)
    try { await signedIn(await passwordResetRedeem(email.trim(), code.trim().toUpperCase(), pw)); nav('/home', { replace: true }) }
    catch (ex) { setErr(errorText(ex, 'Não foi possível redefinir a senha.')) }
    finally { setBusy(false) }
  }
  return <section className="ff-wrap"><div className="ff-auth ff-fade">
    <h1 className="ff-h1" style={{ fontSize: 30 }}>Recuperar senha</h1>
    {step === 1 ? <form className="ff-form" onSubmit={ask} noValidate>
      <p className="ff-muted" style={{ marginTop: -6 }}>Enviaremos um código para o e-mail da sua conta.</p>
      <Field id="email" label="E-mail"><input id="email" className="ff-input" type="email" autoComplete="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      {err && <div className="ff-err" role="alert">{err}</div>}
      <button className="ff-btn primary" disabled={busy}>{busy ? 'Enviando…' : 'Enviar código'}</button>
      <button type="button" className="ff-btn" onClick={() => { setErr(null); setStep(2) }}>Já tenho um código</button>
    </form> : <form className="ff-form" onSubmit={redeem} noValidate>
      <p className="ff-ok" role="status">Se existir uma conta com esse e-mail, o código foi enviado. Ele vale por 1 hora; confira o spam.</p>
      <Field id="email2" label="E-mail"><input id="email2" className="ff-input" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
      <Field id="code" label="Código"><input id="code" className="ff-input" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', textAlign: 'center', fontWeight: 600 }} /></Field>
      <Field id="npw" label="Nova senha"><input id="npw" className="ff-input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      {err && <div className="ff-err" role="alert">{err}</div>}
      <button className="ff-btn primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
    </form>}
    <div className="ff-muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 14 }}><Link to="/entrar">Voltar ao login</Link></div>
  </div></section>
}

// Rotas públicas. `/` e qualquer endereço desconhecido mostram o início.
export default function PublicSite() {
  const { pathname } = useLocation()
  const config = useStore(s => s.config)
  const [plans, setPlans] = useState(null)
  useEffect(() => { getPlans().then(d => setPlans(d.plans)).catch(() => {}) }, [])
  useEffect(() => { window.scrollTo(0, 0); document.title = BRAND.name + ' · treinos com IA' }, [pathname])
  const email = config?.saas?.supportEmail || 'suporte@exemplo.com.br'
  const source = config?.saas?.sourceCodeUrl || null
  // Cada função tem a sua entrada: academia e administração (computador), personal (celular), aluno (o app).
  const entries = { '/personal/entrar': ['personal', 'login'], '/personal/cadastro': ['personal', 'register'], '/academia/entrar': ['academia', 'login'], '/academia/cadastro': ['academia', 'register'], '/plataforma/entrar': ['admin', 'login'] }
  if (entries[pathname]) return <PortalLogin portal={entries[pathname][0]} mode={entries[pathname][1]} />
  const wanted = portalOf(pathname)
  if (wanted.key !== 'student') return <Navigate to={wanted.login} replace />
  const page = {
    '/funcionalidades': <Features />, '/planos': <Plans />, '/entrar': <Login />, '/cadastro': <Register />,
    '/recuperar': <Recover />, '/termos': <Terms plans={plans} />, '/privacidade': <Privacy email={email} />,
    '/contato': <Contact email={email} />, '/licenca': <License source={source} />
  }[pathname] || <Home />
  return <Shell>{page}</Shell>
}
