-- Prazo da ficha: o personal diz até quando o treino enviado vale; perto e depois da data, os dois recebem aviso.
ALTER TABLE "Assignment" ADD COLUMN "reviewAt" TIMESTAMP(3);
CREATE INDEX "Assignment_reviewAt_idx" ON "Assignment"("reviewAt");
