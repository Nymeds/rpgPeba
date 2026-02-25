import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";

import { prisma } from "./db.js";
import { limitarAoMapa, MAP_SIZE, SPAWN_POSITION, paraJogadorPublico } from "./game.js";
import { validarPayloadAtaque, validarPayloadMovimento } from "./schemas.js";
import { ATTACK_DAMAGE, ATTACK_RANGE } from "./socketConstants.js";

const idsPersonagensOnline = new Set<number>();

type ContextoSocket = {
  accountId: number;
  characterId: number;
};

type ConfirmacaoSocket = (response: { ok: boolean; error?: string }) => void;

type Direcao = "up" | "down" | "left" | "right";

function responderSucesso(confirmacao?: ConfirmacaoSocket): void {
  confirmacao?.({ ok: true });
}

function responderErro(confirmacao: ConfirmacaoSocket | undefined, mensagem: string): void {
  confirmacao?.({ ok: false, error: mensagem });
}

function distanciaManhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function calcularProximaPosicao(direction: Direcao, x: number, y: number): { x: number; y: number } {
  switch (direction) {
    case "up":
      return { x, y: limitarAoMapa(y - 1) };
    case "down":
      return { x, y: limitarAoMapa(y + 1) };
    case "left":
      return { x: limitarAoMapa(x - 1), y };
    case "right":
      return { x: limitarAoMapa(x + 1), y };
  }
}

async function resolverContextoSocket(app: FastifyInstance, socket: Socket): Promise<ContextoSocket> {
  const rawToken = socket.handshake.auth?.token;
  const token = typeof rawToken === "string" ? rawToken : "";

  if (!token) {
    throw new Error("Token ausente.");
  }

  const payload = app.jwt.verify<{ accountId: number }>(token);

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
  if (idsPersonagensOnline.size === 0) {
    io.emit("world:update", { mapSize: MAP_SIZE, players: [] });
    return;
  }

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

async function lidarMovimento(
  io: SocketIOServer,
  context: ContextoSocket,
  payload: unknown,
  confirmacao?: ConfirmacaoSocket
): Promise<void> {
  const parsedMove = validarPayloadMovimento(payload);
  if (!parsedMove.ok) {
    responderErro(confirmacao, parsedMove.errors.join(" | "));
    return;
  }

  try {
    const character = await prisma.character.findUnique({
      where: { id: context.characterId },
      select: { id: true, x: true, y: true }
    });

    if (!character) {
      responderErro(confirmacao, "Personagem nao encontrado.");
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

    responderSucesso(confirmacao);
  } catch {
    responderErro(confirmacao, "Falha ao mover o personagem.");
  }
}

async function lidarAtaque(
  io: SocketIOServer,
  context: ContextoSocket,
  payload: unknown,
  confirmacao?: ConfirmacaoSocket
): Promise<void> {
  const parsedAttack = validarPayloadAtaque(payload);
  if (!parsedAttack.ok) {
    responderErro(confirmacao, parsedAttack.errors.join(" | "));
    return;
  }

  try {
    const attacker = await prisma.character.findUnique({
      where: { id: context.characterId }
    });

    if (!attacker) {
      responderErro(confirmacao, "Personagem nao encontrado.");
      return;
    }

    const candidateIds = [...idsPersonagensOnline].filter((id) => id !== context.characterId);
    if (candidateIds.length === 0) {
      responderErro(confirmacao, "Nenhum alvo online.");
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
      const distance = distanciaManhattan(attacker.x, attacker.y, target.x, target.y);
      return target.hp > 0 && distance <= ATTACK_RANGE;
    });

    if (targetsInRange.length === 0) {
      responderErro(confirmacao, "Nenhum alvo no alcance de ataque.");
      return;
    }

    const selectedTarget = parsedAttack.data.targetId
      ? targetsInRange.find((target) => target.id === parsedAttack.data.targetId)
      : targetsInRange[0];

    if (!selectedTarget) {
      responderErro(confirmacao, "Alvo selecionado fora do alcance.");
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
    responderSucesso(confirmacao);
  } catch {
    responderErro(confirmacao, "Falha ao executar ataque.");
  }
}

export function registrarEventosSocket(app: FastifyInstance, io: SocketIOServer): void {
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
      await lidarMovimento(io, context, payload, confirmacao);
    });

    socket.on("player:attack", async (payload: unknown, confirmacao?: ConfirmacaoSocket) => {
      await lidarAtaque(io, context, payload, confirmacao);
    });

    socket.on("disconnect", () => {
      idsPersonagensOnline.delete(context.characterId);
      void transmitirMundo(io);
    });
  });
}
