import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";

import { prisma } from "./db.js";
import { MAP_SIZE, normalizarInventario } from "./game.js";
import { validarPayloadMovimento } from "./schemas.js";
import { emitWorldUpdate, startGameLoop } from "./realtime/gameLoop.js";
import type { SessionReadyPayload, SocketAck } from "./realtime/types.js";
import {
  collectDirtyPositions,
  getSocketIdByCharacterId,
  markPositionsAsDirty,
  registerOnlinePlayer,
  removeOnlinePlayer,
  setPlayerInput
} from "./realtime/world.js";

type JwtSessionPayload = {
  accountId: number;
  username: string;
};

type SocketSession = {
  accountId: number;
  username: string;
  characterId: number;
  characterName: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: Array<string | null>;
};

function responder(confirmacao: SocketAck | undefined, ok: boolean, error?: string): void {
  if (ok) {
    confirmacao?.({ ok: true });
    return;
  }

  confirmacao?.({ ok: false, error: error ?? "Falha desconhecida." });
}

function extrairTokenHandshake(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim().length > 0) {
    return authToken.trim();
  }

  const headerAuthorization = socket.handshake.headers.authorization;
  if (typeof headerAuthorization === "string" && headerAuthorization.startsWith("Bearer ")) {
    return headerAuthorization.slice(7).trim();
  }

  return null;
}

async function persistirPosicoesPendentes(app: FastifyInstance, motivo: string): Promise<void> {
  const dirtyPositions = collectDirtyPositions();
  if (dirtyPositions.length === 0) {
    return;
  }

  app.log.info(`[socket][persist] motivo=${motivo} salvando ${dirtyPositions.length} personagem(ns).`);

  try {
    await prisma.$transaction(
      dirtyPositions.map((position) =>
        prisma.character.update({
          where: { id: position.characterId },
          data: {
            x: position.x,
            y: position.y
          }
        })
      )
    );
  } catch (error) {
    markPositionsAsDirty(dirtyPositions.map((position) => position.characterId));
    app.log.error(error, "[socket][persist] falha ao salvar posicoes no banco; marcando novamente como dirty.");
  }
}

async function persistirPosicaoDesconexao(app: FastifyInstance, session: SocketSession): Promise<void> {
  const x = Math.round(session.x);
  const y = Math.round(session.y);

  try {
    await prisma.character.update({
      where: { id: session.characterId },
      data: { x, y }
    });
    app.log.info(
      `[socket][disconnect] posicao final salva para ${session.characterName} (${session.characterId}) em (${x}, ${y}).`
    );
  } catch (error) {
    app.log.error(error, "[socket][disconnect] falha ao persistir posicao final no banco.");
  }
}

export function registrarEventosSocket(app: FastifyInstance, io: SocketIOServer): void {
  const stopGameLoop = startGameLoop(app, io);
  const persistInterval = setInterval(() => {
    void persistirPosicoesPendentes(app, "intervalo");
  }, 2000);

  app.addHook("onClose", async () => {
    clearInterval(persistInterval);
    stopGameLoop();
    await persistirPosicoesPendentes(app, "encerramento");
  });

  io.use(async (socket, next) => {
    try {
      const token = extrairTokenHandshake(socket);
      if (!token) {
        next(new Error("Token JWT ausente no handshake do socket."));
        return;
      }

      const payload = app.jwt.verify<JwtSessionPayload>(token);
      const account = await prisma.account.findUnique({
        where: { id: payload.accountId },
        select: {
          id: true,
          username: true,
          character: {
            select: {
              id: true,
              name: true,
              x: true,
              y: true,
              hp: true,
              maxHp: true,
              inventory: true
            }
          }
        }
      });

      if (!account || !account.character) {
        next(new Error("Conta sem personagem. Crie um personagem antes de abrir o socket."));
        return;
      }

      const session: SocketSession = {
        accountId: account.id,
        username: account.username,
        characterId: account.character.id,
        characterName: account.character.name,
        x: account.character.x,
        y: account.character.y,
        hp: account.character.hp,
        maxHp: account.character.maxHp,
        inventory: normalizarInventario(account.character.inventory)
      };

      (socket.data as { session?: SocketSession }).session = session;

      app.log.info(
        [
          "[socket][auth] handshake validado",
          `socket=${socket.id}`,
          `account=${session.username}(${session.accountId})`,
          `character=${session.characterName}(${session.characterId})`
        ].join(" | ")
      );

      next();
    } catch (error) {
      app.log.warn(error, "[socket][auth] rejeitando socket por falha de autenticacao.");
      next(new Error("Falha na autenticacao do socket."));
    }
  });

  io.on("connection", (socket) => {
    const session = (socket.data as { session: SocketSession }).session;

    const previousSocketId = getSocketIdByCharacterId(session.characterId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        app.log.info(
          `[socket][connection] conta duplicada detectada. desconectando socket antigo=${previousSocketId}.`
        );
        previousSocket.disconnect(true);
      }
    }

    registerOnlinePlayer({
      socketId: socket.id,
      accountId: session.accountId,
      characterId: session.characterId,
      username: session.username,
      name: session.characterName,
      x: session.x,
      y: session.y,
      hp: session.hp,
      maxHp: session.maxHp,
      inventory: session.inventory
    });

    const sessionReadyPayload: SessionReadyPayload = {
      playerId: session.characterId,
      playerName: session.characterName,
      mapSize: MAP_SIZE
    };

    socket.emit("session:ready", sessionReadyPayload);
    emitWorldUpdate(io, 0);

    app.log.info(
      `[socket][connection] player conectado | socket=${socket.id} | player=${session.characterName} | pos=(${session.x}, ${session.y})`
    );

    socket.on("player:move", (payload: unknown, confirmacao?: SocketAck) => {
      const parsedMove = validarPayloadMovimento(payload);
      if (!parsedMove.ok) {
        responder(confirmacao, false, parsedMove.errors.join(" | "));
        return;
      }

      const updated = setPlayerInput(socket.id, parsedMove.data.direction);
      if (!updated) {
        responder(confirmacao, false, "Jogador nao encontrado no estado online.");
        return;
      }

      app.log.info(
        [
          "[socket][input]",
          `player=${session.characterName}`,
          `socket=${socket.id}`,
          `direction=${parsedMove.data.direction ?? "stop"}`,
          "emit(front)->on(back)->setInput(ok)"
        ].join(" | ")
      );

      responder(confirmacao, true);
    });

    socket.on("disconnect", (reason) => {
      const removed = removeOnlinePlayer(socket.id);
      if (!removed) {
        return;
      }

      void persistirPosicaoDesconexao(app, {
        accountId: removed.accountId,
        username: removed.username,
        characterId: removed.characterId,
        characterName: removed.name,
        x: removed.x,
        y: removed.y,
        hp: removed.hp,
        maxHp: removed.maxHp,
        inventory: removed.inventory
      });

      emitWorldUpdate(io, 0);
      app.log.info(
        `[socket][disconnect] player saiu | socket=${socket.id} | player=${removed.name} | reason=${reason}`
      );
    });
  });
}
