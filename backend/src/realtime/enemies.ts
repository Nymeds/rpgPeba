import { MAP_SIZE, SPAWN_POSITION, limitarAoMapa } from "../game.js";
import { damagePlayer, buildPublicPlayersSnapshot } from "./world.js";
import type { Direction } from "./types.js";

const ENEMY_SPAWN_RADIUS = 10;  // Raio de movimento livre
const ENEMY_CHASE_RADIUS = 5;   // Raio para começar perseguição
const ENEMY_LOSE_TRACK_RADIUS = 6;  // Raio para parar perseguição
const ENEMY_ATTACK_DISTANCE = 0.5;    // Distância para atacar 
const ENEMY_RESPAWN_DELAY_MS = 5000;  // 5 segundos
const ENEMY_ATTACK_COOLDOWN_MS = 400;
const ENEMY_ATTACK_DAMAGE = 20;
const ENEMY_ATTACK_ANIMATION_MS = 400; // Tempo de animação do ataque

export type EnemyType = "WARRIOR" | "MONK";

export type EnemySpawnDefinition = {
  id: string;
  name: string;
  x: number;
  y: number;
  enemyType: EnemyType;
  spawnCount: number;
};

export type OnlineEnemyState = {
  id: number;
  spawnId: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  enemyType: EnemyType;
  facing: Direction;
  inputX: number;
  inputY: number;
  moving: boolean;
  spawnX: number;  // Locação original de spawn
  spawnY: number;
  targetPlayerId: number | null;  // Quem ele está perseguindo
  lastAttackAtMs: number;
  lastTargetChangeAtMs: number;
  deadUntilMs: number | null;
  dirtyState: boolean;
  isAttacking: boolean;  // Se está na animação de ataque
  attackStartedAtMs: number;  // Quando iniciou o ataque
};

export type PublicEnemy = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  enemyType: EnemyType;
  isAttacking: boolean;
};

const DATA_BY_SPAWN = new Map<string, OnlineEnemyState[]>();
let nextEnemyId = 10000;  // Começar IDs inimigos em 10000 para não conflitar com players

function generateRandomName(): string {
  const prefixes = ["Goblin", "Orc", "Troll", "Kobold", "Skeleton"];
  const suffixes = ["Slayer", "Bane", "Fang", "Claw", "Maw"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  const number = Math.floor(Math.random() * 999);
  return `${prefix}${suffix}${number}`;
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

export function registerEnemySpawns(spawns: EnemySpawnDefinition[]): void {
  DATA_BY_SPAWN.clear();
  nextEnemyId = 10000;
  
  for (const spawn of spawns) {
    DATA_BY_SPAWN.set(spawn.id, []);
    
    // Criar inimigos iniciais baseado em spawnCount
    for (let i = 0; i < spawn.spawnCount; i++) {
      const enemy: OnlineEnemyState = {
        id: nextEnemyId++,
        spawnId: spawn.id,
        name: generateRandomName(),
        x: spawn.x,
        y: spawn.y,
        hp: 50,
        maxHp: 50,
        enemyType: spawn.enemyType,
        facing: "down",
        inputX: 0,
        inputY: 0,
        moving: false,
        spawnX: spawn.x,
        spawnY: spawn.y,
        targetPlayerId: null,
        lastAttackAtMs: 0,
        lastTargetChangeAtMs: 0,
        deadUntilMs: null,
        dirtyState: true,
        isAttacking: false,
        attackStartedAtMs: 0
      };
      DATA_BY_SPAWN.get(spawn.id)!.push(enemy);
    }
  }
}

export function getEnemiesBySpawn(spawnId: string): OnlineEnemyState[] {
  return DATA_BY_SPAWN.get(spawnId) ?? [];
}

export function getAllEnemies(): OnlineEnemyState[] {
  const all: OnlineEnemyState[] = [];
  for (const enemies of DATA_BY_SPAWN.values()) {
    all.push(...enemies);
  }
  return all;
}

export function updateEnemyTargets(
  playerPositions: Array<{ characterId: number; x: number; y: number; spawnedAtTime: number }>,
  attackedByPlayerId: (enemyId: number) => number | null
): void {
  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs !== null && enemy.deadUntilMs > Date.now()) {
        continue;
      }

      const lastAttackerId = attackedByPlayerId(enemy.id);
      const now = Date.now();

      // Se foi atacado recentemente, muda o alvo
      if (lastAttackerId !== null) {
        enemy.targetPlayerId = lastAttackerId;
        enemy.lastTargetChangeAtMs = now;
      }

      // Se tem alvo, verifica distância
      if (enemy.targetPlayerId !== null) {
        const targetPlayer = playerPositions.find((p) => p.characterId === enemy.targetPlayerId);
        if (!targetPlayer) {
          enemy.targetPlayerId = null;
          continue;
        }

        const dist = Math.hypot(targetPlayer.x - enemy.x, targetPlayer.y - enemy.y);

        // Se perdeu o alvo (saiu do raio de perseguição)
        if (dist > ENEMY_LOSE_TRACK_RADIUS) {
          enemy.targetPlayerId = null;
        }
      }

      // Se não tem alvo, procura por players próximos
      if (enemy.targetPlayerId === null) {
        for (const player of playerPositions) {
          const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
          if (dist <= ENEMY_CHASE_RADIUS) {
            enemy.targetPlayerId = player.characterId;
            break;
          }
        }
      }
    }
  }
}

