//  Tipos do Fastify e Socket.IO usados no multiplayer.
// Moldes da API e do chat em tempo real.
import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";

//  Prisma para ler/escrever estado do jogo.
// Ferramenta para salvar posicao e vida dos jogadores.
import { prisma } from "./db.js";

//  Regras fixas de combate.
// Quanto bate e ate onde alcanca.
import { ATTACK_DAMAGE, ATTACK_RANGE } from "./socketConstants.js";

//  Utilitarios do dominio do jogo.
// Funcoes para limitar mapa, spawn e montar dados publicos.
import { limitarAoMapa, MAP_SIZE, SPAWN_POSITION, paraJogadorPublico } from "./game.js";

//  Validacoes dos eventos recebidos no socket (com Zod por baixo).
// Filtros para so aceitar comandos certinhos.
import { validarPayloadAtaque, validarPayloadMovimento } from "./schemas.js";

//  Set dos characterIds conectados em tempo real.
// Lista de quem esta online agora.
const idsPersonagensOnline = new Set<number>();

type ContextoSocket = {
  accountId: number;
  characterId: number;
};

type ConfirmacaoSocket = (response: { ok: boolean; error?: string }) => void;

function confirmarOk(confirmacao?: ConfirmacaoSocket): void {
  if (confirmacao) {
    confirmacao({ ok: true });
  }
}

function confirmarErro(confirmacao: ConfirmacaoSocket | undefined, mensagem: string): void {
  if (confirmacao) {
    confirmacao({ ok: false, error: mensagem });
  }
}

