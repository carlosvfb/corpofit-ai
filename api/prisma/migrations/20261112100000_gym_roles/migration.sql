-- Novos papéis da academia: professor (acompanha o treino dos alunos da academia) e recepcionista (matrícula, mensalidade, acesso).
-- Em migração separada porque o PostgreSQL não deixa usar um valor de enum na mesma transação em que ele nasce.
ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'INSTRUCTOR';
ALTER TYPE "OrgRole" ADD VALUE IF NOT EXISTS 'RECEPTIONIST';
