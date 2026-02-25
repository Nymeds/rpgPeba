// Tecnico: Direcoes aceitas pelo comando de movimento.
// Crianca: Os quatro lados para onde o personagem pode andar.
export type Direction = "up" | "down" | "left" | "right";

// Tecnico: Estrutura de um jogador renderizado no cliente.
// Crianca: Ficha com tudo que precisamos para desenhar cada pessoa.
export type Player = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: Array<string | null>;
  online: boolean;
};

// Tecnico: Dados basicos da conta autenticada.
// Crianca: Informacoes simples de quem fez login.
export type AccountInfo = {
  id: number;
  username: string;
};

// Tecnico: Resposta padrao de login/cadastro/me.
// Crianca: Pacote que volta quando voce entra na conta.
export type AuthResponse = {
  token: string;
  account: AccountInfo;
  character: Player | null;
};

// Tecnico: Resposta da criacao de personagem.
// Crianca: Retorno quando o heroi e criado.
export type CharacterResponse = {
  character: Player;
};

// Tecnico: Snapshot do mundo enviado em HTTP ou socket.
// Crianca: Foto atual do mapa com os jogadores.
export type WorldUpdate = {
  mapSize: number;
  players: Player[];
};

// Tecnico: Evento de combate emitido em tempo real.
// Crianca: Recado de quem bateu em quem.
export type CombatEvent = {
  attackerId: number;
  targetId: number;
  damage: number;
  defeated: boolean;
};

// Tecnico: Formato do callback ack do Socket.IO.
// Crianca: Mensagem de resposta para dizer se a acao deu certo.
export type SocketAck = (response: { ok: boolean; error?: string }) => void;

// Tecnico: Eventos que chegam do servidor para o cliente.
// Crianca: Mensagens que o jogo recebe do backend.
export type ServerToClientEvents = {
  "world:ready": (payload: { mapSize: number; characterId: number }) => void;
  "world:update": (payload: WorldUpdate) => void;
  "combat:event": (payload: CombatEvent) => void;
};

// Tecnico: Eventos enviados do cliente para o servidor.
// Crianca: Mensagens que o jogador manda para o backend.
export type ClientToServerEvents = {
  "player:move": (payload: { direction: Direction }, ack?: SocketAck) => void;
  "player:attack": (payload?: { targetId?: number }, ack?: SocketAck) => void;
};
