-- Gestão da academia: quem gerencia (dono, administrador, gerente) enxerga os vínculos personal-aluno DA SUA academia
-- (TrainerStudent.tenantId), a agenda e os treinos enviados nesses vínculos, e pode propor/encerrar o vínculo de um aluno.
-- Nunca enxerga os dados de treino do aluno (isso continua dependendo da permissão do aluno) nem as anotações privadas do personal.
-- O predicado exige a academia em uso (app.tenant_id) e um vínculo ACTIVE do ator com papel de gestão nela.

CREATE POLICY gym_staff_read ON "TrainerStudent" FOR SELECT
  USING ("tenantId" IS NOT NULL AND "tenantId" = current_setting('app.tenant_id', true)
    AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."tenantId" = "TrainerStudent"."tenantId" AND m."userId" = current_setting('app.user_id', true)
      AND m."status" = 'ACTIVE' AND m."role" IN ('GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER')));

CREATE POLICY gym_staff_insert ON "TrainerStudent" FOR INSERT
  WITH CHECK ("tenantId" IS NOT NULL AND "tenantId" = current_setting('app.tenant_id', true)
    AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."tenantId" = "TrainerStudent"."tenantId" AND m."userId" = current_setting('app.user_id', true)
      AND m."status" = 'ACTIVE' AND m."role" IN ('GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER')));

CREATE POLICY gym_staff_update ON "TrainerStudent" FOR UPDATE
  USING ("tenantId" IS NOT NULL AND "tenantId" = current_setting('app.tenant_id', true)
    AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."tenantId" = "TrainerStudent"."tenantId" AND m."userId" = current_setting('app.user_id', true)
      AND m."status" = 'ACTIVE' AND m."role" IN ('GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER')))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));

-- A agenda e os treinos enviados valem para a gestão pelo vínculo (a subconsulta já passa pela política acima).
CREATE POLICY gym_staff_read ON "TrainingSession" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "TrainerStudent" l WHERE l."id" = "TrainingSession"."linkId"));
CREATE POLICY gym_staff_update ON "TrainingSession" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM "TrainerStudent" l WHERE l."id" = "TrainingSession"."linkId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "TrainerStudent" l WHERE l."id" = "TrainingSession"."linkId"));
CREATE POLICY gym_staff_read ON "Assignment" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "TrainerStudent" l WHERE l."id" = "Assignment"."linkId"));
