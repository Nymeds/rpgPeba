// Tecnico: Tamanho do mapa quadrado (80 x 80).
// Crianca: O chao do jogo tem 80 bloquinhos para cada lado.
export const MAP_SIZE = 80;

// Tecnico: Quantidade fixa de slots do inventario.
// Crianca: A mochila tem 6 espacinhos.
export const INVENTORY_SLOTS = 6;

// Tecnico: Posicao padrao onde personagens nascem ou reaparecem.
// Crianca: Ponto de comeco do jogador.
export const SPAWN_POSITION = { x: 40, y: 40 };

export enum PlayerType {
  WARRIOR = "WARRIOR",
  MAGE = "MAGE",
  ARCHER = "ARCHER"
}

// Tecnico: Modelo enxuto enviado para o cliente renderizar cada jogador.
// Crianca: Ficha simples de cada jogador para desenhar no mapa.
export type PublicPlayer = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: Array<string | null>;
  online: boolean;
  playerType: PlayerType;
};

export type PublicAttack = {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  size: number;
  expiresAt: number;
};

// Tecnico: Tipo interno esperado para transformar um Character do banco em PublicPlayer.
// Crianca: Formato da informacao crua antes de virar ficha de jogador.
type PersonagemParaVisaoPublica = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: string;
};

function inventarioVazio(): Array<string | null> {
  // Tecnico: Cria array fixo com todos os slots vazios.
  // Crianca: Monta uma mochila com 6 espacos em branco.
  return Array.from({ length: INVENTORY_SLOTS }, () => null);
}

export function normalizarInventario(rawInventory: string): Array<string | null> {
  // Tecnico: Parsed com tipo unknown para validacao posterior segura.
  // Crianca: Primeiro a gente abre a caixa sem confiar no que tem dentro.
  let parsed: unknown = null;

  try {
    // Tecnico: Converte string JSON do banco para estrutura JS.
    // Crianca: Traduz o texto da mochila para uma lista de verdade.
    parsed = JSON.parse(rawInventory);
  } catch {
    // Tecnico: Se JSON invalido, devolve inventario vazio para evitar crash.
    // Crianca: Se veio baguncado, limpa a mochila e segue o jogo.
    return inventarioVazio();
  }

  // Tecnico: Garante que o valor final seja array.
  // Crianca: Confere se realmente e uma fila de itens.
  if (!Array.isArray(parsed)) {
    return inventarioVazio();
  }

  // Tecnico: Limita tamanho maximo, converte itens invalidos para null.
  // Crianca: So guarda 6 itens e troca coisa estranha por vazio.
  const normalized = parsed
    .slice(0, INVENTORY_SLOTS)
    .map((slot) => (typeof slot === "string" ? slot : null));

  // Tecnico: Preenche slots faltantes ate completar tamanho fixo.
  // Crianca: Se faltar espacinho, completa com vazio.
  while (normalized.length < INVENTORY_SLOTS) {
    normalized.push(null);
  }

  // Tecnico: Retorna sempre array previsivel com 6 posicoes.
  // Crianca: Entrega mochila certinha para o front.
  return normalized;
}

export function serializarInventario(inventory: Array<string | null>): string {
  // Tecnico: Salva inventario no banco como JSON string.
  // Crianca: Transforma a mochila em texto para guardar.
  return JSON.stringify(inventory);
}

export function paraJogadorPublico(character: PersonagemParaVisaoPublica, onlineIds: Set<number>): PublicPlayer {
  // Tecnico: Mapeia o modelo do banco para payload publico da rede.
  // Crianca: Converte a ficha grande em uma ficha simples para os jogadores verem.
  return {
    id: character.id,
    name: character.name,
    x: character.x,
    y: character.y,
    hp: character.hp,
    maxHp: character.maxHp,
    inventory: normalizarInventario(character.inventory),
    online: onlineIds.has(character.id),
    playerType: PlayerType.WARRIOR
  };
}

export function limitarAoMapa(value: number): number {
  // Tecnico: Garante coordenada dentro do limite [0, MAP_SIZE - 1].
  // Crianca: Impede o jogador de sair para fora do tabuleiro.
  return Math.min(MAP_SIZE - 1, Math.max(0, value));
}
