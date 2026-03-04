import {
  MAP_SIZE,
  PlayerType,
  SPAWN_POSITION,
  limitarAoMapa,
  type AttackKind,
  type PublicAttack,
  type PublicPlayer
} from "../game.js";
import type { Direction } from "./types.js";
import { tileSolido } from "./mapEditor.js";
import { damageEnemy, buildPublicEnemiesSnapshot } from "./enemies.js";
import type { PublicEnemy } from "./enemies.js";

const ATTACK_DAMAGE = 20;
const MONK_HEAL_AMOUNT = 16;
const ATTACK_DEFAULT_RANGE = 1;
const ATTACK_RADIUS_TILES = 0.65;
// Duracoes alinhadas com os GIFs:
// Warrior: 4 frames x 100ms = 400ms.
// Monk: 11 frames x 100ms = 1100ms.
const WARRIOR_ATTACK_AREA_DURATION_MS = 400;
const MONK_HEAL_EFFECT_DURATION_MS = 1100;
const WARRIOR_ATTACK_COOLDOWN_MS = 400;
const MONK_HEAL_COOLDOWN_MS = 1100;
const RESPAWN_DELAY_MS = 3000;
const RESPAWN_PROTECTION_MS = 2000;

export type InputVector = {
  x: number;
  y: number;
};

export type OnlinePlayerState = {
  socketId: string;
  accountId: number;
  characterId: number;
  username: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  inventory: Array<string | null>;
  playerType: PlayerType;
  inputX: number;
  inputY: number;
  facing: Direction;
  deadUntilMs: number | null;
  spawnedAtMs: number;
  lastAttackAtMs: number;
  dirtyState: boolean;
};

export type MovementComputation = {
  socketId: string;
  characterId: number;
  playerName: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  deltaSeconds: number;
  vectorX: number;
  vectorY: number;
};

export type AttackCreationResult = {
  attackId: number;
  ownerCharacterId: number;
  ownerName: string;
  kind: AttackKind;
  directionX: number;
  directionY: number;
  x: number;
  y: number;
  range: number;
  radius: number;
  expiresAt: number;
};

export type AttackHitResult = {
  attackId: number;
  ownerCharacterId: number;
  ownerName: string;
  effect: AttackKind;
  targetCharacterId: number;
  targetName: string;
  amount: number;
  hpAfter: number;
  targetDied: boolean;
};

export type RespawnResult = {
  characterId: number;
  playerName: string;
  x: number;
  y: number;
};

export type EnemyAwarePlayer = {
  characterId: number;
  name: string;
  x: number;
  y: number;
  isSpawnProtected: boolean;
};

export type AttackCreateOutcome =
  | { ok: true; attack: AttackCreationResult }
  | { ok: false; error: string };

type ActiveAttackState = {
  id: number;
  ownerCharacterId: number;
  ownerName: string;
  kind: AttackKind;
  x: number;
  y: number;
  radius: number;
  expiresAt: number;
  hitCharacterIds: Set<number>;
  hitEnemyIds: Set<number>;
};

type RegisterOnlinePlayerInput = Omit<
  OnlinePlayerState,
  "inputX" | "inputY" | "facing" | "deadUntilMs" | "spawnedAtMs" | "lastAttackAtMs" | "dirtyState"
>;

const onlinePlayersBySocket = new Map<string, OnlinePlayerState>();
const socketByCharacterId = new Map<number, string>();
const activeAttacksById = new Map<number, ActiveAttackState>();
let nextAttackId = 1;

// Rastreamento de ataques aos inimigos para fins de alvo da IA
const lastAttackToEnemyByPlayerId = new Map<number, Map<number, number>>();  // playerId -> { enemyId -> timestamp }

function vectorLength(x: number, y: number): number {
  return Math.hypot(x, y);
}

function normalizedMovementVector(x: number, y: number): { x: number; y: number } {
  const length = vectorLength(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }

  if (length <= 1) {
    return { x, y };
  }

  return {
    x: x / length,
    y: y / length
  };
}

function directionFromInput(x: number, y: number, fallback: Direction): Direction {
  if (Math.abs(x) >= Math.abs(y) && Math.abs(x) > 0.0001) {
    return x < 0 ? "left" : "right";
  }

  if (Math.abs(y) > 0.0001) {
    return y < 0 ? "up" : "down";
  }

  return fallback;
}

