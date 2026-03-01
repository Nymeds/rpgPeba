// Tecnico: Tipo de plugin para registrar rota de estado global.
// Crianca: Molde para criar a rota que mostra o mundo.
import type { FastifyPluginAsync } from "fastify";

// Tecnico: Prisma para leitura dos personagens.
// Crianca: Ferramenta para olhar os jogadores salvos.
import { prisma } from "../db.js";

// Tecnico: Constantes e normalizador de inventario.
// Crianca: Regras do mapa e organizacao da mochila.
import { MAP_SIZE, normalizarPlayerType, paraJogadorPublico } from "../game.js";
import {
  DEFAULT_MAP_KEY,
  atualizarGradeSolida,
  criarMapaPadrao,
  sinalizarMapaAtualizado,
  nomeMapaPadrao,
  normalizarMapKey,
  parsearMapaSalvo,
  serializarMapa,
  type PersistedMapData
} from "../realtime/mapEditor.js";
import { listOnlineCharacterIds } from "../realtime/world.js";
import { validarCorpoSalvarMapa } from "../schemas.js";

type MapRecord = {
  id: number;
  mapKey: string;
  name: string;
  mapSize: number;
  data: string;
  createdAt: Date;
  updatedAt: Date;
};

function validarIdsUnicos(items: Array<{ id: string }>): boolean {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      return false;
    }
    ids.add(item.id);
  }
  return true;
}

function respostaMapa(record: MapRecord): {
  map: {
    mapKey: string;
    name: string;
    mapSize: number;
    objects: PersistedMapData["objects"];
    layers: PersistedMapData["layers"];
    updatedAt: string;
  };
} {
  const parsedData = parsearMapaSalvo(record.data);
  return {
    map: {
      mapKey: record.mapKey,
      name: record.name,
      mapSize: record.mapSize,
      objects: parsedData.objects,
      layers: parsedData.layers,
      updatedAt: record.updatedAt.toISOString()
    }
  };
}

export const rotasMundo: FastifyPluginAsync = async (app) => {
  async function obterOuCriarMapa(mapKey: string): Promise<MapRecord> {
    const existing = await prisma.gameMap.findUnique({ where: { mapKey } });
    if (existing) {
      return existing;
    }

    return prisma.gameMap.create({
      data: {
        mapKey,
        name: nomeMapaPadrao(),
        mapSize: MAP_SIZE,
        data: serializarMapa(criarMapaPadrao())
      }
    });
  }

  // Tecnico: Precarrega o mapa padrao para ativar colisao mesmo antes de algum update HTTP.
  // Crianca: Liga as paredes do mapa assim que o servidor sobe.
  const defaultMap = await obterOuCriarMapa(DEFAULT_MAP_KEY);
  atualizarGradeSolida(parsearMapaSalvo(defaultMap.data));

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
        inventory: true,
        account: {
          select: {
            playerType: true
          }
        }
      }
    });
    const onlineCharacterIds = listOnlineCharacterIds();

    return reply.send({
      mapSize: MAP_SIZE,
      attacks: [],
      players: characters.map((character: (typeof characters)[number]) =>
        paraJogadorPublico(
          {
            id: character.id,
            name: character.name,
            x: character.x,
            y: character.y,
            hp: character.hp,
            maxHp: character.maxHp,
            inventory: character.inventory,
            playerType: normalizarPlayerType(character.account.playerType)
          },
          onlineCharacterIds
        )
      )
    });
  });

  app.get("/api/world/map", async (request, reply) => {
    const query = request.query as { mapKey?: string };
    const mapKey = normalizarMapKey(query?.mapKey);
    const mapRecord = await obterOuCriarMapa(mapKey);
    atualizarGradeSolida(parsearMapaSalvo(mapRecord.data));

    return reply.send(respostaMapa(mapRecord));
  });

  app.put(
    "/api/world/map",
    {
      preHandler: app.authenticate
    },
    async (request, reply) => {
      const parsedBody = validarCorpoSalvarMapa(request.body);
      if (!parsedBody.ok) {
        return reply.status(400).send({
          error: "Dados de mapa invalidos.",
          details: parsedBody.errors
        });
      }

      if (!validarIdsUnicos(parsedBody.data.objects) || !validarIdsUnicos(parsedBody.data.layers)) {
        return reply.status(400).send({
          error: "IDs duplicados em objetos ou layers."
        });
      }

      const mapData: PersistedMapData = {
        mapSize: MAP_SIZE,
        objects: parsedBody.data.objects.map((object) => ({
          ...object,
          cropX: object.cropX ?? null,
          cropY: object.cropY ?? null,
          cropWidth: object.cropWidth ?? null,
          cropHeight: object.cropHeight ?? null
        })),
        layers: parsedBody.data.layers
      };

      const updatedMap = await prisma.gameMap.upsert({
        where: {
          mapKey: parsedBody.data.mapKey
        },
        create: {
          mapKey: parsedBody.data.mapKey,
          name: parsedBody.data.name,
          mapSize: MAP_SIZE,
          data: serializarMapa(mapData)
        },
        update: {
          name: parsedBody.data.name,
          mapSize: MAP_SIZE,
          data: serializarMapa(mapData)
        }
      });

      atualizarGradeSolida(mapData);
      sinalizarMapaAtualizado();
      return reply.send(respostaMapa(updatedMap));
    }
  );
};
