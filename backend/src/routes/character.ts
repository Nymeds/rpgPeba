// Tecnico: Tipo de plugin para registrar rotas no Fastify.
// Crianca: Molde para montar caminhos da API.
import type { FastifyPluginAsync } from "fastify";

// Tecnico: Prisma para persistencia.
// Crianca: Ferramenta para salvar e ler no banco.
import { prisma } from "../db.js";

// Tecnico: Regras do jogo e funcoes de inventario.
// Crianca: Pecas que ajudam a criar o personagem e mochila.
import {
  INVENTORY_SLOTS,
  normalizarInventario,
  normalizarPlayerType,
  serializarInventario,
  SPAWN_POSITION
} from "../game.js";

// Tecnico: Validadores (com Zod por baixo) para manter o fluxo limpo.
// Crianca: Regras do heroi e da mochila.
import { validarCorpoAtualizarInventario, validarCorpoCriarPersonagem } from "../schemas.js";

// Tecnico: Selecao de campos publicos do personagem para respostas HTTP.
// Crianca: Dados do heroi que o cliente precisa enxergar.
const characterSelect = {
  id: true,
  name: true,
  x: true,
  y: true,
  hp: true,
  maxHp: true,
  inventory: true
} as const;

export const rotasPersonagem: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/characters",
    {
      // Tecnico: Apenas conta autenticada pode criar personagem.
      // Crianca: So jogador logado pode criar heroi.
      preHandler: app.authenticate
    },
    async (request, reply) => {
      // Tecnico: Valida nome do personagem.
      // Crianca: Confere se o nome escolhido e valido.
      const parsedBody = validarCorpoCriarPersonagem(request.body);
      if (!parsedBody.ok) {
        return reply.status(400).send({
          error: "Dados do personagem invalidos.",
          details: parsedBody.errors
        });
      }

      // Tecnico: Regra de negocio: uma conta = um personagem.
      // Crianca: Cada conta so pode ter um heroi.
      const existingCharacter = await prisma.character.findUnique({
        where: { accountId: request.user.accountId }
      });

      if (existingCharacter) {
        return reply.status(409).send({
          error: "Esta conta ja possui um personagem."
        });
      }

      // Tecnico: Remove espacos extras do nome.
      // Crianca: Da uma aparada no comeco/fim do nome.
      const name = parsedBody.data.name.trim();

      // Tecnico: Nome de personagem precisa ser unico no mundo.
      // Crianca: Nao pode ter dois herois com o mesmo nome.
      const duplicatedName = await prisma.character.findUnique({ where: { name } });
      if (duplicatedName) {
        return reply.status(409).send({
          error: "Nome de personagem indisponivel."
        });
      }

      // Tecnico: Busca a classe salva no cadastro para anexar no personagem retornado.
      // Crianca: Descobre se essa conta escolheu Monk ou Warrior.
      const account = await prisma.account.findUnique({
        where: { id: request.user.accountId },
        select: { playerType: true }
      });

      if (!account) {
        return reply.status(404).send({
          error: "Conta nao encontrada."
        });
      }

      // Tecnico: Cria personagem no spawn com HP cheio e inventario vazio serializado.
      // Crianca: Nasce no centro, vida completa e mochila vazia.
      const createdCharacter = await prisma.character.create({
        data: {
          accountId: request.user.accountId,
          name,
          x: SPAWN_POSITION.x,
          y: SPAWN_POSITION.y,
          hp: 100,
          maxHp: 100,
          inventory: serializarInventario(Array.from({ length: INVENTORY_SLOTS }, () => null))
        },
        select: characterSelect
      });

      return reply.status(201).send({
        character: {
          ...createdCharacter,
          inventory: normalizarInventario(createdCharacter.inventory),
          playerType: normalizarPlayerType(account.playerType)
        }
      });
    }
  );

  app.get(
    "/api/characters/me",
    {
      // Tecnico: Requer autenticacao.
      // Crianca: So dono da conta pode ver seu heroi.
      preHandler: app.authenticate
    },
    async (request, reply) => {
      // Tecnico: Busca personagem da conta logada.
      // Crianca: Procura o heroi desse jogador.
      const character = await prisma.character.findUnique({
        where: { accountId: request.user.accountId },
        select: {
          ...characterSelect,
          account: {
            select: {
              playerType: true
            }
          }
        }
      });

      if (!character) {
        return reply.status(404).send({
          error: "Personagem nao encontrado."
        });
      }

      const { account, ...publicCharacter } = character;

      return reply.send({
        character: {
          ...publicCharacter,
          inventory: normalizarInventario(publicCharacter.inventory),
          playerType: normalizarPlayerType(account.playerType)
        }
      });
    }
  );

  app.post(
    "/api/characters/me/inventory",
    {
      // Tecnico: Requer autenticacao para editar inventario.
      // Crianca: So o dono pode mexer na propria mochila.
      preHandler: app.authenticate
    },
    async (request, reply) => {
      // Tecnico: Valida slot e item.
      // Crianca: Confere qual espacinho vai mudar.
      const parsedBody = validarCorpoAtualizarInventario(request.body);
      if (!parsedBody.ok) {
        return reply.status(400).send({
          error: "Atualizacao de inventario invalida.",
          details: parsedBody.errors
        });
      }

      // Tecnico: Busca inventario atual para editar slot.
      // Crianca: Pega a mochila atual antes de trocar item.
      const character = await prisma.character.findUnique({
        where: { accountId: request.user.accountId },
        select: {
          id: true,
          inventory: true,
          account: {
            select: {
              playerType: true
            }
          }
        }
      });

      if (!character) {
        return reply.status(404).send({
          error: "Personagem nao encontrado."
        });
      }

      // Tecnico: Converte JSON string para array e atualiza slot.
      // Crianca: Abre a mochila, troca o item e fecha de novo.
      const inventory = normalizarInventario(character.inventory);
      inventory[parsedBody.data.slot] = parsedBody.data.item;

      // Tecnico: Persiste inventario atualizado em formato serializado.
      // Crianca: Salva a mochila nova no banco.
      const updatedCharacter = await prisma.character.update({
        where: { id: character.id },
        data: {
          inventory: serializarInventario(inventory)
        },
        select: characterSelect
      });

      return reply.send({
        character: {
          ...updatedCharacter,
          inventory: normalizarInventario(updatedCharacter.inventory),
          playerType: normalizarPlayerType(character.account.playerType)
        }
      });
    }
  );
};
