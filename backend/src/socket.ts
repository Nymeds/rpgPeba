import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";

import { validarNicknameSocket, validarPayloadMensagemChat, validarPayloadSala } from "./socialSchemas.js";
import {
  entrarNaSala,
  listarSalas,
  listarUsuariosSala,
  obterNicknamePorSocket,
  publicarMensagem,
  registrarUsuarioConectado,
  removerUsuarioConectado,
  sairDaSala
} from "./socialState.js";

type ConfirmacaoSocket = (response: { ok: boolean; error?: string }) => void;

function responder(confirmacao: ConfirmacaoSocket | undefined, ok: boolean, erro?: string): void {
  if (ok) {
    confirmacao?.({ ok: true });
    return;
  }
  confirmacao?.({ ok: false, error: erro ?? "Falha desconhecida." });
}

function extrairNicknameHandshake(socket: Socket): unknown {
  return socket.handshake.auth?.nickname;
}

function emitirListaSalas(io: SocketIOServer): void {
  io.emit("room:list", { rooms: listarSalas() });
}

function emitirUsuariosDaSala(io: SocketIOServer, roomName: string): void {
  io.to(roomName).emit("room:users", {
    roomName,
    users: listarUsuariosSala(roomName)
  });
}

function entrarOuCriarSala(
  app: FastifyInstance,
  io: SocketIOServer,
  socket: Socket,
  payload: unknown,
  confirmacao: ConfirmacaoSocket | undefined,
  acao: "create" | "join"
): void {
  const parsedRoom = validarPayloadSala(payload);
  if (!parsedRoom.ok) {
    responder(confirmacao, false, parsedRoom.errors.join(" | "));
    return;
  }

  const roomName = parsedRoom.data.roomName;
  const resultado = entrarNaSala(socket.id, roomName);
  if (!resultado) {
    responder(confirmacao, false, "Sessao de usuario invalida.");
    return;
  }

  if (resultado.leftRoomName) {
    socket.leave(resultado.leftRoomName);
    emitirUsuariosDaSala(io, resultado.leftRoomName);
  }

  socket.join(roomName);
  socket.emit("room:joined", {
    roomName: resultado.roomName,
    users: resultado.users,
    messages: resultado.messages
  });

  emitirUsuariosDaSala(io, roomName);
  emitirListaSalas(io);

  const nickname = obterNicknamePorSocket(socket.id) ?? "anon";
  app.log.info(`[room] @${nickname} ${acao === "create" ? "criou/entrou em" : "entrou em"} ${roomName}`);
  responder(confirmacao, true);
}

export function registrarEventosSocket(app: FastifyInstance, io: SocketIOServer): void {
  io.use((socket, next) => {
    const parsedNickname = validarNicknameSocket(extrairNicknameHandshake(socket));
    if (!parsedNickname.ok) {
      next(new Error(parsedNickname.errors.join(" | ")));
      return;
    }

    const nickname = registrarUsuarioConectado(socket.id, parsedNickname.data);
    socket.data.nickname = nickname;
    next();
  });

  io.on("connection", (socket) => {
    const nickname = socket.data.nickname as string;

    socket.emit("session:ready", {
      nickname,
      rooms: listarSalas()
    });

    emitirListaSalas(io);
    app.log.info(`[socket] @${nickname} conectado.`);

    socket.on("room:create", (payload: unknown, confirmacao?: ConfirmacaoSocket) => {
      entrarOuCriarSala(app, io, socket, payload, confirmacao, "create");
    });

    socket.on("room:join", (payload: unknown, confirmacao?: ConfirmacaoSocket) => {
      entrarOuCriarSala(app, io, socket, payload, confirmacao, "join");
    });

    socket.on("room:leave", (confirmacao?: ConfirmacaoSocket) => {
      const resultado = sairDaSala(socket.id);
      if (!resultado) {
        responder(confirmacao, true);
        return;
      }

      socket.leave(resultado.roomName);
      socket.emit("room:left", {
        roomName: resultado.roomName
      });

      emitirUsuariosDaSala(io, resultado.roomName);
      emitirListaSalas(io);

      const author = obterNicknamePorSocket(socket.id) ?? nickname;
      app.log.info(`[room] @${author} saiu de ${resultado.roomName}`);
      responder(confirmacao, true);
    });

    socket.on("chat:send", (payload: unknown, confirmacao?: ConfirmacaoSocket) => {
      const parsedMessage = validarPayloadMensagemChat(payload);
      if (!parsedMessage.ok) {
        responder(confirmacao, false, parsedMessage.errors.join(" | "));
        return;
      }

      const publicado = publicarMensagem(socket.id, parsedMessage.data.text);
      if (!publicado) {
        responder(confirmacao, false, "Entre em uma sala antes de enviar mensagens.");
        return;
      }

      io.to(publicado.roomName).emit("chat:new-message", publicado);
      const author = obterNicknamePorSocket(socket.id) ?? nickname;
      app.log.info(`[chat][${publicado.roomName}] @${author}: ${parsedMessage.data.text}`);
      responder(confirmacao, true);
    });

    socket.on("disconnect", (reason) => {
      const removido = removerUsuarioConectado(socket.id);
      if (!removido) {
        return;
      }

      if (removido.roomName) {
        emitirUsuariosDaSala(io, removido.roomName);
      }
      emitirListaSalas(io);
      app.log.info(`[socket] @${removido.nickname} desconectou (${reason}).`);
    });
  });
}
