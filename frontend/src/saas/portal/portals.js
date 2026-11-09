// Os portais: cada função tem a sua entrada, o seu login e a sua tela. Uma mesma conta pode ter várias funções
// (aluno, personal, gestor de academia, admin), mas cada uma abre no seu portal.
//   aluno      aplicativo de treino, feito para o celular (é o app de sempre)
//   personal   portal do personal trainer, feito para o celular
//   academia   portal de gestão da academia, feito para o computador
//   admin      administração da plataforma, feita para o computador
export const PORTALS = {
  student: {
    key: 'student', label: 'Aluno', home: '/home', login: '/entrar', register: '/cadastro', desktop: false,
    title: 'Entrar no seu treino', tagline: 'Treinos, evolução e a IA no seu bolso.', bullets: ['Monte e registre seus treinos', 'Acompanhe sua evolução', 'Converse com a CorpoFit AI']
  },
  personal: {
    key: 'personal', label: 'Personal trainer', home: '/personal', login: '/personal/entrar', register: '/personal/cadastro', desktop: false,
    title: 'Portal do personal', tagline: 'Seus alunos e treinos em um só lugar, no celular.', bullets: ['Convide alunos e envie treinos', 'Veja só o que cada aluno autorizar', 'Comente e ajuste com histórico']
  },
  academia: {
    key: 'academia', label: 'Academia', home: '/academia', login: '/academia/entrar', register: '/academia/cadastro', desktop: true,
    title: 'Portal da academia', tagline: 'Gerencie alunos, professores, planos e a IA da sua academia pelo computador.', bullets: ['Membros, papéis e convites', 'Plano, limites e cobrança', 'Uso da IA e moderação da biblioteca']
  },
  admin: {
    key: 'admin', label: 'Administração', home: '/plataforma', login: '/plataforma/entrar', register: null, desktop: true,
    title: 'Administração da plataforma', tagline: 'Acesso restrito à equipe da plataforma.', bullets: ['Academias, planos e cobranças', 'Fila de moderação', 'Consumo de IA e financeiro']
  }
}

/** Qual portal um endereço pede (só pelo prefixo). */
export function portalOf(pathname) {
  const p = String(pathname || '')
  if (p === '/academia' || p.startsWith('/academia/')) return PORTALS.academia
  if (p === '/personal' || p.startsWith('/personal/')) return PORTALS.personal
  if (p === '/plataforma' || p.startsWith('/plataforma/')) return PORTALS.admin
  return PORTALS.student
}

/** Os portais para computador não têm barra de abas do app. */
export const isDesktopPath = pathname => portalOf(pathname).desktop
/** O app para celular tem barra de abas própria (do app, ou a do portal do personal). */
export const hasOwnNav = pathname => portalOf(pathname).key !== 'student'
