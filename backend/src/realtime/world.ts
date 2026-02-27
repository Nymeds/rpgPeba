import { MAP_SIZE, PlayerType, limitarAoMapa, type PublicAttack, type PublicPlayer } from "../game.js";
import type { Direction } from "./types.js";

const ATTACK_DAMAGE = 20;
const ATTACK_DURATION_MS = 1200;
const ATTACK_DEFAULT_RANGE = 2;
const ATTACK_SIZE_TILES = 1;

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
  facing: Direction;
  x: number;
  y: number;
  range: number;
  expiresAt: number;
};

export type AttackHitResult = {
  attackId: number;
  ownerCharacterId: number;
  targetCharacterId: number;
  targetName: string;
  hpAfter: number;
};

type ActiveAttackState = {
  id: number;
  ownerCharacterId: number;
  ownerName: string;
  x: number;
  y: number;
  size: number;
  expiresAt: number;
  hitCharacterIds: Set<number>;
};

type RegisterOnlinePlayerInput = Omit<OnlinePlayerState, "inputX" | "inputY" | "facing" | "dirtyState">;

const onlinePlayersBySocket = new Map<string, OnlinePlayerState>();
const socketByCharacterId = new Map<number, string>();
const activeAttacksById = new Map<number, ActiveAttackState>();
let nextAttackId = 1;

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

function cleanupExpiredAttacks(nowMs: number): void {
  for (const [attackId, attack] of activeAttacksById.entries()) {
    if (attack.expiresAt <= nowMs) {
      activeAttacksById.delete(attackId);
    }
  }
}

export function registerOnlinePlayer(input: RegisterOnlinePlayerInput): string | null {
  const previousSocketId = socketByCharacterId.get(input.characterId) ?? null;

  if (previousSocketId && previousSocketId !== input.socketId) {
    onlinePlayersBySocket.delete(previousSocketId);
  }

  onlinePlayersBySocket.set(input.socketId, {
    ...input,
    inputX: 0,
    inputY: 0,
    facing: "down",
    dirtyState: false
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

  player.inputX = clampInput(input.x);
  player.inputY = clampInput(input.y);
  player.facing = directionFromInput(player.inputX, player.inputY, player.facing);
  return true;
}

export function createPlayerAttack(socketId: string, rangeInput = ATTACK_DEFAULT_RANGE, nowMs = Date.now()): AttackCreationResult | null {
  const player = onlinePlayersBySocket.get(socketId);
  if (!player) {
    return null;
  }

  const range = Math.max(1, Math.min(6, Math.round(rangeInput)));
  const baseX = Math.round(player.x);
  const baseY = Math.round(player.y);

  let targetX = baseX;
  let targetY = baseY;

  if (player.facing === "up") {
    targetY -= range;
  } else if (player.facing === "down") {
    targetY += range;
  } else if (player.facing === "left") {
    targetX -= range;
  } else {
    targetX += range;
  }

  const attackX = Math.round(limitarAoMapa(targetX));
  const attackY = Math.round(limitarAoMapa(targetY));
  const attackId = nextAttackId++;
  const expiresAt = nowMs + ATTACK_DURATION_MS;

  activeAttacksById.set(attackId, {
    id: attackId,
    ownerCharacterId: player.characterId,
    ownerName: player.name,
    x: attackX,
    y: attackY,
    size: ATTACK_SIZE_TILES,
    expiresAt,
    hitCharacterIds: new Set<number>()
  });

  return {
    attackId,
    ownerCharacterId: player.characterId,
    ownerName: player.name,
    facing: player.facing,
    x: attackX,
    y: attackY,
    range,
    expiresAt
  };
}

export function applyMovement(deltaSeconds: number, velocityTilesPerSecond: number): MovementComputation[] {
  const computations: MovementComputation[] = [];

  for (const player of onlinePlayersBySocket.values()) {
    if (player.inputX === 0 && player.inputY === 0) {
      continue;
    }

    const normalized = normalizedMovementVector(player.inputX, player.inputY);
    const travel = velocityTilesPerSecond * deltaSeconds;

    const fromX = player.x;
    const fromY = player.y;
    const toX = limitarAoMapa(fromX + normalized.x * travel);
    const toY = limitarAoMapa(fromY + normalized.y * travel);

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

export function applyAttackDamage(nowMs = Date.now()): AttackHitResult[] {
  cleanupExpiredAttacks(nowMs);
  const hits: AttackHitResult[] = [];

  for (const attack of activeAttacksById.values()) {
    for (const player of onlinePlayersBySocket.values()) {
      if (player.characterId === attack.ownerCharacterId) {
        continue;
      }

      if (attack.hitCharacterIds.has(player.characterId)) {
        continue;
      }

      const playerTileX = Math.round(player.x);
      const playerTileY = Math.round(player.y);
      const insideAttackX = playerTileX >= attack.x && playerTileX < attack.x + attack.size;
      const insideAttackY = playerTileY >= attack.y && playerTileY < attack.y + attack.size;
      const insideAttack = insideAttackX && insideAttackY;

      if (!insideAttack) {
        continue;
      }

      attack.hitCharacterIds.add(player.characterId);
      player.hp = Math.max(0, player.hp - ATTACK_DAMAGE);
      player.dirtyState = true;

      hits.push({
        attackId: attack.id,
        ownerCharacterId: attack.ownerCharacterId,
        targetCharacterId: player.characterId,
        targetName: player.name,
        hpAfter: player.hp
      });
    }
  }

  return hits;
}

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

export function buildPublicAttacksSnapshot(nowMs = Date.now()): PublicAttack[] {
  cleanupExpiredAttacks(nowMs);
  return [...activeAttacksById.values()]
    .map((attack) => ({
      id: attack.id,
      ownerId: attack.ownerCharacterId,
      x: attack.x,
      y: attack.y,
      size: attack.size,
      expiresAt: attack.expiresAt
    }))
    .sort((a, b) => a.id - b.id);
}
