// Tecnico: Carrega variaveis do arquivo .env para process.env.
// Crianca: Pega os ajustes guardados em arquivo para o servidor usar.
import "dotenv/config";

function obterEnvObrigatorio(name: string): string {
  // Tecnico: Busca valor obrigatorio no ambiente.
  // Crianca: Pega uma configuracao que nao pode faltar.
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Variavel obrigatoria ausente: ${name}`);
  }
  return value.trim();
}

function converterPorta(rawPort: string | undefined): number {
  // Tecnico: Converte porta para numero inteiro positivo.
  // Crianca: Confere se o numero da porta e valido.
  if (!rawPort || rawPort.trim().length === 0) {
    return 3000;
  }

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error("PORT invalida. Use inteiro positivo.");
  }

  return parsedPort;
}

function separarOrigensCors(rawValue: string | undefined): string[] {
  // Tecnico: Divide string CSV em lista limpa de origens.
  // Crianca: Separa os enderecos permitidos por virgula.
  const source = rawValue && rawValue.trim().length > 0 ? rawValue : "http://localhost:5173";
  return source
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// Tecnico: Objeto de configuracao final do backend.
// Crianca: Caixa principal com os ajustes do servidor.
export const env = {
  DATABASE_URL: obterEnvObrigatorio("DATABASE_URL"),
  PORT: converterPorta(process.env.PORT),
  JWT_SECRET: obterEnvObrigatorio("JWT_SECRET"),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:5173"
};

if (env.JWT_SECRET.length < 16) {
  // Tecnico: Mantem regra minima de seguranca para assinatura JWT.
  // Crianca: A senha secreta precisa ser grande para ser forte.
  throw new Error("JWT_SECRET precisa ter no minimo 16 caracteres.");
}

// Tecnico: Lista de origens explicitas.
// Crianca: Enderecos convidados.
export const corsOrigins = separarOrigensCors(env.CORS_ORIGIN);

// Tecnico: Set para validacao rapida por origem exata.
// Crianca: Lista super rapida para perguntar se a origem esta liberada.
const corsOriginSet = new Set(corsOrigins);

// Tecnico: Set com hostnames permitidos (sem porta).
// Crianca: Guarda so o nome base das maquinas.
const corsHostSet = new Set<string>();

for (const origin of corsOrigins) {
  try {
    corsHostSet.add(new URL(origin).hostname);
  } catch {
    // Tecnico: Ignora origem mal formada para nao quebrar boot.
    // Crianca: Se endereco vier errado, apenas pula.
  }
}

function ehHostPrivadoOuVpn(hostname: string): boolean {
  // Tecnico: Aceita localhost e loopback.
  // Crianca: Libera o proprio PC.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  // Tecnico: Faixas privadas mais comuns + 26.x para redes VPN.
  // Crianca: Libera redes de casa e de VPN.
  if (hostname.startsWith("192.168.") || hostname.startsWith("10.") || hostname.startsWith("26.")) {
    return true;
  }

  if (!hostname.startsWith("172.")) {
    return false;
  }

  // Tecnico: Aceita somente 172.16 ate 172.31.
  // Crianca: Faixa especial de rede privada no bloco 172.
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const secondOctet = Number(parts[1]);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

export function origemPermitida(origin?: string): boolean {
  // Tecnico: Origem vazia pode acontecer fora do navegador.
  // Crianca: Se nao veio endereco, deixamos passar.
  if (!origin) {
    return true;
  }

  // Tecnico: Primeiro tenta match exato.
  // Crianca: Se esta na lista oficial, entra.
  if (corsOriginSet.has(origin)) {
    return true;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  // Tecnico: Permite apenas protocolos web comuns.
  // Crianca: So vale endereco de site normal.
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return false;
  }

  // Tecnico: Se hostname estiver liberado, aceita mesmo com outra porta.
  // Crianca: Mesma maquina com outra porta tambem pode.
  if (corsHostSet.has(parsedOrigin.hostname)) {
    return true;
  }

  // Tecnico: Fallback para rede local/VPN.
  // Crianca: Endereco de rede interna pode entrar.
  return ehHostPrivadoOuVpn(parsedOrigin.hostname);
}
