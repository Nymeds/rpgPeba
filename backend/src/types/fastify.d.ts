// Tecnico: Tipos base usados na extensao de interfaces do Fastify.
// Crianca: Importa moldes para ensinar ao TypeScript como nosso servidor funciona.
import type { FastifyReply, FastifyRequest } from "fastify";

// Tecnico: Import side-effect para habilitar merge de declaracao do plugin JWT.
// Crianca: Diz para o TypeScript que vamos mexer no pacote de token.
import "@fastify/jwt";
import "fastify";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    // Tecnico: Estrutura do payload assinado no token.
    // Crianca: O que vai escrito no cracha do jogador.
    payload: {
      accountId: number;
      username: string;
    };

    // Tecnico: Estrutura que request.user passa a ter apos jwtVerify().
    // Crianca: Dados do jogador que ficam disponiveis durante a requisicao.
    user: {
      accountId: number;
      username: string;
    };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    // Tecnico: Funcao decorada no app para proteger rotas por JWT.
    // Crianca: Porteiro que confere o cracha antes de deixar entrar.
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
