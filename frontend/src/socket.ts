// Tecnico: Cliente Socket.IO para navegador.
// Crianca: Ferramenta de conversa em tempo real com o backend.
import { io, type Socket } from "socket.io-client";

// Tecnico: URL de websocket definida no ambiente.
// Crianca: Endereco da sala de conversa do jogo.
import { WS_URL } from "./api";

// Tecnico: Tipagem dos eventos bidirecionais.
// Crianca: Lista do que o cliente manda e recebe.
import type { ClientToServerEvents, ServerToClientEvents } from "./types";

export function criarSocketJogo(token: string): Socket<ServerToClientEvents, ClientToServerEvents> {
  // Tecnico: Conecta forçando transporte websocket para reduzir fallback/polling.
  // Crianca: Abre um canal direto e rapido com o servidor.
  return io(WS_URL, {
    transports: ["websocket"],
    auth: {
      // Tecnico: Envia JWT no handshake para autenticacao.
      // Crianca: Mostra o cracha logo na entrada.
      token
    }
  });
}
