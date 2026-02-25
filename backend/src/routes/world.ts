// Tecnico: Tipo de plugin para registrar rota de estado global.
// Crianca: Molde para criar a rota que mostra o mundo.
import type { FastifyPluginAsync } from "fastify";

// Tecnico: Prisma para leitura dos personagens.
// Crianca: Ferramenta para olhar os jogadores salvos.
import { prisma } from "../db.js";

// Tecnico: Constantes e normalizador de inventario.
// Crianca: Regras do mapa e organizacao da mochila.
import { MAP_SIZE, normalizarInventario } from "../game.js";

export const rotasMundo: FastifyPluginAsync = async (app) => {
  app.get("/api/world/state", async (_request, reply) => {
    // Tecnico: Busca todos os personagens para snapshot inicial do mundo.
    // Crianca: Pega a lista de todos os herois para desenhar no mapa.
    const characters = await prisma.character.findMany({
      select: {
        id: true,
        name: true,
        x: true,
        y: true,
        hp: true,
        maxHp: true,
        inventory: true
      }
    });

    // Tecnico: Esta rota nao rastreia online/offline em tempo real, entao online=false.
    // Crianca: Aqui e so uma foto do mundo; quem esta online de verdade vem pelo socket.
    return reply.send({
      mapSize: MAP_SIZE,
      players: characters.map((character) => ({
        id: character.id,
        name: character.name,
        x: character.x,
        y: character.y,
        hp: character.hp,
        maxHp: character.maxHp,
        inventory: normalizarInventario(character.inventory),
        online: false
      }))
    });
  });
};
