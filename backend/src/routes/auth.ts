// Tecnico: Tipos do Fastify para plugin de rotas.
// Crianca: Moldes para criar as rotinhas da API.
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

// Tecnico: Biblioteca para hash e comparacao segura de senha.
// Crianca: Ferramenta para esconder a senha de verdade.
import bcrypt from "bcryptjs";

// Tecnico: Cliente Prisma para banco.
// Crianca: Telefone para conversar com o banco.
import { prisma } from "../db.js";

// Tecnico: Normaliza inventario do banco para formato fixo no retorno.
// Crianca: Arruma a mochila antes de mostrar no app.
import { normalizarInventario, normalizarPlayerType } from "../game.js";

// Tecnico: Validacoes de entrada (implementadas com Zod por baixo).
// Crianca: Regras para conferir formulario.
import { validarCorpoCadastro, validarCorpoLogin } from "../schemas.js";

// Tecnico: Tipo da conta com personagem opcional para retorno autenticado.
// Crianca: Pacote de dados da conta, com heroi se ja existir.
type AccountWithCharacter = {
  id: number;
  username: string;
  playerType: string;
  character: {
    id: number;
    name: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    inventory: string;
  } | null;
};

// Tecnico: Projecao de campos usada em consultas de conta + personagem.
// Crianca: Lista exata do que vamos pegar no banco para montar a resposta.
const accountSelect = {
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
} as const;

function montarRespostaAutenticacao(app: FastifyInstance, account: AccountWithCharacter) {
  // Tecnico: Assina JWT com identificacao da conta.
  // Crianca: Cria um cracha para o jogador continuar logado.
  const token = app.jwt.sign({
    accountId: account.id,
    username: account.username
  });
  const playerType = normalizarPlayerType(account.playerType);

  // Tecnico: Personagem pode ser nulo quando conta ainda nao criou heroi.
  // Crianca: Se nao existe heroi ainda, devolve vazio.
  const character = account.character
    ? {
        id: account.character.id,
        name: account.character.name,
        x: account.character.x,
        y: account.character.y,
        hp: account.character.hp,
        maxHp: account.character.maxHp,
        inventory: normalizarInventario(account.character.inventory),
        playerType
      }
    : null;

  // Tecnico: Retorno padrao da camada de autenticacao.
  // Crianca: Entrega cracha + dados basicos da conta e do heroi.
  return {
    token,
    account: {
      id: account.id,
      username: account.username,
      playerType
    },
    character
  };
}

export const rotasAutenticacao: FastifyPluginAsync = async (app) => {
  app.post("/api/auth/register", async (request, reply) => {
    // Tecnico: Valida payload de cadastro.
    // Crianca: Confere usuario e senha.
    const parsedBody = validarCorpoCadastro(request.body);
    if (!parsedBody.ok) {
      return reply.status(400).send({
        error: "Dados de cadastro invalidos.",
        details: parsedBody.errors
      });
    }

    // Tecnico: Normaliza username para evitar duplicidade por caixa alta/baixa.
    // Crianca: "PEBA" e "peba" viram o mesmo nome.
    const username = parsedBody.data.username.toLowerCase();

    // Tecnico: Bloqueia cadastro duplicado.
    // Crianca: Nao deixa duas contas com o mesmo nome.
    const existingAccount = await prisma.account.findUnique({ where: { username } });
    if (existingAccount) {
      return reply.status(409).send({
        error: "Username ja esta em uso."
      });
    }

    // Tecnico: Hash de senha com custo 10.
    // Crianca: Tranca a senha num cofre antes de guardar.
    const passwordHash = await bcrypt.hash(parsedBody.data.password, 10);

    // Tecnico: Cria conta no banco e retorna campos necessarios.
    // Crianca: Registra novo jogador na tabela.
    const account = await prisma.account.create({
      data: {
        username,
        passwordHash,
        playerType: parsedBody.data.playerType
      },
      select: accountSelect
    });

    return reply.status(201).send(montarRespostaAutenticacao(app, account));
  });

  app.post("/api/auth/login", async (request, reply) => {
    // Tecnico: Valida login.
    // Crianca: Confere o formulario de entrada.
    const parsedBody = validarCorpoLogin(request.body);
    if (!parsedBody.ok) {
      return reply.status(400).send({
        error: "Dados de login invalidos.",
        details: parsedBody.errors
      });
    }

    // Tecnico: Busca conta pelo username normalizado.
    // Crianca: Procura jogador pelo nome em minusculo.
    const username = parsedBody.data.username.toLowerCase();
    const account = await prisma.account.findUnique({
      where: { username },
      select: {
        ...accountSelect,
        passwordHash: true
      }
    });

    // Tecnico: Nao diferencia "usuario nao existe" de "senha errada" por seguranca.
    // Crianca: Mensagem igual para nao entregar pista para invasor.
    if (!account) {
      return reply.status(401).send({
        error: "Credenciais invalidas."
      });
    }

    // Tecnico: Compara senha digitada com hash salvo.
    // Crianca: Testa se a chave encaixa no cofre.
    const passwordOk = await bcrypt.compare(parsedBody.data.password, account.passwordHash);
    if (!passwordOk) {
      return reply.status(401).send({
        error: "Credenciais invalidas."
      });
    }

    // Tecnico: Remove passwordHash ao montar resposta.
    // Crianca: Nunca mostra a senha escondida de volta.
    return reply.send(
      montarRespostaAutenticacao(app, {
        id: account.id,
        username: account.username,
        playerType: account.playerType,
        character: account.character
      })
    );
  });

  app.get(
    "/api/auth/me",
    {
      // Tecnico: Rota protegida por JWT.
      // Crianca: So entra quem tem cracha valido.
      preHandler: app.authenticate
    },
    async (request, reply) => {
      // Tecnico: Busca dados atuais da conta autenticada.
      // Crianca: Pega os dados de quem esta logado agora.
      const account = await prisma.account.findUnique({
        where: { id: request.user.accountId },
        select: accountSelect
      });

      if (!account) {
        return reply.status(404).send({
          error: "Conta nao encontrada."
        });
      }

      return reply.send(montarRespostaAutenticacao(app, account));
    }
  );
};
