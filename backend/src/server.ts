import cors from "@fastify/cors";
import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";

import { env, origemPermitida } from "./env.js";
import { listarSalas } from "./socialState.js";
import { registrarEventosSocket } from "./socket.js";

async function criarServidor() {
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origemPermitida(origin));
    },
    credentials: true
  });

  app.get("/health", async () => ({
    status: "ok",
    app: "dark-room-chat",
    timestamp: new Date().toISOString()
  }));

  app.get("/api/rooms", async () => ({
    rooms: listarSalas()
  }));

  const io = new SocketIOServer(app.server, {
    cors: {
      origin(origin, callback) {
        callback(null, origemPermitida(origin));
      },
      credentials: true
    }
  });

  registrarEventosSocket(app, io);
  return { app, io };
}

async function iniciarServidor() {
  const { app, io } = await criarServidor();

  const encerrarServidor = async () => {
    app.log.info("[server] Encerrando...");
    await io.close();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void encerrarServidor());
  process.on("SIGTERM", () => void encerrarServidor());

  try {
    await app.listen({
      host: "0.0.0.0",
      port: env.PORT
    });
    app.log.info(`[server] HTTP + Socket.IO rodando em http://localhost:${env.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void iniciarServidor();
