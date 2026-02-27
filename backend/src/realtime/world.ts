import { limitarAoMapa, type PublicPlayer } from "../game.js";
import type { Direction } from "./types.js";

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
  direction: Direction | null;
  dirtyPosition: boolean;
};

export type MovementComputation = {
  socketId: string;
  characterId: number;
  playerName: string;
  direction: Direction;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  rawX: number;
  rawY: number;
  velocity: number;
  deltaSeconds: number;
};

type RegisterOnlinePlayerInput = Omit<OnlinePlayerState, "direction" | "dirtyPosition">;

const onlinePlayersBySocket = new Map<string, OnlinePlayerState>();
const socketByCharacterId = new Map<number, string>();

function vectorByDirection(direction: Direction): { dx: number; dy: number } {
  if (direction === "up") {
    return { dx: 0, dy: -1 };
  }

  if (direction === "down") {
    return { dx: 0, dy: 1 };
  }

  if (direction === "left") {
    return { dx: -1, dy: 0 };
  }

  return { dx: 1, dy: 0 };
}

export function registerOnlinePlayer(input: RegisterOnlinePlayerInput): string | null {
  const previousSocketId = socketByCharacterId.get(input.characterId) ?? null;

  if (previousSocketId && previousSocketId !== input.socketId) {
    onlinePlayersBySocket.delete(previousSocketId);
  }

  onlinePlayersBySocket.set(input.socketId, {
    ...input,
    direction: null,
    dirtyPosition: false
  });
  socketByCharacterId.set(input.characterId, input.socketId);

  return previousSocketId;
}

export function getSocketIdByCharacterId(characterId: number): string | null {
  return socketByCharacterId.get(characterId) ?? null;
}

export function getOnlinePlayer(socketId: string): OnlinePlayerState | null {
  return onlinePlayersBySocket.get(socketId) ?? null;
}

export function setPlayerInput(socketId: string, direction: Direction | null): boolean {
  const player = onlinePlayersBySocket.get(socketId);
  if (!player) {
    return false;
  }

  player.direction = direction;
  return true;
}

export function applyMovement(deltaSeconds: number, velocityTilesPerSecond: number): MovementComputation[] {
  const computations: MovementComputation[] = [];

  for (const player of onlinePlayersBySocket.values()) {
    if (!player.direction) {
      continue;
    }

    const { dx, dy } = vectorByDirection(player.direction);
    const travel = velocityTilesPerSecond * deltaSeconds;

    const fromX = player.x;
    const fromY = player.y;
    const rawX = fromX + dx * travel;
    const rawY = fromY + dy * travel;
    const toX = limitarAoMapa(rawX);
    const toY = limitarAoMapa(rawY);

    if (Math.abs(toX - fromX) < 0.0001 && Math.abs(toY - fromY) < 0.0001) {
      continue;
    }

    player.x = toX;
    player.y = toY;

    if (Math.round(fromX) !== Math.round(toX) || Math.round(fromY) !== Math.round(toY)) {
      player.dirtyPosition = true;
    }

    computations.push({
      socketId: player.socketId,
      characterId: player.characterId,
      playerName: player.name,
      direction: player.direction,
      fromX,
      fromY,
      toX,
      toY,
      rawX,
      rawY,
      velocity: velocityTilesPerSecond,
      deltaSeconds
    });
  }

  return computations;
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

  return player;
}

export function collectDirtyPositions(): Array<{ characterId: number; x: number; y: number }> {
  const dirty: Array<{ characterId: number; x: number; y: number }> = [];

  for (const player of onlinePlayersBySocket.values()) {
    if (!player.dirtyPosition) {
      continue;
    }

    player.dirtyPosition = false;
    dirty.push({
      characterId: player.characterId,
      x: Math.round(player.x),
      y: Math.round(player.y)
    });
  }

  return dirty;
}

export function markPositionsAsDirty(characterIds: number[]): void {
  if (characterIds.length === 0) {
    return;
  }

  const lookup = new Set(characterIds);
  for (const player of onlinePlayersBySocket.values()) {
    if (lookup.has(player.characterId)) {
      player.dirtyPosition = true;
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
      online: true
    }))
    .sort((a, b) => a.id - b.id);
}
