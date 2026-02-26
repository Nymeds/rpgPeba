import "dotenv/config";

function textoOuPadrao(name: string, fallback: string): string {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  return raw.trim();
}

function converterPorta(rawPort: string | undefined): number {
  if (!rawPort || rawPort.trim().length === 0) {
    return 3000;
  }

  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("PORT invalida. Use inteiro positivo.");
  }
  return parsed;
}

function separarOrigensCors(rawValue: string | undefined): string[] {
  const source = rawValue && rawValue.trim().length > 0 ? rawValue : "http://localhost:5173";

  return source
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const CORS_PADRAO = "http://localhost:5173";

export const env = {
  PORT: converterPorta(process.env.PORT),
  CORS_ORIGIN: textoOuPadrao("CORS_ORIGIN", CORS_PADRAO),

  // Compatibilidade com arquivos antigos do projeto.
  DATABASE_URL: textoOuPadrao("DATABASE_URL", "file:./dev.db"),
  JWT_SECRET: textoOuPadrao("JWT_SECRET", "rede-social-fake-segredo-min-16")
};

export const corsOrigins = separarOrigensCors(env.CORS_ORIGIN);

const corsOriginSet = new Set(corsOrigins);
const corsHostSet = new Set<string>();

for (const origin of corsOrigins) {
  try {
    corsHostSet.add(new URL(origin).hostname);
  } catch {
    // Ignora origem malformada.
  }
}

function hostPrivado(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  if (hostname.startsWith("192.168.") || hostname.startsWith("10.")) {
    return true;
  }

  if (!hostname.startsWith("172.")) {
    return false;
  }

  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const segundoOcteto = Number(parts[1]);
  return Number.isInteger(segundoOcteto) && segundoOcteto >= 16 && segundoOcteto <= 31;
}

export function origemPermitida(origin?: string): boolean {
  if (!origin) {
    return true;
  }

  if (corsOriginSet.has(origin)) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (corsHostSet.has(parsed.hostname)) {
    return true;
  }

  return hostPrivado(parsed.hostname);
}