export function applyEnemyMovement(
  deltaSeconds: number,
  playerPositions: Array<{ characterId: number; x: number; y: number }>,
  tileSolido: (x: number, y: number) => boolean
): void {
  const moveSpeed = 2.5;  // Um pouco mais lento que players

  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      // Inimigos mortos ou atacando não se movem
      if ((enemy.deadUntilMs !== null && enemy.deadUntilMs > Date.now()) || enemy.isAttacking) {
        enemy.inputX = 0;
        enemy.inputY = 0;
        continue;
      }

      let targetX = 0;
      let targetY = 0;

      // Se tem alvo, move em direção ao alvo (mas para a 3 tiles)
      if (enemy.targetPlayerId !== null) {
        const targetPlayer = playerPositions.find((p) => p.characterId === enemy.targetPlayerId);
        if (targetPlayer) {
          const dx = targetPlayer.x - enemy.x;
          const dy = targetPlayer.y - enemy.y;
          const dist = Math.hypot(dx, dy);
          
          // Se está a 3 tiles ou menos, parar de se mover (vai atacar)
          if (dist <= ENEMY_ATTACK_DISTANCE) {
            targetX = 0;
            targetY = 0;
          } else {
            // Continuar perseguindo
            const normalized = normalizeVector(dx, dy);
            targetX = normalized.x;
            targetY = normalized.y;
          }
        }
      } else {
        // Sem alvo, vagueia aleatoriamente dentro do raio de spawn
        const dist = Math.hypot(enemy.x - enemy.spawnX, enemy.y - enemy.spawnY);

        if (dist > ENEMY_SPAWN_RADIUS - 1 || Math.random() < 0.02) {
          // Virou demais para fora ou tempo de virar aleatório
          const angleDelta = (Math.random() - 0.5) * Math.PI;
          const currentAngle = Math.atan2(enemy.inputY, enemy.inputX);
          const newAngle = currentAngle + angleDelta;
          targetX = Math.cos(newAngle);
          targetY = Math.sin(newAngle);
        } else {
          // Continua na direção atual
          targetX = enemy.inputX;
          targetY = enemy.inputY;
        }
      }

      enemy.inputX = Math.max(-1, Math.min(1, targetX));
      enemy.inputY = Math.max(-1, Math.min(1, targetY));

      // Aplicar movimento
      const newX = enemy.x + enemy.inputX * moveSpeed * deltaSeconds;
      const newY = enemy.y + enemy.inputY * moveSpeed * deltaSeconds;

      // Verificar colisão
      if (!tileSolido(Math.round(newX), Math.round(newY))) {
        enemy.x = limitarAoMapa(newX);
        enemy.y = limitarAoMapa(newY);
      }

      // Atualizar facing
      if (enemy.inputX < -0.0001) {
        enemy.facing = "left";
      } else if (enemy.inputX > 0.0001) {
        enemy.facing = "right";
      }

      const movedDistance = Math.hypot(enemy.inputX, enemy.inputY);
      const wasMoving = enemy.moving;
      enemy.moving = movedDistance > 0.01 && Math.hypot(newX - enemy.x, newY - enemy.y) > 0.01;

      if (enemy.moving !== wasMoving) {
        enemy.dirtyState = true;
      }
    }
  }
}

