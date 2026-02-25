// Tecnico: Tipos de resposta para chamadas REST.
// Crianca: Moldes das caixinhas que voltam da API.
import type { AuthResponse, CharacterResponse, WorldUpdate } from "./types";

// Tecnico: Endereco base da API, vindo do .env do Vite.
// Crianca: Onde mora o backend.
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// Tecnico: Endereco do websocket; por padrao usa a mesma origem da API.
// Crianca: Endereco do canal em tempo real.
export const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL;

// Tecnico: Formato esperado de erro da API.
// Crianca: Pacotinho de erro com mensagem principal e detalhes.
type ErrorPayload = {
  error?: string;
  details?: string[];
};

async function lerJsonComSeguranca(response: Response): Promise<unknown> {
  // Tecnico: Tenta converter corpo para JSON sem explodir em respostas vazias.
  // Crianca: Tenta abrir o pacote; se vier vazio, retorna nulo.
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requisicao<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  // Tecnico: Clona headers para manter compatibilidade com RequestInit parcial.
  // Crianca: Prepara o envelope para enviar a carta.
  const headers = new Headers(options.headers ?? {});
  headers.set("Content-Type", "application/json");

  // Tecnico: Se token presente, injeta Authorization Bearer.
  // Crianca: Se ja esta logado, envia o cracha junto.
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // Tecnico: Executa fetch no endpoint concatenado com API_URL.
  // Crianca: Envia a carta para o servidor certo.
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers
  });

  // Tecnico: Leitura resiliente do JSON de retorno.
  // Crianca: Abre a resposta com cuidado.
  const payload = await lerJsonComSeguranca(response);

  if (!response.ok) {
    // Tecnico: Monta mensagem amigavel com detalhes de validacao, quando houver.
    // Crianca: Junta o motivo do erro para ficar facil de entender.
    const errorPayload = payload as ErrorPayload | null;
    const details =
      errorPayload?.details && errorPayload.details.length > 0
        ? ` (${errorPayload.details.join(" | ")})`
        : "";

    throw new Error(`${errorPayload?.error ?? `Erro HTTP ${response.status}`}${details}`);
  }

  // Tecnico: Cast final para tipo esperado pela chamada.
  // Crianca: Devolve a resposta no formato combinado.
  return payload as T;
}

export function cadastrarConta(username: string, password: string): Promise<AuthResponse> {
  // Tecnico: Cadastro de nova conta.
  // Crianca: Cria usuario novo no jogo.
  return requisicao<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function entrarConta(username: string, password: string): Promise<AuthResponse> {
  // Tecnico: Login de conta existente.
  // Crianca: Entra com usuario e senha.
  return requisicao<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export function buscarMinhaConta(token: string): Promise<AuthResponse> {
  // Tecnico: Consulta sessao atual autenticada.
  // Crianca: Pergunta "quem sou eu?" usando o cracha.
  return requisicao<AuthResponse>("/api/auth/me", { method: "GET" }, token);
}

export function criarPersonagem(token: string, name: string): Promise<CharacterResponse> {
  // Tecnico: Cria personagem para conta autenticada.
  // Crianca: Cria o heroi da conta.
  return requisicao<CharacterResponse>(
    "/api/characters",
    {
      method: "POST",
      body: JSON.stringify({ name })
    },
    token
  );
}

export function buscarEstadoMundo(token?: string): Promise<WorldUpdate> {
  // Tecnico: Snapshot HTTP do estado do mundo (nao realtime).
  // Crianca: Pega uma foto do mapa naquele momento.
  return requisicao<WorldUpdate>("/api/world/state", { method: "GET" }, token);
}
