//  Tamanho do mapa quadrado (80 x 80).
//  O chao do jogo tem 80 bloquinhos para cada lado.
export const MAP_SIZE = 80;

//  Quantidade fixa de slots do inventario.
//  A mochila tem 6 espacinhos.
export const INVENTORY_SLOTS = 6;

//  Posicao padrao onde personagens nascem ou reaparecem.
//  Ponto de comeco do jogador.
export const SPAWN_POSITION = { x: 40, y: 40 };

export enum PlayerType {
  WARRIOR = "WARRIOR",
  MONK = "MONK"
}

export function normalizarPlayerType(rawPlayerType: unknown): PlayerType {
  //  Garante fallback seguro para registros antigos/inconsistentes no banco.
  //  Se vier classe estranha, vira Warrior para nao quebrar o jogo.
  if (rawPlayerType === PlayerType.MONK) {
    return PlayerType.MONK;
  }
  return PlayerType.WARRIOR;
}

//  Modelo enxuto enviado para o cliente renderizar cada jogador.
//  Ficha simples de cada jogador para desenhar no mapa.
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

export type AttackKind = "damage" | "heal";

export type PublicAttack = {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  radius: number;
  kind: AttackKind;
  expiresAt: number;
};

//  Tipo interno esperado para transformar um Character do banco em PublicPlayer.
//  Formato da informacao crua antes de virar ficha de jogador.
type PersonagemParaVisaoPublica = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: string;
  playerType: PlayerType;
};

function inventarioVazio(): Array<string | null> {
  //  Cria array fixo com todos os slots vazios.
  //  Monta uma mochila com 6 espacos em branco.
  return Array.from({ length: INVENTORY_SLOTS }, () => null);
}

export function normalizarInventario(rawInventory: string): Array<string | null> {
  //  Parsed com tipo unknown para validacao posterior segura.
  //  Primeiro a gente abre a caixa sem confiar no que tem dentro.
  let parsed: unknown = null;

  try {
    //  Converte string JSON do banco para estrutura JS.
    //  Traduz o texto da mochila para uma lista de verdade.
    parsed = JSON.parse(rawInventory);
  } catch {
    //  Se JSON invalido, devolve inventario vazio para evitar crash.
    //  Se veio baguncado, limpa a mochila e segue o jogo.
    return inventarioVazio();
  }

  //  Garante que o valor final seja array.
  //  Confere se realmente e uma fila de itens.
  if (!Array.isArray(parsed)) {
    return inventarioVazio();
  }

  //  Limita tamanho maximo, converte itens invalidos para null.
  //  So guarda 6 itens e troca coisa estranha por vazio.
  const normalized = parsed
    .slice(0, INVENTORY_SLOTS)
    .map((slot) => (typeof slot === "string" ? slot : null));

  //  Preenche slots faltantes ate completar tamanho fixo.
  //  Se faltar espacinho, completa com vazio.
  while (normalized.length < INVENTORY_SLOTS) {
    normalized.push(null);
  }

  //  Retorna sempre array previsivel com 6 posicoes.
  //  Entrega mochila certinha para o front.
  return normalized;
}

export function serializarInventario(inventory: Array<string | null>): string {
  //  Salva inventario no banco como JSON string.
  //  Transforma a mochila em texto para guardar.
  return JSON.stringify(inventory);
}

export function paraJogadorPublico(character: PersonagemParaVisaoPublica, onlineIds: Set<number>): PublicPlayer {
  //  Mapeia o modelo do banco para payload publico da rede.
  //  Converte a ficha grande em uma ficha simples para os jogadores verem.
  return {
    id: character.id,
    name: character.name,
    x: character.x,
    y: character.y,
    hp: character.hp,
    maxHp: character.maxHp,
    inventory: normalizarInventario(character.inventory),
    online: onlineIds.has(character.id),
    playerType: character.playerType
  };
}

export function limitarAoMapa(value: number): number {
  //  Garante coordenada dentro do limite [0, MAP_SIZE - 1].
  //  Impede o jogador de sair para fora do tabuleiro.
  return Math.min(MAP_SIZE - 1, Math.max(0, value));
}