function clampInput(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value));
  if (Math.abs(clamped) < 0.0001) {
    return 0;
  }
  return clamped;
}

function normalizeVector(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }

  return {
    x: x / length,
    y: y / length,
    length
  };
}

function tileIndex(value: number): number {
  return Math.round(limitarAoMapa(value));
}

function posicaoSolida(x: number, y: number): boolean {
  return tileSolido(tileIndex(x), tileIndex(y));
}

function cleanupExpiredAttacks(nowMs: number): void {
  for (const [attackId, attack] of activeAttacksById.entries()) {
    if (attack.expiresAt <= nowMs) {
      activeAttacksById.delete(attackId);
    }
  }
}

function attackKindFromPlayerType(playerType: PlayerType): AttackKind {
  return playerType === PlayerType.MONK ? "heal" : "damage";
}

function attackDurationMs(kind: AttackKind): number {
  return kind === "heal" ? MONK_HEAL_EFFECT_DURATION_MS : WARRIOR_ATTACK_AREA_DURATION_MS;
}

function attackCooldownMs(kind: AttackKind): number {
  return kind === "heal" ? MONK_HEAL_COOLDOWN_MS : WARRIOR_ATTACK_COOLDOWN_MS;
}

export function registerOnlinePlayer(input: RegisterOnlinePlayerInput): string | null {
  const nowMs = Date.now();
  const previousSocketId = socketByCharacterId.get(input.characterId) ?? null;

  if (previousSocketId && previousSocketId !== input.socketId) {
    onlinePlayersBySocket.delete(previousSocketId);
  }

  const hp = input.hp <= 0 ? input.maxHp : input.hp;
  const x = input.hp <= 0 ? SPAWN_POSITION.x : input.x;
  const y = input.hp <= 0 ? SPAWN_POSITION.y : input.y;
  onlinePlayersBySocket.set(input.socketId, {
    ...input,
    hp,
    x,
    y,
    inputX: 0,
    inputY: 0,
    facing: "down",
    deadUntilMs: null,
    spawnedAtMs: nowMs,
    lastAttackAtMs: 0,
    dirtyState: input.hp <= 0
  });
  socketByCharacterId.set(input.characterId, input.socketId);

  return previousSocketId;
}

export function getSocketIdByCharacterId(characterId: number): string | null {
  return socketByCharacterId.get(characterId) ?? null;
}

export function setPlayerInput(socketId: string, input: InputVector): boolean {
  const player = onlinePlayersBySocket.get(socketId);
  if (!player) {
    return false;
  }

  if (player.deadUntilMs !== null || player.hp <= 0) {
    player.inputX = 0;
    player.inputY = 0;
    return true;
  }

  player.inputX = clampInput(input.x);
  player.inputY = clampInput(input.y);
  player.facing = directionFromInput(player.inputX, player.inputY, player.facing);
  return true;
}

