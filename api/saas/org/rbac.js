/* Papéis e permissões das academias. Um papel não é uma permissão absoluta: vale só dentro do vínculo
   (Membership) do usuário com aquela academia. Toda checagem passa por `can` e `canManage`. */

export const ROLES = ['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER', 'INSTRUCTOR', 'RECEPTIONIST', 'PERSONAL_TRAINER', 'STUDENT'];

// Quanto maior, mais alto. Ninguém gerencia (convida, promove, remove) quem tem o mesmo nível ou mais.
const RANK = { GYM_OWNER: 7, GYM_ADMIN: 6, GYM_MANAGER: 5, INSTRUCTOR: 4, RECEPTIONIST: 3, PERSONAL_TRAINER: 2, STUDENT: 1 };

const FRONT_DESK = ['students:read', 'students:enroll', 'students:update', 'charges:manage', 'access:read'];
const PERMISSIONS = {
  GYM_OWNER: ['tenant:delete', 'settings:read', 'settings:write', 'members:read', 'members:invite', 'members:update', 'members:remove', 'dashboard:read', 'activity:read', 'ai:read', 'community:moderate', 'billing:read', 'billing:manage', ...FRONT_DESK, 'plans:manage', 'equipment:manage', 'devices:manage'],
  GYM_ADMIN: ['settings:read', 'settings:write', 'members:read', 'members:invite', 'members:update', 'members:remove', 'dashboard:read', 'activity:read', 'ai:read', 'community:moderate', 'billing:read', ...FRONT_DESK, 'plans:manage', 'equipment:manage', 'devices:manage'],
  GYM_MANAGER: ['settings:read', 'members:read', 'members:invite', 'dashboard:read', 'activity:read', 'billing:read', ...FRONT_DESK, 'plans:manage', 'equipment:manage', 'devices:manage'],
  // Professor da academia: acompanha o treino dos alunos (pelo portal do personal, com o vínculo aceito pelo aluno) e vê a ficha de treino deles.
  INSTRUCTOR: ['settings:read', 'dashboard:read', 'students:read', 'students:train'],
  // Recepção: matricula, atualiza o cadastro, registra pagamentos, tira a foto de acesso e vê quem entrou.
  RECEPTIONIST: ['settings:read', 'students:read', 'students:enroll', 'students:update', 'charges:manage', 'access:read'],
  PERSONAL_TRAINER: ['settings:read', 'dashboard:read'],
  STUDENT: ['settings:read']
};

export const rankOf = role => RANK[role] || 0;
export const isRole = role => Object.hasOwn(RANK, role);

/** O vínculo concede a permissão? Só um vínculo ACTIVE concede alguma. */
export function can(membership, permission) {
  if (!membership || membership.status !== 'ACTIVE') return false;
  return (PERMISSIONS[membership.role] || []).includes(permission);
}

/** O vínculo do ator pode atribuir ou alterar este papel? Estritamente abaixo do seu. */
export function canAssign(actorMembership, role) {
  if (!actorMembership || actorMembership.status !== 'ACTIVE' || !isRole(role)) return false;
  if (actorMembership.role === 'GYM_OWNER') return true; // o dono pode nomear outro dono (co-dono)
  return rankOf(role) < rankOf(actorMembership.role);
}

/** O ator pode alterar ou remover o vínculo do alvo? O alvo precisa estar estritamente abaixo. */
export function canManage(actorMembership, targetMembership) {
  return !!actorMembership && !!targetMembership && actorMembership.status === 'ACTIVE' && rankOf(targetMembership.role) < rankOf(actorMembership.role);
}
