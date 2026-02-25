// Tecnico: Importa o client gerado pelo Prisma para conversar com o banco SQLite.
// Crianca: Aqui a gente pega o "telefone" para falar com o banco de dados.
import { PrismaClient } from "@prisma/client";

// Tecnico: Cria uma unica instancia do Prisma para ser reutilizada no backend inteiro.
// Crianca: Criamos um ajudante so para nao ficar abrindo mil telefones.
export const prisma = new PrismaClient();
