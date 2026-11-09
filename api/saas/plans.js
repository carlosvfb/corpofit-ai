/* Fonte única de verdade para preços, limites e benefícios.
   O frontend NUNCA define preço: o checkout usa apenas estes valores, no servidor.
   Mensagem de IA = um pedido ao Coach (plano, revisão, resumo, pergunta, ajuste). */

export const PLANS = {
  FREE: {
    code: 'FREE',
    name: 'Gratuito',
    priceCents: 0,
    cycle: 'MONTHLY',
    limits: {
      aiMessagesPerMonth: 20,
      aiMessagesPerMinute: 4,
      aiMessageMaxChars: 800,
      aiMaxOutputTokens: 2000
    },
    features: { fullHistoryAnalysis: false, periodComparison: false, exportData: false },
    highlights: [
      'Criação e organização de treinos, com séries, repetições e descanso',
      'Registro de atividades e histórico básico',
      '20 mensagens por mês com a CorpoFit AI'
    ]
  },
  PREMIUM: {
    code: 'PREMIUM',
    name: 'Premium',
    priceCents: 2990,
    cycle: 'MONTHLY',
    limits: {
      aiMessagesPerMonth: 300,
      aiMessagesPerMinute: 10,
      aiMessageMaxChars: 2000,
      aiMaxOutputTokens: 4000
    },
    features: { fullHistoryAnalysis: true, periodComparison: true, exportData: true },
    highlights: [
      'Tudo do plano Gratuito',
      '300 mensagens por mês com a CorpoFit AI',
      'Análises completas do histórico e comparação entre períodos',
      'Respostas mais longas da IA'
    ]
  }
};

export function formatBRL(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Política padrão de tolerância (alterável pelo admin via AppSetting). */
export const DEFAULT_GRACE_DAYS = 3;

/** O que o app pode mostrar sobre os planos (sem nada de interno). */
export function publicPlans() {
  return Object.values(PLANS).map(p => ({
    code: p.code, name: p.name, priceCents: p.priceCents, cycle: p.cycle,
    limits: p.limits, features: p.features, highlights: p.highlights
  }));
}
