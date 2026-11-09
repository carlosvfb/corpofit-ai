/* Planos das academias. Como em plans.js, o servidor é a única fonte de preço e de limite: o app só mostra.
   Os limites abaixo são PADRÕES DE PARTIDA, não uma decisão comercial: ajuste-os sem alterar código com a
   variável GYM_PLANS (JSON). Os PREÇOS não têm padrão: sem preço configurado o plano pago fica indisponível
   para contratação (nunca inventamos um valor). Exemplo:
   GYM_PLANS={"GYM_START":{"priceCents":19900},"GYM_PRO":{"priceCents":49900,"limits":{"maxStudents":600}}} */

const BASE = {
  GYM_FREE: {
    code: 'GYM_FREE', name: 'Academia Grátis', paid: false, priceCents: 0, cycle: 'MONTHLY',
    limits: { maxStudents: 10, maxProfessionals: 1, aiMonthlyMessages: 100 },
    highlights: ['Até 10 alunos e 1 profissional', 'Painel da academia e convites', 'IA com orientação da academia (limite menor)']
  },
  GYM_START: {
    code: 'GYM_START', name: 'Academia Start', paid: true, priceCents: null, cycle: 'MONTHLY',
    limits: { maxStudents: 100, maxProfessionals: 5, aiMonthlyMessages: 1500 },
    highlights: ['Até 100 alunos e 5 profissionais', 'Mais mensagens de IA para a academia']
  },
  GYM_PRO: {
    code: 'GYM_PRO', name: 'Academia Pro', paid: true, priceCents: null, cycle: 'MONTHLY',
    limits: { maxStudents: 500, maxProfessionals: 25, aiMonthlyMessages: 8000 },
    highlights: ['Até 500 alunos e 25 profissionais', 'Limite de IA ampliado']
  }
};

const posInt = v => (Number.isInteger(v) && v >= 0 ? v : undefined);

/** Os planos com as substituições de GYM_PLANS aplicadas (só limites e preço, com validação). */
export function gymPlans() {
  let over = {};
  try { over = process.env.GYM_PLANS ? JSON.parse(process.env.GYM_PLANS) : {}; } catch { over = {}; }
  return Object.fromEntries(Object.entries(BASE).map(([code, p]) => {
    const o = over && typeof over === 'object' ? over[code] : null;
    const limits = { ...p.limits };
    for (const k of Object.keys(limits)) { const v = posInt(o?.limits?.[k]); if (v !== undefined) limits[k] = v; }
    const price = p.paid ? (posInt(o?.priceCents) && o.priceCents > 0 ? o.priceCents : null) : 0;
    return [code, { ...p, limits, priceCents: price }];
  }));
}

export const gymPlan = code => gymPlans()[code] || null;
export const DEFAULT_GYM_PLAN = 'GYM_FREE';

/** O que o app pode mostrar: plano pago sem preço fica `purchasable: false`. */
export const publicGymPlans = () => Object.values(gymPlans()).map(p => ({
  code: p.code, name: p.name, priceCents: p.priceCents, cycle: p.cycle, limits: p.limits, highlights: p.highlights,
  purchasable: p.paid && p.priceCents !== null
}));