export function createPlayerAttack(
  socketId: string,
  directionInput: { x: number; y: number },
  rangeInput = ATTACK_DEFAULT_RANGE,
  nowMs = Date.now()
): AttackCreateOutcome {
  const player = onlinePlayersBySocket.get(socketId);
  if (!player) {
    return { ok: false, error: "Jogador nao encontrado." };
  }

  if (player.deadUntilMs !== null || player.hp <= 0) {
    return { ok: false, error: "Voce esta morto e nao pode atacar." };
  }

  const kind = attackKindFromPlayerType(player.playerType);
  const remainingCooldownMs = player.lastAttackAtMs + attackCooldownMs(kind) - nowMs;
  if (remainingCooldownMs > 0) {
    return { ok: false, error: `Ataque em cooldown (${remainingCooldownMs}ms).` };
  }

  const normalizedDirection = normalizeVector(directionInput.x, directionInput.y);
  if (normalizedDirection.length < 0.0001) {
    return { ok: false, error: "Direcao de ataque invalida." };
  }

  player.facing = directionFromInput(normalizedDirection.x, normalizedDirection.y, player.facing);

  const range = Math.max(0.5, Math.min(3, rangeInput));
  const attackX = limitarAoMapa(player.x + normalizedDirection.x * range);
  const attackY = limitarAoMapa(player.y + normalizedDirection.y * range);
  const attackId = nextAttackId++;
  const expiresAt = nowMs + attackDurationMs(kind);
  player.lastAttackAtMs = nowMs;

  activeAttacksById.set(attackId, {
    id: attackId,
    ownerCharacterId: player.characterId,
    ownerName: player.name,
    kind,
    x: attackX,
    y: attackY,
    radius: ATTACK_RADIUS_TILES,
    expiresAt,
    hitCharacterIds: new Set<number>(),
    hitEnemyIds: new Set<number>()
  });

  return {
    ok: true,
    attack: {
      attackId,
      ownerCharacterId: player.characterId,
      ownerName: player.name,
      kind,
      directionX: normalizedDirection.x,
      directionY: normalizedDirection.y,
      x: attackX,
      y: attackY,
      range,
      radius: ATTACK_RADIUS_TILES,
      expiresAt
    }
  };
}
//aplica o movimento dos jogadores
export function applyMovement(deltaSeconds: number, velocityTilesPerSecond: number): MovementComputation[] {
  const computations: MovementComputation[] = [];

  for (const player of onlinePlayersBySocket.values()) {
    if (player.deadUntilMs !== null || player.hp <= 0) {
      continue;
    }

    if (player.inputX === 0 && player.inputY === 0) {
      continue;
    }

    const normalized = normalizedMovementVector(player.inputX, player.inputY);
    const travel = velocityTilesPerSecond * deltaSeconds;

    const fromX = player.x;
    const fromY = player.y;
    const targetX = limitarAoMapa(fromX + normalized.x * travel);
    const targetY = limitarAoMapa(fromY + normalized.y * travel);
    let toX = targetX;
    let toY = targetY;

    // Resolve colisao por tile com tentativa de "slide" nos eixos.
    //  Se bater em parede, tenta escorregar para o lado sem atravessar bloco solido.
    if (posicaoSolida(targetX, targetY)) {
      const canSlideX = !posicaoSolida(targetX, fromY);
      const canSlideY = !posicaoSolida(fromX, targetY);

      if (canSlideX) {
        toY = fromY;
      } else if (canSlideY) {
        toX = fromX;
      } else {
        continue;
      }
    }

    if (Math.abs(toX - fromX) < 0.0001 && Math.abs(toY - fromY) < 0.0001) {
      continue;
    }

    player.x = toX;
    player.y = toY;

    if (Math.round(fromX) !== Math.round(toX) || Math.round(fromY) !== Math.round(toY)) {
      player.dirtyState = true;
    }

    computations.push({
      socketId: player.socketId,
      characterId: player.characterId,
      playerName: player.name,
      fromX,
      fromY,
      toX,
      toY,
      deltaSeconds,
      vectorX: normalized.x,
      vectorY: normalized.y
    });
  }

  return computations;
}
//aplica os efeitos dos ataques ativos nos jogadores atingidos
export function applyAttackDamage(nowMs = Date.now()): AttackHitResult[] {
  cleanupExpiredAttacks(nowMs);
  const hits: AttackHitResult[] = [];
  const allEnemies = buildPublicEnemiesSnapshot();
  
  // Criar mapa para acesso rápido de inimigos por ID
  const enemiesById = new Map(allEnemies.map((e) => [e.id, e]));

  for (const attack of activeAttacksById.values()) {
    // Atacar players
    for (const player of onlinePlayersBySocket.values()) {
      if (player.characterId === attack.ownerCharacterId) {
        continue;
      }

      if (player.deadUntilMs !== null || player.hp <= 0) {
        continue;
      }

      if (attack.hitCharacterIds.has(player.characterId)) {
        continue;
      }

      const playerCenterX = player.x + 0.5;
      const playerCenterY = player.y + 0.5;
      const attackCenterX = attack.x + 0.5;
      const attackCenterY = attack.y + 0.5;
      const distance = Math.hypot(playerCenterX - attackCenterX, playerCenterY - attackCenterY);
      const insideAttack = distance <= attack.radius;

      if (!insideAttack) {
        continue;
      }

      if (attack.kind === "heal" && player.hp >= player.maxHp) {
        continue;
      }

      attack.hitCharacterIds.add(player.characterId);

      if (attack.kind === "heal") {
        const hpBefore = player.hp;
        player.hp = Math.min(player.maxHp, player.hp + MONK_HEAL_AMOUNT);
        const healedAmount = player.hp - hpBefore;
        if (healedAmount <= 0) {
          continue;
        }
        player.dirtyState = true;

        hits.push({
          attackId: attack.id,
          ownerCharacterId: attack.ownerCharacterId,
          ownerName: attack.ownerName,
          effect: "heal",
          targetCharacterId: player.characterId,
          targetName: player.name,
          amount: healedAmount,
          hpAfter: player.hp,
          targetDied: false
        });
        continue;
      }

      player.hp = Math.max(0, player.hp - ATTACK_DAMAGE);
      const targetDied = player.hp === 0;
      if (targetDied) {
        player.deadUntilMs = nowMs + RESPAWN_DELAY_MS;
        player.inputX = 0;
        player.inputY = 0;
      }
      player.dirtyState = true;

      hits.push({
        attackId: attack.id,
        ownerCharacterId: attack.ownerCharacterId,
        ownerName: attack.ownerName,
        effect: "damage",
        targetCharacterId: player.characterId,
        targetName: player.name,
        amount: ATTACK_DAMAGE,
        hpAfter: player.hp,
        targetDied
      });
    }

    // Atacar inimigos
    for (const enemy of allEnemies) {
      if (attack.hitEnemyIds.has(enemy.id) || !enemiesById.has(enemy.id)) {
        continue;
      }

      const enemyCenterX = enemy.x + 0.5;
      const enemyCenterY = enemy.y + 0.5;
      const attackCenterX = attack.x + 0.5;
      const attackCenterY = attack.y + 0.5;
      const distance = Math.hypot(enemyCenterX - attackCenterX, enemyCenterY - attackCenterY);
      const insideAttack = distance <= attack.radius;

      if (!insideAttack) {
        continue;
      }

      attack.hitEnemyIds.add(enemy.id);

      // Registrar quem atacou este inimigo
      if (!lastAttackToEnemyByPlayerId.has(attack.ownerCharacterId)) {
        lastAttackToEnemyByPlayerId.set(attack.ownerCharacterId, new Map());
      }
      lastAttackToEnemyByPlayerId.get(attack.ownerCharacterId)!.set(enemy.id, nowMs);

      // Aplicar dano ao inimigo
      damageEnemy(enemy.id, ATTACK_DAMAGE, {
        characterId: attack.ownerCharacterId,
        x: onlinePlayersBySocket.get(getSocketIdByCharacterId(attack.ownerCharacterId) ?? "")?.x ?? 0,
        y: onlinePlayersBySocket.get(getSocketIdByCharacterId(attack.ownerCharacterId) ?? "")?.y ?? 0
      });
    }
  }

  return hits;
}
//aplica os respawns dos jogadores mortos que ja passaram do tempo de respawn
export function applyRespawns(nowMs = Date.now()): RespawnResult[] {
  const respawns: RespawnResult[] = [];

  for (const player of onlinePlayersBySocket.values()) {
    if (player.deadUntilMs === null) {
      continue;
    }

    if (player.deadUntilMs > nowMs) {
      continue;
    }

    player.deadUntilMs = null;
    player.spawnedAtMs = nowMs;
    player.hp = player.maxHp;
    player.x = SPAWN_POSITION.x;
    player.y = SPAWN_POSITION.y;
    player.inputX = 0;
    player.inputY = 0;
    player.dirtyState = true;

    respawns.push({
      characterId: player.characterId,
      playerName: player.name,
      x: player.x,
      y: player.y
    });
  }

  return respawns;
}
//remove o jogador do mundo
export function removeOnlinePlayer(socketId: string): OnlinePlayerState | null {
  const player = onlinePlayersBySocket.get(socketId);
  if (!player) {
    return null;
  }

  onlinePlayersBySocket.delete(socketId);

  const currentSocketId = socketByCharacterId.get(player.characterId);
  if (currentSocketId === socketId) {
    socketByCharacterId.delete(player.characterId);
  }

  for (const [attackId, attack] of activeAttacksById.entries()) {
    if (attack.ownerCharacterId === player.characterId) {
      activeAttacksById.delete(attackId);
    }
  }

  return player;
}
//coleta os estados sujos dos jogadores para enviar ao cliente e marca como limpo
export function collectDirtyStates(): Array<{ characterId: number; x: number; y: number; hp: number }> {
  const dirty: Array<{ characterId: number; x: number; y: number; hp: number }> = [];

  for (const player of onlinePlayersBySocket.values()) {
    if (!player.dirtyState) {
      continue;
    }

    player.dirtyState = false;
    dirty.push({
      characterId: player.characterId,
      x: Math.round(player.x),
      y: Math.round(player.y),
      hp: player.hp
    });
  }

  return dirty;
}
//marca os jogadores como sujos para que suas informações sejam atualizadas no cliente
export function markPlayersAsDirty(characterIds: number[]): void {
  if (characterIds.length === 0) {
    return;
  }

  const lookup = new Set(characterIds);
  for (const player of onlinePlayersBySocket.values()) {
    if (lookup.has(player.characterId)) {
      player.dirtyState = true;
    }
  }
}

