-- LGPD: apagamento dos dados de um usuário que exclui a conta. O servidor define `app.eraser` = id do usuário
-- que está sendo apagado, só dentro da rotina de exclusão; cada política abaixo só alcança linhas DELE.
CREATE POLICY erase_perm ON "SharingPermission" FOR DELETE
  USING ("studentId" = current_setting('app.eraser', true) OR "trainerId" = current_setting('app.eraser', true));
CREATE POLICY erase_consent ON "ConsentRecord" FOR DELETE
  USING ("studentId" = current_setting('app.eraser', true));
CREATE POLICY erase_access ON "AccessLog" FOR DELETE
  USING ("studentId" = current_setting('app.eraser', true) OR "actorId" = current_setting('app.eraser', true));
CREATE POLICY erase_item ON "CommunityItem" FOR DELETE
  USING ("authorId" = current_setting('app.eraser', true));
CREATE POLICY erase_report ON "CommunityReport" FOR DELETE
  USING ("reporterId" = current_setting('app.eraser', true));

-- Quem leu pode ver o registro das PRÓPRIAS leituras (necessário também para o DELETE com filtro, que exige poder ler as linhas).
CREATE POLICY actor_read ON "AccessLog" FOR SELECT USING ("actorId" = current_setting('app.user_id', true));