function calcularDistanciaManhattan(x1: number, y1: number, x2: number, y2: number): number {
  //  Distancia em grid ortogonal.
  // Numero de passos sem diagonal.
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function calcularProximaPosicao(direction: "up" | "down" | "left" | "right", x: number, y: number) {
  //  Move 1 tile mantendo limite do mapa.
  // Anda um quadradinho e nao sai do tabuleiro.
  switch (direction) {
    case "up":
      return { x, y: limitarAoMapa(y - 1) };
    case "down":
      return { x, y: limitarAoMapa(y + 1) };
    case "left":
      return { x: limitarAoMapa(x - 1), y };
    case "right":
      return { x: limitarAoMapa(x + 1), y };
    default:
      return { x, y };
  }
}

async function resolverContextoSocket(app: FastifyInstance, socket: Socket): Promise<ContextoSocket> {
  //  Token vem no handshake auth enviado pelo cliente.
  // Cracha vem junto quando conecta.
  const rawToken = socket.handshake.auth?.token;
  const token = typeof rawToken === "string" ? rawToken : "";
  if (!token) {
    throw new Error("Token ausente.");
  }

  //  Valida assinatura JWT e pega accountId.
  // Confere se o cracha e verdadeiro.
  const payload = app.jwt.verify<{ accountId: number }>(token);

  //  So conecta no mundo se conta ja tiver personagem.
  // Sem heroi criado, nao entra no mapa.
  const character = await prisma.character.findUnique({
    where: { accountId: payload.accountId },
    select: { id: true }
  });

  if (!character) {
    throw new Error("Crie um personagem antes de conectar no mundo.");
  }

  return {
    accountId: payload.accountId,
    characterId: character.id
  };
}

async function transmitirMundo(io: SocketIOServer): Promise<void> {
  //  Sem jogadores online, envia lista vazia.
  // Se ninguem esta jogando, mapa fica sem personagens.
  if (idsPersonagensOnline.size === 0) {
    io.emit("world:update", { mapSize: MAP_SIZE, players: [] });
    return;
  }

  //  Carrega apenas personagens conectados.
  // Pega dados so de quem esta online.
  const characters = await prisma.character.findMany({
    where: {
      id: {
        in: [...idsPersonagensOnline]
      }
    },
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

  io.emit("world:update", {
    mapSize: MAP_SIZE,
    players: characters.map((character) => paraJogadorPublico(character, idsPersonagensOnline))
  });
}

export function registrarEventosSocket(app: FastifyInstance, io: SocketIOServer): void {
  //  Middleware de autenticacao para toda conexao de socket.
  // Porteiro do canal em tempo real.
  io.use(async (socket, next) => {
    try {
      const context = await resolverContextoSocket(app, socket);
      socket.data.context = context;
      next();
    } catch {
      next(new Error("Falha de autenticacao no socket."));
    }
  });

  io.on("connection", (socket) => {
    const context = socket.data.context as ContextoSocket;
    idsPersonagensOnline.add(context.characterId);

    socket.emit("world:ready", {
      mapSize: MAP_SIZE,
      characterId: context.characterId
    });
    void transmitirMundo(io);

    socket.on("player:move", async (payload: unknown, confirmacao?: ConfirmacaoSocket) => {
      const parsedMove = validarPayloadMovimento(payload);
      if (!parsedMove.ok) {
        confirmarErro(confirmacao, parsedMove.errors.join(" | "));
        return;
      }

      try {
        const character = await prisma.character.findUnique({
          where: { id: context.characterId },
          select: { id: true, x: true, y: true }
        });

        if (!character) {
          confirmarErro(confirmacao, "Personagem nao encontrado.");
          return;
        }

        const nextPosition = calcularProximaPosicao(parsedMove.data.direction, character.x, character.y);
        const moved = nextPosition.x !== character.x || nextPosition.y !== character.y;

        if (moved) {
          await prisma.character.update({
            where: { id: character.id },
            data: { x: nextPosition.x, y: nextPosition.y }
          });
          await transmitirMundo(io);
        }

        confirmarOk(confirmacao);
      } catch {
        confirmarErro(confirmacao, "Falha ao mover o personagem.");
      }
    });

    socket.on("player:attack", async (payload: unknown, confirmacao?: ConfirmacaoSocket) => {
      const parsedAttack = validarPayloadAtaque(payload);
      if (!parsedAttack.ok) {
        confirmarErro(confirmacao, parsedAttack.errors.join(" | "));
        return;
      }

      try {
        const attacker = await prisma.character.findUnique({
          where: { id: context.characterId }
        });

        if (!attacker) {
          confirmarErro(confirmacao, "Personagem nao encontrado.");
          return;
        }

        const candidateIds = [...idsPersonagensOnline].filter((id) => id !== context.characterId);
        if (candidateIds.length === 0) {
          confirmarErro(confirmacao, "Nenhum alvo online.");
          return;
        }

        const targets = await prisma.character.findMany({
          where: {
            id: {
              in: candidateIds
            }
          }
        });

        const targetsInRange = targets.filter((target) => {
          const distance = calcularDistanciaManhattan(attacker.x, attacker.y, target.x, target.y);
          return target.hp > 0 && distance <= ATTACK_RANGE;
        });

        if (targetsInRange.length === 0) {
          confirmarErro(confirmacao, "Nenhum alvo no alcance de ataque.");
          return;
        }

        const selectedTarget = parsedAttack.data.targetId
          ? targetsInRange.find((target) => target.id === parsedAttack.data.targetId)
          : targetsInRange[0];

        if (!selectedTarget) {
          confirmarErro(confirmacao, "Alvo selecionado fora do alcance.");
          return;
        }

        const nextHp = selectedTarget.hp - ATTACK_DAMAGE;
        const defeated = nextHp <= 0;

        if (defeated) {
          await prisma.character.update({
            where: { id: selectedTarget.id },
            data: {
              hp: selectedTarget.maxHp,
              x: SPAWN_POSITION.x,
              y: SPAWN_POSITION.y
            }
          });
        } else {
          await prisma.character.update({
            where: { id: selectedTarget.id },
            data: {
              hp: nextHp
            }
          });
        }

        io.emit("combat:event", {
          attackerId: attacker.id,
          targetId: selectedTarget.id,
          damage: ATTACK_DAMAGE,
          defeated
        });

        await transmitirMundo(io);
        confirmarOk(confirmacao);
      } catch {
        confirmarErro(confirmacao, "Falha ao executar ataque.");
      }
    });

    socket.on("disconnect", () => {
      idsPersonagensOnline.delete(context.characterId);
      void transmitirMundo(io);
    });
  });
}