export function listOnlineCharacterIds(): Set<number> {
  return new Set([...onlinePlayersBySocket.values()].map((player) => player.characterId));
}
//estado do mundo atual
export function buildPublicPlayersSnapshot(): PublicPlayer[] {
  return [...onlinePlayersBySocket.values()]
    .map((player) => ({
      id: player.characterId,
      name: player.name,
      x: player.x,
      y: player.y,
      hp: player.hp,
      maxHp: player.maxHp,
      inventory: [...player.inventory],
      online: true,
      playerType: player.playerType
    }))
    .sort((a, b) => a.id - b.id);
}

// Função para aplicar dano a um player (chamada por inimigos)
export function buildEnemyAwarePlayersSnapshot(nowMs = Date.now()): EnemyAwarePlayer[] {
  return [...onlinePlayersBySocket.values()]
    .filter((player) => player.deadUntilMs === null && player.hp > 0)
    .map((player) => ({
      characterId: player.characterId,
      name: player.name,
      x: player.x,
      y: player.y,
      isSpawnProtected: nowMs - player.spawnedAtMs < RESPAWN_PROTECTION_MS
    }))
    .sort((a, b) => a.characterId - b.characterId);
}

export function damagePlayer(characterId: number, damage: number): { damageTaken: number; newHp: number; died: boolean } | null {
  const nowMs = Date.now();
  for (const player of onlinePlayersBySocket.values()) {
    if (player.characterId === characterId) {
      if (player.deadUntilMs !== null || player.hp <= 0) {
        return null; // Já está morto
      }
      const damageTaken = Math.min(damage, player.hp);
      player.hp = Math.max(0, player.hp - damage);
      const died = player.hp === 0;
      if (died) {
        player.deadUntilMs = Date.now() + RESPAWN_DELAY_MS;
        player.inputX = 0;
        player.inputY = 0;
      }
      player.dirtyState = true;
      return { damageTaken, newHp: player.hp, died };
    }
  }
  return null; // Player não encontrado
}

