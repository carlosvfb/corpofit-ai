import { describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest } from './saas-helpers.mjs';

describe('papel restrito da aplicação (RLS)', () => {
  dbTest('a migração cria corpofit_app sem superusuário e sem BYPASSRLS, assumível pelo papel conectado', async () => {
    const [r] = await db.$queryRawUnsafe("SELECT rolsuper, rolbypassrls, rolcanlogin, pg_has_role(current_user, 'corpofit_app', 'USAGE') AS can_use FROM pg_roles WHERE rolname = 'corpofit_app'");
    assert.ok(r, 'o papel corpofit_app não existe');
    assert.equal(r.rolsuper, false);
    assert.equal(r.rolbypassrls, false);
    assert.equal(r.rolcanlogin, false);
    assert.equal(r.can_use, true);
  });

  dbTest('a detecção automática só liga no schema public (os testes e o desenvolvimento ficam como estão)', async () => {
    delete process.env.RLS_ROLE;
    const { withContext, _resetAutoRole } = await import('../saas/org/context.js');
    _resetAutoRole();
    // nos testes o schema é ff_*: sem troca de papel; a consulta roda normalmente
    assert.equal(await withContext({ userId: 'x' }, tx => tx.membership.count()), 0);
    const [{ current_user }] = await withContext({ userId: 'x' }, tx => tx.$queryRawUnsafe('SELECT current_user'));
    assert.notEqual(current_user, 'corpofit_app');
  });
});
