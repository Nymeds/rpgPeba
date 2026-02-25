import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import Fastify from "fastify";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "./db.js";
import { env, origemPermitida } from "./env.js";
import { rotasAutenticacao } from "./routes/auth.js";
import { rotasPersonagem } from "./routes/character.js";
import { rotasMundo } from "./routes/world.js";
import { registrarEventosSocket } from "./socket.js";

async function criarServidor() {

  const app = Fastify({
   // logger: true
  });
  //  Habilita CORS com callback dinamico por origem.
  // Para cada visita, pergunta se aquele endereco pode entrar.
  await app.register(cors, {
    origin(origin, callback) {
      callback(null, origemPermitida(origin));
    },
    credentials: true
  });
  await app.register(jwt, {
    secret: env.JWT_SECRET
  });

  // Decorator de autenticacao reutilizavel em rotas protegidas.
  // Cria um porteiro padrao para as portas privadas.
  app.decorate("authenticate", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({
        error: "Nao autorizado."
      });
    }
  });
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString()
  }));
  await app.register(rotasAutenticacao);
  await app.register(rotasPersonagem);
  await app.register(rotasMundo);

  //Cria Socket.IO no mesmo servidor HTTP, com politica CORS igual.
  //O chat em tempo real usa a mesma casa da API.
  const io = new SocketIOServer(app.server, {
    cors: {
      origin(origin, callback) {
        callback(null, origemPermitida(origin));
      },
      credentials: true
    }
  });
  //Conecta handlers de gameplay em tempo real.
  //Liga os botoes de andar e atacar.
  registrarEventosSocket(app, io);

  return { app, io };
}

async function iniciarServidor() {
  const { app, io } = await criarServidor();

  const encerrarServidor = async () => {
    app.log.info("Encerrando servidor...");
    await io.close();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void encerrarServidor());
  process.on("SIGTERM", () => void encerrarServidor());
  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0"
    });
    app.log.info(`HTTP e WebSocket rodando em http://localhost:${env.PORT}`);
  } catch (error) {
    app.log.error(error);
    await prisma.$disconnect();
    process.exit(1);
  }
}
void iniciarServidor();