export function healPlayer(
  characterId: number,
  amount: number
): { healedAmount: number; newHp: number } | null {
  for (const player of onlinePlayersBySocket.values()) {
    if (player.characterId !== characterId) {
      continue;
    }

    if (player.deadUntilMs !== null || player.hp <= 0) {
      return null;
    }

    const hpBefore = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + Math.max(0, amount));
    const healedAmount = player.hp - hpBefore;
    if (healedAmount <= 0) {
      return null;
    }

    player.dirtyState = true;
    return {
      healedAmount,
      newHp: player.hp
    };
  }

  return null;
}

export function getLastAttackerOfEnemy(enemyId: number): number | null {
  let mostRecentAttacker: { playerId: number; timestamp: number } | null = null;

  for (const [playerId, enemyMap] of lastAttackToEnemyByPlayerId.entries()) {
    const timestamp = enemyMap.get(enemyId);
    if (timestamp !== undefined) {
      if (!mostRecentAttacker || timestamp > mostRecentAttacker.timestamp) {
        mostRecentAttacker = { playerId, timestamp };
      }
    }
  }

  return mostRecentAttacker?.playerId ?? null;
}

//estado dos ataques ativos no mundo
export function buildPublicAttacksSnapshot(nowMs = Date.now()): PublicAttack[] {
  cleanupExpiredAttacks(nowMs);
  return [...activeAttacksById.values()]
    .map((attack) => ({
      id: attack.id,
      ownerId: attack.ownerCharacterId,
      x: attack.x,
      y: attack.y,
      radius: attack.radius,
      kind: attack.kind,
      expiresAt: attack.expiresAt
    }))
    .sort((a, b) => a.id - b.id);
}

