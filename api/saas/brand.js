/* Identidade da marca do lado do servidor (e-mails, textos). A do app está em
   frontend/src/saas/brand.js. Altere os dois (ou use BRAND_NAME) para renomear o produto. */
export const brand = {
  name: process.env.BRAND_NAME || 'CorpoFit AI',
  aiName: process.env.BRAND_AI_NAME || 'CorpoFit AI'
};
