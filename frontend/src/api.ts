import type { AuthResponse, Character } from "./types";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
export const WS_URL = import.meta.env.VITE_WS_URL ?? API_URL;

type ApiErrorPayload = {
  error?: string;
  details?: string[];
};

type Credentials = {
  username: string;
  password: string;
};

function resolverMensagemErro(payload: ApiErrorPayload | null, fallback: string): string {
  if (!payload) {
    return fallback;
  }

  if (Array.isArray(payload.details) && payload.details.length > 0) {
    return `${payload.error ?? fallback} (${payload.details.join(" | ")})`;
  }

  return payload.error ?? fallback;
}

async function requisicaoJson<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const headers = new Headers(init.headers);

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      resolverMensagemErro(payload as ApiErrorPayload | null, `Falha HTTP ${response.status} em ${path}`)
    );
  }

  return payload as T;
}

export function registrarConta(input: Credentials): Promise<AuthResponse> {
  return requisicaoJson<AuthResponse>(
    "/api/auth/register",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function autenticarConta(input: Credentials): Promise<AuthResponse> {
  return requisicaoJson<AuthResponse>(
    "/api/auth/login",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function carregarSessao(token: string): Promise<AuthResponse> {
  return requisicaoJson<AuthResponse>(
    "/api/auth/me",
    {
      method: "GET"
    },
    token
  );
}

export function criarPersonagem(token: string, name: string): Promise<{ character: Character }> {
  return requisicaoJson<{ character: Character }>(
    "/api/characters",
    {
      method: "POST",
      body: JSON.stringify({ name })
    },
    token
  );
}
