import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";

import { prisma } from "./db.js";
import { MAP_SIZE, PlayerType, normalizarInventario, normalizarPlayerType } from "./game.js";
import { logError, logInfo, logWarn } from "./logger.js";
import { validarPayloadAtaque, validarPayloadMovimento } from "./schemas.js";
import { appendChatMessage, buildChatHistoryPayload, initializeChatHistory } from "./realtime/chat.js";
import { emitWorldUpdate, startGameLoop } from "./realtime/gameLoop.js";
import type {
  ChatSendPayload,
  SessionReadyPayload,
  SocketAck
} from "./realtime/types.js";
import {
  collectDirtyStates,
  createPlayerAttack,
  getSocketIdByCharacterId,
  markPlayersAsDirty,
  registerOnlinePlayer,
  removeOnlinePlayer,
  setPlayerInput
} from "./realtime/world.js";
import { handlePlayerChatForAi } from "./realtime/enemies.js";

type JwtSessionPayload = {
  accountId: number;
  username: string;
};

type SocketSession = {
  accountId: number;
  username: string;
  characterId: number;
  characterName: string;
  playerType: PlayerType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: Array<string | null>;
};

let realtimeJaInicializado = false;
const CHAT_MESSAGE_MAX_LENGTH = 220;

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

function parseChatPayload(payload: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Payload de chat invalido." };
  }

  const text = (payload as ChatSendPayload).text;
  if (typeof text !== "string") {
    return { ok: false, error: "Mensagem de chat deve ser string." };
  }

  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return { ok: false, error: "Mensagem vazia." };
  }

  return {
    ok: true,
    text: normalized.slice(0, CHAT_MESSAGE_MAX_LENGTH)
  };
}

async function persistirPosicoesPendentes(app: FastifyInstance, motivo: string): Promise<void> {
  const dirtyStates = collectDirtyStates();
  if (dirtyStates.length === 0) {
    return;
  }

  logInfo("DB", "Persistindo posicoes", {
    reason: motivo,
    players: dirtyStates.length
  });

  try {
    await prisma.$transaction(
      dirtyStates.map((state) =>
        prisma.character.update({
          where: { id: state.characterId },
          data: {
            x: state.x,
            y: state.y,
            hp: state.hp
          }
        })
      )
    );
  } catch (error) {
    markPlayersAsDirty(dirtyStates.map((state) => state.characterId));
    logError("DB", "Falha ao persistir posicoes", {
      reason: motivo,
      error: error instanceof Error ? error.message : "erro desconhecido"
    });
  }
}

async function persistirPosicaoDesconexao(app: FastifyInstance, session: SocketSession): Promise<void> {
  const x = Math.round(session.x);
  const y = Math.round(session.y);

  try {
    await prisma.character.update({
      where: { id: session.characterId },
      data: { x, y, hp: session.hp }
    });
    logInfo("DB", "Posicao final salva no disconnect", {
      player: session.characterName,
      charId: session.characterId,
      x,
      y
    });
  } catch (error) {
    logError("DB", "Falha ao salvar posicao final", {
      player: session.characterName,
      charId: session.characterId,
      error: error instanceof Error ? error.message : "erro desconhecido"
    });
  }
}

