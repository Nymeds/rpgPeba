import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";

import { env, origemPermitida } from "./env.js";
import { logError, logInfo } from "./logger.js";
import { rotasAutenticacao } from "./routes/auth.js";
import { rotasPersonagem } from "./routes/character.js";
import { rotasMundo } from "./routes/world.js";
import { registrarEventosSocket } from "./socket.js";

async function criarServidor() {
  const app = Fastify({
    logger: false
  });

  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origemPermitida(origin));
    },
    credentials: true
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        error: "Token JWT invalido ou ausente."
      });
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    app: "rpg-peba-mmo",
    timestamp: new Date().toISOString()
  }));

  await app.register(rotasAutenticacao);
  await app.register(rotasPersonagem);
  await app.register(rotasMundo);

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
    logInfo("SERVER", "Encerrando aplicacao");
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
    logInfo("SERVER", "HTTP + Socket.IO online", {
      url: `http://localhost:${env.PORT}`
    });
  } catch (error) {
    logError("SERVER", "Falha ao iniciar", {
      error: error instanceof Error ? error.message : "erro desconhecido"
    });
    process.exit(1);
  }
}

void iniciarServidor();