export function applyEnemyAttacks(
  nowMs = Date.now()
): Array<{ enemyId: number; enemyName: string; targetId: number; targetName: string; damage: number; targetHp: number; targetDied: boolean }> {
  const hits: Array<{ enemyId: number; enemyName: string; targetId: number; targetName: string; damage: number; targetHp: number; targetDied: boolean }> = [];
  
  // Carregar posições dos players para verificar distância
  const playerSnapshots = buildPublicPlayersSnapshot();
  const playerById = new Map(playerSnapshots.map((p) => [p.id, p]));

  for (const enemies of DATA_BY_SPAWN.values()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs !== null || enemy.hp <= 0) {
        continue;
      }

      // Se está na animação de ataque, aguardar terminar
      if (enemy.isAttacking) {
        const elapsedSinceAttack = nowMs - enemy.attackStartedAtMs;
        if (elapsedSinceAttack < ENEMY_ATTACK_ANIMATION_MS) {
          continue; // Ainda animando
        } else {
          // Animação terminou, pode atacar novamente
          enemy.isAttacking = false;
          enemy.lastAttackAtMs = nowMs;
        }
      }

      if (enemy.targetPlayerId === null) {
        continue;
      }

      // Verificar cooldown antes de iniciar novo ataque
      const cooldownMs = nowMs - enemy.lastAttackAtMs;
      if (cooldownMs < ENEMY_ATTACK_COOLDOWN_MS) {
        continue;  // Cooldown ainda ativo
      }

      // Buscar informações do alvo
      const targetPlayer = playerById.get(enemy.targetPlayerId);
      if (!targetPlayer) {
        enemy.targetPlayerId = null;
        continue;
      }

      const dist = Math.hypot(targetPlayer.x - enemy.x, targetPlayer.y - enemy.y);
      // Atacar apenas se está a 3 tiles ou menos
      if (dist > ENEMY_ATTACK_DISTANCE) {
        continue;
      }

      // Iniciar animação de ataque
      enemy.isAttacking = true;
      enemy.attackStartedAtMs = nowMs;
      
      // Aplicar dano ao player via função de world.ts
      const damageResult = damagePlayer(enemy.targetPlayerId, ENEMY_ATTACK_DAMAGE);
      
      if (damageResult !== null) {
        hits.push({
          enemyId: enemy.id,
          enemyName: enemy.name,
          targetId: enemy.targetPlayerId,
          targetName: targetPlayer.name,
          damage: damageResult.damageTaken,
          targetHp: damageResult.newHp,
          targetDied: damageResult.died
        });

        enemy.dirtyState = true;
      } else {
        enemy.targetPlayerId = null;
      }
    }
  }

  return hits;
}

export function applyEnemyRespawns(nowMs = Date.now()): Array<{ spawnId: string; enemyId: number; enemyName: string; x: number; y: number }> {
  const respawns: Array<{ spawnId: string; enemyId: number; enemyName: string; x: number; y: number }> = [];

  for (const [spawnId, enemies] of DATA_BY_SPAWN.entries()) {
    for (const enemy of enemies) {
      if (enemy.deadUntilMs === null) {
        continue;
      }

      if (enemy.deadUntilMs > nowMs) {
        continue;
      }

      enemy.deadUntilMs = null;
      enemy.hp = enemy.maxHp;
      enemy.x = enemy.spawnX;
      enemy.y = enemy.spawnY;
      enemy.inputX = 0;
      enemy.inputY = 0;
      enemy.targetPlayerId = null;
      enemy.dirtyState = true;

      respawns.push({
        spawnId,
        enemyId: enemy.id,
        enemyName: enemy.name,
        x: enemy.x,
        y: enemy.y
      });
    }
  }

  return respawns;
}

export function damageEnemy(
  enemyId: number,
  damageAmount: number,
  attacker: { characterId: number; x: number; y: number }
): boolean {
  for (const enemies of DATA_BY_SPAWN.values()) {
    const enemy = enemies.find((e) => e.id === enemyId);
    if (!enemy) {
      continue;
    }

    if (enemy.deadUntilMs !== null || enemy.hp <= 0) {
      return false;
    }

    // Player que atacou vira o novo alvo
    enemy.targetPlayerId = attacker.characterId;
    enemy.lastTargetChangeAtMs = Date.now();

    enemy.hp = Math.max(0, enemy.hp - damageAmount);
    const died = enemy.hp === 0;

    if (died) {
      enemy.deadUntilMs = Date.now() + ENEMY_RESPAWN_DELAY_MS;
    }

    enemy.dirtyState = true;
    return true;
  }

  return false;
}

export function buildPublicEnemiesSnapshot(): PublicEnemy[] {
  const enemies: PublicEnemy[] = [];
  for (const list of DATA_BY_SPAWN.values()) {
    for (const enemy of list) {
      if (enemy.deadUntilMs !== null && enemy.deadUntilMs <= Date.now()) {
        continue;  // Não mostrar inimigos mortos ainda
      }
      enemies.push({
        id: enemy.id,
        name: enemy.name,
        x: enemy.x,
        y: enemy.y,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        enemyType: enemy.enemyType,
        isAttacking: enemy.isAttacking
      });
    }
  }
  return enemies.sort((a, b) => a.id - b.id);
}