export async function registrarEventosSocket(app: FastifyInstance, io: SocketIOServer): Promise<void> {
  if (realtimeJaInicializado) {
    logWarn("SOCKET", "Realtime ja inicializado, ignorando segundo bootstrap");
    return;
  }
  realtimeJaInicializado = true;

  try {
    await initializeChatHistory();
  } catch (error) {
    realtimeJaInicializado = false;
    logError("CHAT", "Falha ao carregar historico inicial do chat", {
      error: error instanceof Error ? error.message : "erro desconhecido"
    });
    throw error;
  }

  const stopGameLoop = startGameLoop(io);
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
        logWarn("AUTH", "Handshake sem token", { socket: socket.id });
        next(new Error("Token JWT ausente no handshake do socket."));
        return;
      }

      const payload = app.jwt.verify<JwtSessionPayload>(token);
      const account = await prisma.account.findUnique({
        where: { id: payload.accountId },
        select: {
          id: true,
          username: true,
          playerType: true,
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
        logWarn("AUTH", "Conta sem personagem no handshake", {
          socket: socket.id,
          accountId: payload.accountId
        });
        next(new Error("Conta sem personagem. Crie um personagem antes de abrir o socket."));
        return;
      }

      const session: SocketSession = {
        accountId: account.id,
        username: account.username,
        characterId: account.character.id,
        characterName: account.character.name,
        playerType: normalizarPlayerType(account.playerType),
        x: account.character.x,
        y: account.character.y,
        hp: account.character.hp,
        maxHp: account.character.maxHp,
        inventory: normalizarInventario(account.character.inventory)
      };

      (socket.data as { session?: SocketSession }).session = session;

      logInfo("AUTH", "Socket autenticado", {
        socket: socket.id,
        account: `${session.username}(${session.accountId})`,
        character: `${session.characterName}(${session.characterId})`
      });

      next();
    } catch (error) {
      logWarn("AUTH", "Falha na autenticacao do socket", {
        socket: socket.id,
        error: error instanceof Error ? error.message : "erro desconhecido"
      });
      next(new Error("Falha na autenticacao do socket."));
    }
  });

  io.on("connection", (socket) => {
    const session = (socket.data as { session: SocketSession }).session;

    const previousSocketId = getSocketIdByCharacterId(session.characterId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        logWarn("SOCKET", "Conexao duplicada detectada", {
          character: session.characterName,
          oldSocket: previousSocketId,
          newSocket: socket.id
        });
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
      inventory: session.inventory,
      playerType: session.playerType
    });

    const sessionReadyPayload: SessionReadyPayload = {
      playerId: session.characterId,
      playerName: session.characterName,
      mapSize: MAP_SIZE
    };
    const chatHistoryPayload = buildChatHistoryPayload();

    socket.emit("session:ready", sessionReadyPayload);
     //MURYLLO
    socket.emit("chat:history", chatHistoryPayload);
    emitWorldUpdate(io, 0);

    logInfo("SOCKET", "Player conectado", {
      socket: socket.id,
      player: session.characterName,
      pos: `(${session.x},${session.y})`
    });

//ACIMA SERVIDOR SUBIU QUEM SUBIU N SOBE MAIS, AQUI EMBAIXO VEM O QUE FICA ESCUTANDO O QUE O CLIENTE MANDA PRA GENTE, COMO MOVIMENTO E ATAQUE, E A GENTE PROCESSA ISSO AQUI E MANDA PRO MUNDO REALTIME PRA ELE ATUALIZAR O ESTADO DO JOGO E MANDAR PRO CLIENTE DEPOIS


    //escutar de movimento do cliente
    //ISABELA
    socket.on("player:move", (payload: unknown, confirmacao?: SocketAck) => {
      const parsedMove = validarPayloadMovimento(payload);
      if (!parsedMove.ok) {
        responder(confirmacao, false, parsedMove.errors.join(" | "));
        logWarn("INPUT", "Payload invalido", {
          socket: socket.id,
          player: session.characterName,
          error: parsedMove.errors.join(" | ")
        });
        return;
      }

      const updated = setPlayerInput(socket.id, {
        x: parsedMove.data.x,
        y: parsedMove.data.y
      });
      if (!updated) {
        responder(confirmacao, false, "Jogador nao encontrado no estado online.");
        logWarn("INPUT", "Jogador nao encontrado para input", {
          socket: socket.id,
          player: session.characterName
        });
        return;
      }

      logInfo("INPUT", "Direcao recebida", {
        player: session.characterName,
        socket: socket.id,
        input: `(${parsedMove.data.x.toFixed(2)},${parsedMove.data.y.toFixed(2)})`,
        flow: "frontend.emit(player:move)->backend.on->setInput"
      });

      responder(confirmacao, true);
    });
    //escutar de ataque do cliente
    //ISABELA
    socket.on("atack", (payload: unknown, confirmacao?: SocketAck) => {
      const parsedAtack = validarPayloadAtaque(payload);
      if (!parsedAtack.ok) {
        responder(confirmacao, false, parsedAtack.errors.join(" | "));
        logWarn("ATACK", "Payload invalido", {
          socket: socket.id,
          player: session.characterName,
          error: parsedAtack.errors.join(" | ")
        });
        return;
      }

      const range = parsedAtack.data.range ?? 1;
      const createdResult = createPlayerAttack(
        socket.id,
        { x: parsedAtack.data.dirX, y: parsedAtack.data.dirY },
        range
      );
      if (!createdResult.ok) {
        responder(confirmacao, false, createdResult.error);
        return;
      }
      const created = createdResult.attack;

      logInfo("ATACK", "Ataque criado", {
        player: created.ownerName,
        attackId: created.attackId,
        kind: created.kind,
        direction: `(${created.directionX.toFixed(2)},${created.directionY.toFixed(2)})`,
        range: created.range,
        attackPos: `(${created.x},${created.y})`,
        radius: created.radius.toFixed(2)
      });

      responder(confirmacao, true);
    });
    //MURYLLO
    socket.on("chat:send", async (payload: unknown, confirmacao?: SocketAck) => {
      const parsedChat = parseChatPayload(payload);
      if (!parsedChat.ok) {
        responder(confirmacao, false, parsedChat.error);
        logWarn("CHAT", "Mensagem invalida", {
          player: session.characterName,
          socket: socket.id,
          error: parsedChat.error
        });
        return;
      }

      try {
        const message = await appendChatMessage(session.characterId, session.characterName, parsedChat.text);
        io.emit("chat:message", message);
        handlePlayerChatForAi(session.characterId, session.characterName, message.text);
        responder(confirmacao, true);

        logInfo("CHAT", "Mensagem enviada", {
          player: session.characterName,
          socket: socket.id,
          messageId: message.id,
          chars: message.text.length
        });
      } catch (error) {
        responder(confirmacao, false, "Falha ao persistir mensagem no banco.");
        logError("CHAT", "Falha ao persistir mensagem de chat", {
          player: session.characterName,
          socket: socket.id,
          error: error instanceof Error ? error.message : "erro desconhecido"
        });
      }
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
        playerType: removed.playerType,
        x: removed.x,
        y: removed.y,
        hp: removed.hp,
        maxHp: removed.maxHp,
        inventory: removed.inventory
      });

      emitWorldUpdate(io, 0);
      logInfo("SOCKET", "Player desconectado", {
        socket: socket.id,
        player: removed.name,
        reason
      });
    });
  });
}
