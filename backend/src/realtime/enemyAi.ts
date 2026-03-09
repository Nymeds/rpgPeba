import { env } from "../env.js";
import { logError, logInfo, logWarn } from "../logger.js";
import type { AiDisposition, AiPersonaId, OnlineEnemyState } from "./enemies.js";

const AI_CHAT_RADIUS = 5;
export const AI_FOLLOW_DISTANCE = 1.35;
const AI_HOSTILITY_THRESHOLD = 70;
const AI_FRIENDLY_THRESHOLD = 35;
const AI_HOSTILE_CHASE_RADIUS = 8;
const AI_INTERACT_COOLDOWN_MS = 2500;
const AI_RESPONSE_PAUSE_BASE_MS = 1400;
const AI_RESPONSE_PAUSE_MAX_MS = 3600;
export const AI_CHAT_HOLD_RADIUS = 6;
export const AI_IDLE_MIN_MS = 900;
export const AI_IDLE_MAX_MS = 2800;
export const AI_WANDER_MIN_MS = 900;
export const AI_WANDER_MAX_MS = 2600;
export const AI_WANDER_IDLE_CHANCE = 0.88;
export const AI_FAKE_ATTACK_CHANCE_PER_TICK = 0.004;
export const AI_FAKE_ATTACK_COOLDOWN_MS = 3200;
const FALLEN_KNIGHT_FOLLOW_MIN_TRUST = 58;
const FALLEN_KNIGHT_FOLLOW_MIN_CHATS = 2;
const FALLEN_KNIGHT_FOLLOW_MIN_KILLS = 3;
const AI_INTER_COMMS_INTERVAL_MS = 45000;
const AI_MEMORY_LIMIT = 12;
const AI_CHAT_MAX_CHARS = 180;
const AI_GEMINI_TIMEOUT_MS = 8000;
const AI_GEMINI_RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
const AI_GEMINI_AUTH_BACKOFF_MS = 10 * 60 * 1000;
const AI_GEMINI_MIN_CALL_INTERVAL_MS = 7000;
const AI_GEMINI_MAX_OUTPUT_TOKENS = 96;
const AI_GEMINI_COMPLEX_MESSAGE_MIN_CHARS = 56;
const AI_GEMINI_CHAT_CALL_CHANCE = 0.35;
const AI_GEMINI_CONVERSATION_CALL_CHANCE = 0.22;
const AI_DECISION_CACHE_TTL_MS = 2 * 60 * 1000;
export const AI_SPAWN_ID = "__ai_companions__";
const GEMINI_MODEL_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

type PlayerRelationship = {
  trust: number;
  aggression: number;
  chats: number;
  attacksReceived: number;
  lastInteractionAtMs: number;
  notes: string[];
};

type MessageIntent = {
  greeting: boolean;
  askHelp: boolean;
  askJoin: boolean;
  apology: boolean;
  threat: boolean;
  praise: boolean;
  objectiveKill3: boolean;
};

type QueuedAiChatMessage = {
  dueAtMs: number;
  enemyId: number;
  text: string;
};

type CompanionDecision = {
  reply: string;
  mood: AiDisposition;
  followPlayer: boolean;
  attackPlayer: boolean;
  askAllyToSpeak: boolean;
  allyLine: string | null;
  memory: string | null;
};

type DecisionCacheEntry = {
  signature: string;
  cachedAtMs: number;
  decision: CompanionDecision;
};

type PlayerSnapshot = {
  id: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
};

export type PendingAiChatMessage = {
  enemyId: number;
  enemyName: string;
  text: string;
};
function escolherAleatorio<T>(lista: T[]): T {
  const index = Math.floor(Math.random() * lista.length);
  return lista[index];
}

export type EnemyAiDirectorDependencies = {
  getAllEnemies: () => OnlineEnemyState[];
  getPlayersSnapshot: () => PlayerSnapshot[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractJsonObject(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch && fencedMatch[1]) {
    const candidate = fencedMatch[1].trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      return candidate;
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return null;
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)] as T;
}

export class EnemyAiDirector {
  private readonly relationByEnemyId = new Map<number, Map<number, PlayerRelationship>>();
  private readonly aiChatQueue: QueuedAiChatMessage[] = [];
  private readonly enemyKillsByPlayerId = new Map<number, number>();
  private readonly aiChatInFlightByEnemyId = new Set<number>();
  private readonly decisionCacheByEnemyPlayer = new Map<string, DecisionCacheEntry>();
  private aiConversationInFlight = false;
  private nextAiConversationAtMs = 0;
  private warnedMissingIaKey = false;
  private geminiBlockedUntilMs = 0;
  private lastGeminiCallAtMs = 0;

  constructor(private readonly deps: EnemyAiDirectorDependencies) {
    this.reset(Date.now());
  }

  public reset(nowMs = Date.now()): void {
    this.relationByEnemyId.clear();
    this.aiChatQueue.length = 0;
    this.enemyKillsByPlayerId.clear();
    this.aiChatInFlightByEnemyId.clear();
    this.decisionCacheByEnemyPlayer.clear();
    this.aiConversationInFlight = false;
    this.nextAiConversationAtMs = nowMs + randomInt(7000, 12000);
    this.warnedMissingIaKey = false;
    this.geminiBlockedUntilMs = 0;
    this.lastGeminiCallAtMs = 0;
  }

  public onCompanionsInitialized(companions: OnlineEnemyState[]): void {
    logInfo("AI", "Companheiros IA iniciados", {
      npc1: `${companions[0]?.name ?? "?"}(${companions[0]?.id ?? -1})`,
      npc2: `${companions[1]?.name ?? "?"}(${companions[1]?.id ?? -1})`,
      x: companions[0]?.x ?? -1,
      y: companions[0]?.y ?? -1
    });
  }

  public registerPlayerKill(playerId: number): void {
    const currentKills = this.enemyKillsByPlayerId.get(playerId) ?? 0;
    this.enemyKillsByPlayerId.set(playerId, currentKills + 1);
  }

  public registerCompanionAttack(enemy: OnlineEnemyState, attackerId: number, nowMs: number): void {
    const attacker = this.deps.getPlayersSnapshot().find((player) => player.id === attackerId) ?? null;
    const attackerName = attacker?.name ?? `Player#${attackerId}`;
    const relation = this.ensureRelationship(enemy.id, attackerId);
    relation.attacksReceived += 1;
    relation.aggression = clamp(relation.aggression + 28, 0, 100);
    relation.trust = clamp(relation.trust - 12, -100, 100);
    relation.lastInteractionAtMs = nowMs;

    this.updateDispositionFromRelationship(enemy, relation, attackerId);
    this.remember(enemy, `${new Date(nowMs).toISOString()} sofreu ataque de ${attackerName}`);

    if (nowMs - enemy.lastAiInteractionAtMs > AI_INTERACT_COOLDOWN_MS) {
      enemy.lastAiInteractionAtMs = nowMs;
      const messages = ["Você escolheu errado","Você vai pagar","Bastardo!!!"]
      this.queueAiMessage(enemy.id, `${attackerName}, ${escolherAleatorio(messages)}`, randomInt(300, 700));
    }
  }

  public queueCompanionDeathMessage(enemy: OnlineEnemyState): void {
    const messages = ["Eu volto em breve... isto nao acabou. ","A morte não ira poupar voce!","Ao pó estou indo e dele voltarei"]
    this.queueAiMessage(enemy.id, `${escolherAleatorio(messages)}`, randomInt(250, 500));
  }

  public handlePlayerChatForAi(playerId: number, playerName: string, text: string): void {
    const normalizedText = text.trim();
    if (normalizedText.length === 0) {
      return;
    }

    const player = this.deps.getPlayersSnapshot().find((entry) => entry.id === playerId);
    if (!player) {
      return;
    }

    const nowMs = Date.now();
    const aliveCompanions = this.getAliveAiCompanions(nowMs);
    if (aliveCompanions.length === 0) {
      return;
    }

    const nearbyCompanions = aliveCompanions
      .map((enemy) => ({
        enemy,
        dist: Math.hypot(enemy.x - player.x, enemy.y - player.y)
      }))
      .filter((entry) => entry.dist <= AI_CHAT_RADIUS)
      .sort((a, b) => a.dist - b.dist);

    if (nearbyCompanions.length === 0) {
      return;
    }

    const lowered = normalizeSearchText(normalizedText);
    const directlyMentioned = nearbyCompanions
      .filter((entry) => lowered.includes(normalizeSearchText(entry.enemy.name)))
      .map((entry) => entry.enemy);

    const targets = directlyMentioned.length > 0 ? [directlyMentioned[0]] : [nearbyCompanions[0].enemy];
    for (const enemy of targets) {
      if (directlyMentioned.length === 0 && nowMs - enemy.lastAiInteractionAtMs < AI_INTERACT_COOLDOWN_MS) {
        continue;
      }

      this.applyConversationPause(enemy, nowMs, normalizedText.length);
      void this.reactCompanionToPlayerMessage(
        enemy,
        {
          id: player.id,
          name: playerName,
          x: player.x,
          y: player.y,
          hp: player.hp,
          maxHp: player.maxHp
        },
        normalizedText,
        nowMs
      );
    }
  }

  public tickAiCompanionDirector(nowMs = Date.now()): void {
    const companions = this.getAliveAiCompanions(nowMs);
    if (companions.length === 0) {
      return;
    }

    const onlinePlayers = this.deps.getPlayersSnapshot();
    const playersById = new Map(onlinePlayers.map((player) => [player.id, player]));
    if (onlinePlayers.length === 0) {
      this.nextAiConversationAtMs = nowMs + AI_INTER_COMMS_INTERVAL_MS;
      return;
    }

    for (const companion of companions) {
      if (companion.followPlayerId !== null && !playersById.has(companion.followPlayerId)) {
        companion.followPlayerId = null;
      }
      if (companion.targetPlayerId !== null && !playersById.has(companion.targetPlayerId)) {
        companion.targetPlayerId = null;
      }
    }

    if (nowMs < this.nextAiConversationAtMs || this.aiConversationInFlight) {
      return;
    }

    this.aiConversationInFlight = true;
    this.nextAiConversationAtMs = nowMs + AI_INTER_COMMS_INTERVAL_MS + randomInt(0, 8000);

    void this.runCompanionConversation(
      nowMs,
      onlinePlayers.map((player) => ({ id: player.id, x: player.x, y: player.y }))
    )
      .catch((error) => {
        logError("AI", "Falha em conversa entre companheiros", {
          error: error instanceof Error ? error.message : "erro desconhecido"
        });
      })
      .finally(() => {
        this.aiConversationInFlight = false;
      });
  }

  public consumePendingAiChatMessages(nowMs = Date.now()): PendingAiChatMessage[] {
    if (this.aiChatQueue.length === 0) {
      return [];
    }

    this.aiChatQueue.sort((a, b) => a.dueAtMs - b.dueAtMs);
    const ready: PendingAiChatMessage[] = [];

    while (this.aiChatQueue.length > 0 && this.aiChatQueue[0].dueAtMs <= nowMs) {
      const nextMessage = this.aiChatQueue.shift();
      if (!nextMessage) {
        break;
      }

      const enemy = this.getEnemyById(nextMessage.enemyId);
      if (!enemy) {
        continue;
      }

      if (enemy.deadUntilMs !== null && enemy.deadUntilMs > nowMs) {
        continue;
      }

      ready.push({
        enemyId: enemy.id,
        enemyName: enemy.name,
        text: nextMessage.text
      });
    }

    return ready;
  }

  public updateCompanionTargeting(
    enemy: OnlineEnemyState,
    playerPositions: Array<{ characterId: number; x: number; y: number }>,
    lastAttackerId: number | null,
    nowMs: number
  ): void {
    if (lastAttackerId !== null) {
      const relation = this.ensureRelationship(enemy.id, lastAttackerId);
      if (nowMs - relation.lastInteractionAtMs > 800) {
        relation.aggression = clamp(relation.aggression + 3, 0, 100);
        relation.lastInteractionAtMs = nowMs;
      }
    }

    this.updateAiTargeting(enemy, playerPositions);
  }

  private getEnemyById(enemyId: number): OnlineEnemyState | null {
    for (const enemy of this.deps.getAllEnemies()) {
      if (enemy.id === enemyId) {
        return enemy;
      }
    }
    return null;
  }

  private getAliveAiCompanions(nowMs = Date.now()): OnlineEnemyState[] {
    return this.deps
      .getAllEnemies()
      .filter((enemy) => enemy.isAiCompanion && (enemy.deadUntilMs === null || enemy.deadUntilMs <= nowMs) && enemy.hp > 0);
  }

  private ensureRelationship(enemyId: number, playerId: number): PlayerRelationship {
    let mapByPlayer = this.relationByEnemyId.get(enemyId);
    if (!mapByPlayer) {
      mapByPlayer = new Map<number, PlayerRelationship>();
      this.relationByEnemyId.set(enemyId, mapByPlayer);
    }

    let relation = mapByPlayer.get(playerId);
    if (!relation) {
      relation = {
        trust: 0,
        aggression: 0,
        chats: 0,
        attacksReceived: 0,
        lastInteractionAtMs: 0,
        notes: []
      };
      mapByPlayer.set(playerId, relation);
    }

    return relation;
  }

  private remember(enemy: OnlineEnemyState, note: string): void {
    const normalized = note.trim().replace(/\s+/g, " ").slice(0, 200);
    if (!normalized) {
      return;
    }

    enemy.recentMemory.push(normalized);
    if (enemy.recentMemory.length > AI_MEMORY_LIMIT) {
      enemy.recentMemory.splice(0, enemy.recentMemory.length - AI_MEMORY_LIMIT);
    }
  }

  private parseIntent(rawText: string): MessageIntent {
    const text = normalizeSearchText(rawText);
    return {
      greeting:
        text.includes("oi") ||
        text.includes("ola") ||
        text.includes("eae") ||
        text.includes("salve") ||
        text.includes("hello"),
      askHelp:
        text.includes("ajuda") ||
        text.includes("help") ||
        text.includes("preciso de voce") ||
        text.includes("me acompanha") ||
        text.includes("acompanha"),
      askJoin:
        text.includes("junta") ||
        text.includes("join") ||
        text.includes("grupo") ||
        text.includes("party") ||
        text.includes("me siga") ||
        text.includes("me segue") ||
        text.includes("siga comigo") ||
        text.includes("segue comigo"),
      apology: text.includes("desculpa") || text.includes("perdao") || text.includes("foi mal"),
      threat:
        text.includes("vou te matar") ||
        text.includes("vou atacar") ||
        text.includes("idiota") ||
        text.includes("odio") ||
        text.includes("te odeio"),
      praise:
        text.includes("obrigado") ||
        text.includes("valeu") ||
        text.includes("bom trabalho") ||
        text.includes("forte"),
      objectiveKill3:
        /\b3\b\s*(npc|npcs|inimigo|inimigos)/.test(text) ||
        /tres\s*(npc|npcs|inimigo|inimigos)/.test(text)
    };
  }

  private applyIntentToRelationship(
    enemy: OnlineEnemyState,
    relation: PlayerRelationship,
    intent: MessageIntent,
    nowMs: number
  ): void {
    relation.chats += 1;
    relation.lastInteractionAtMs = nowMs;
    const isFallenKnight = enemy.aiPersonaId === "FALLEN_KNIGHT";

    if (intent.greeting) {
      relation.trust += isFallenKnight ? 3 : 6;
    }
    if (intent.askHelp || intent.askJoin) {
      relation.trust += isFallenKnight ? 2 : 8;
    }
    if (intent.praise) {
      relation.trust += 4;
      relation.aggression -= 3;
    }
    if (intent.apology) {
      relation.aggression -= 10;
      relation.trust += 3;
    }
    if (intent.threat) {
      relation.aggression += 20;
      relation.trust -= 10;
    }

    relation.trust = clamp(relation.trust, -100, 100);
    relation.aggression = clamp(relation.aggression, 0, 100);
  }

  private friendlyThresholdForEnemy(enemy: OnlineEnemyState): number {
    if (enemy.aiPersonaId === "FALLEN_KNIGHT") {
      return FALLEN_KNIGHT_FOLLOW_MIN_TRUST;
    }
    return AI_FRIENDLY_THRESHOLD;
  }

  private canEnemyFollowPlayer(enemy: OnlineEnemyState, relation: PlayerRelationship, playerId: number): boolean {
    const killCount = this.enemyKillsByPlayerId.get(playerId) ?? 0;
    if (enemy.aiPersonaId === "FALLEN_KNIGHT") {
      return (
        killCount >= FALLEN_KNIGHT_FOLLOW_MIN_KILLS &&
        relation.trust >= FALLEN_KNIGHT_FOLLOW_MIN_TRUST &&
        relation.chats >= FALLEN_KNIGHT_FOLLOW_MIN_CHATS &&
        relation.attacksReceived === 0 &&
        relation.aggression < 45
      );
    }

    if (enemy.aiPersonaId === "LAST_MONK") {
      return relation.trust >= AI_FRIENDLY_THRESHOLD || (killCount >= 2 && relation.trust >= 24);
    }

    return relation.trust >= AI_FRIENDLY_THRESHOLD;
  }

  private fallenKnightPersuasionHint(playerName: string, relation: PlayerRelationship, killCount: number): string {
    const missing: string[] = [];
    if (killCount < FALLEN_KNIGHT_FOLLOW_MIN_KILLS) {
      missing.push(`derrotar ${FALLEN_KNIGHT_FOLLOW_MIN_KILLS} inimigos`);
    }
    if (relation.chats < FALLEN_KNIGHT_FOLLOW_MIN_CHATS) {
      missing.push("falar comigo com respeito");
    }
    if (relation.trust < FALLEN_KNIGHT_FOLLOW_MIN_TRUST) {
      missing.push("provar sua palavra");
    }

    if (missing.length === 0) {
      return `${playerName}, talvez eu considere sua proposta.`;
    }

    return `${playerName}, eu nao sigo ordens vazias. Primeiro: ${missing.join(", ")}.`;
  }

  private updateDispositionFromRelationship(
    enemy: OnlineEnemyState,
    relation: PlayerRelationship,
    playerId: number
  ): void {
    if (relation.aggression >= AI_HOSTILITY_THRESHOLD || relation.attacksReceived >= 3) {
      enemy.aiDisposition = "hostile";
      enemy.targetPlayerId = playerId;
      enemy.followPlayerId = null;
      return;
    }

    const friendlyThreshold = this.friendlyThresholdForEnemy(enemy);
    if (relation.trust >= friendlyThreshold && this.canEnemyFollowPlayer(enemy, relation, playerId)) {
      enemy.aiDisposition = "friendly";
      enemy.followPlayerId = playerId;
      enemy.targetPlayerId = null;
      return;
    }

    enemy.aiDisposition = "neutral";
    if (enemy.targetPlayerId === playerId && relation.aggression < 40) {
      enemy.targetPlayerId = null;
    }
  }

  private sanitizeAiChatText(text: string): string {
    const cleaned = text.trim().replace(/\s+/g, " ").replace(/[\r\n]+/g, " ");
    if (!cleaned) {
      return "...";
    }
    return cleaned.slice(0, AI_CHAT_MAX_CHARS);
  }

  private queueAiMessage(enemyId: number, text: string, delayMs = 900): void {
    this.aiChatQueue.push({
      enemyId,
      text: this.sanitizeAiChatText(text),
      dueAtMs: Date.now() + Math.max(0, delayMs)
    });
  }

  private applyConversationPause(enemy: OnlineEnemyState, nowMs: number, textLength = 0): void {
    const duration = clamp(
      AI_RESPONSE_PAUSE_BASE_MS + textLength * 12,
      AI_RESPONSE_PAUSE_BASE_MS,
      AI_RESPONSE_PAUSE_MAX_MS
    );
    enemy.pauseUntilMs = Math.max(enemy.pauseUntilMs, nowMs + duration);
    enemy.inputX = 0;
    enemy.inputY = 0;
    enemy.moving = false;
  }

  private relationBucket(value: number): number {
    return Math.round(value / 10) * 10;
  }

  private buildDecisionSignature(messageText: string, relation: PlayerRelationship, killCount: number): string {
    return [
      normalizeSearchText(messageText).slice(0, 96),
      `t${this.relationBucket(relation.trust)}`,
      `a${this.relationBucket(relation.aggression)}`,
      `k${killCount >= 3 ? "3p" : String(killCount)}`,
      `atk${Math.min(4, relation.attacksReceived)}`
    ].join("|");
  }

  private decisionCacheKey(enemyId: number, playerId: number): string {
    return `${enemyId}:${playerId}`;
  }

  private getCachedDecision(
    enemyId: number,
    playerId: number,
    signature: string,
    nowMs: number
  ): CompanionDecision | null {
    const key = this.decisionCacheKey(enemyId, playerId);
    const cached = this.decisionCacheByEnemyPlayer.get(key);
    if (!cached) {
      return null;
    }

    if (cached.signature !== signature) {
      return null;
    }

    if (nowMs - cached.cachedAtMs > AI_DECISION_CACHE_TTL_MS) {
      this.decisionCacheByEnemyPlayer.delete(key);
      return null;
    }

    return cached.decision;
  }

  private setCachedDecision(
    enemyId: number,
    playerId: number,
    signature: string,
    decision: CompanionDecision,
    nowMs: number
  ): void {
    const key = this.decisionCacheKey(enemyId, playerId);
    this.decisionCacheByEnemyPlayer.set(key, {
      signature,
      cachedAtMs: nowMs,
      decision
    });
  }

  private shouldUseGeminiForPlayerDecision(
    messageText: string,
    intent: MessageIntent,
    relation: PlayerRelationship,
    nowMs: number
  ): boolean {
    if (this.geminiBlockedUntilMs > nowMs) {
      return false;
    }

    if (nowMs - this.lastGeminiCallAtMs < AI_GEMINI_MIN_CALL_INTERVAL_MS) {
      return false;
    }

    const isSimpleIntent =
      intent.greeting ||
      intent.askHelp ||
      intent.askJoin ||
      intent.apology ||
      intent.threat ||
      intent.praise ||
      intent.objectiveKill3;

    if (isSimpleIntent && messageText.length < AI_GEMINI_COMPLEX_MESSAGE_MIN_CHARS) {
      return false;
    }

    if (relation.chats <= 1) {
      return false;
    }

    if (messageText.length >= AI_GEMINI_COMPLEX_MESSAGE_MIN_CHARS) {
      return true;
    }

    if (messageText.includes("?") && messageText.length >= 20) {
      return Math.random() < AI_GEMINI_CHAT_CALL_CHANCE;
    }

    return false;
  }

  private shouldUseGeminiForCompanionConversation(
    nowMs: number,
    players: Array<{ id: number; x: number; y: number }>,
    speaker: OnlineEnemyState,
    listener: OnlineEnemyState
  ): boolean {
    if (this.geminiBlockedUntilMs > nowMs) {
      return false;
    }

    if (nowMs - this.lastGeminiCallAtMs < AI_GEMINI_MIN_CALL_INTERVAL_MS) {
      return false;
    }

    const hasNearbyPlayer = players.some((player) => {
      const d1 = Math.hypot(player.x - speaker.x, player.y - speaker.y);
      const d2 = Math.hypot(player.x - listener.x, player.y - listener.y);
      return d1 <= 12 || d2 <= 12;
    });
    if (!hasNearbyPlayer) {
      return false;
    }

    return Math.random() < AI_GEMINI_CONVERSATION_CALL_CHANCE;
  }

  private getGeminiApiKey(): string | null {
    const key = env.IAKEY?.trim() ?? "";
    if (key.length > 0) {
      return key;
    }

    if (!this.warnedMissingIaKey) {
      this.warnedMissingIaKey = true;
      logWarn("AI", "IAKEY ausente; companheiros usando fallback local");
    }
    return null;
  }

  private async askGeminiJson(prompt: string): Promise<Record<string, unknown> | null> {
    const nowMs = Date.now();
    if (this.geminiBlockedUntilMs > nowMs) {
      return null;
    }

    if (nowMs - this.lastGeminiCallAtMs < AI_GEMINI_MIN_CALL_INTERVAL_MS) {
      return null;
    }

    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_GEMINI_TIMEOUT_MS);

    try {
      this.lastGeminiCallAtMs = Date.now();
      const response = await fetch(`${GEMINI_MODEL_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.6,
            maxOutputTokens: AI_GEMINI_MAX_OUTPUT_TOKENS
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        if (response.status === 429) {
          this.geminiBlockedUntilMs = Date.now() + AI_GEMINI_RATE_LIMIT_BACKOFF_MS;
          logWarn("AI", "Falha HTTP no Gemini (rate limit)", {
            status: response.status,
            retryInSec: Math.round((this.geminiBlockedUntilMs - Date.now()) / 1000),
            body: errorBody.slice(0, 160)
          });
          return null;
        }

        if (response.status === 401 || response.status === 403) {
          this.geminiBlockedUntilMs = Date.now() + AI_GEMINI_AUTH_BACKOFF_MS;
        }

        logWarn("AI", "Falha HTTP no Gemini", {
          status: response.status,
          body: errorBody.slice(0, 160)
        });
        return null;
      }

      const payload = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };

      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== "string" || text.trim().length === 0) {
        return null;
      }

      const jsonText = extractJsonObject(text);
      if (!jsonText) {
        return null;
      }

      const parsed = JSON.parse(jsonText) as unknown;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      logWarn("AI", "Erro ao consultar Gemini", {
        message: error instanceof Error ? error.message : "erro desconhecido"
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private personaDescription(personaId: AiPersonaId | null): string {
    if (personaId === "FALLEN_KNIGHT") {
      return "cavaleiro sombrio, direto e honrado";
    }
    if (personaId === "LAST_MONK") {
      return "monge calmo, estrategista e protetor";
    }
    return "companheiro";
  }

  private fallbackReply(
    enemy: OnlineEnemyState,
    playerName: string,
    relation: PlayerRelationship,
    intent: MessageIntent,
    killCount: number
  ): CompanionDecision {
    const angry = relation.aggression >= AI_HOSTILITY_THRESHOLD;
    const friendly = relation.trust >= AI_FRIENDLY_THRESHOLD;
    const canFollowFallenKnight =
      killCount >= FALLEN_KNIGHT_FOLLOW_MIN_KILLS &&
      relation.trust >= FALLEN_KNIGHT_FOLLOW_MIN_TRUST &&
      relation.chats >= FALLEN_KNIGHT_FOLLOW_MIN_CHATS &&
      relation.attacksReceived === 0 &&
      relation.aggression < 45;

    if (angry || intent.threat) {
      return {
        reply: `${playerName}, mantenha distancia. Mais um golpe e eu revido.`,
        mood: "hostile",
        followPlayer: false,
        attackPlayer: true,
        askAllyToSpeak: false,
        allyLine: null,
        memory: `Avaliou ${playerName} como ameaca.`
      };
    }

    if (enemy.aiPersonaId === "FALLEN_KNIGHT" && (intent.askHelp || intent.askJoin)) {
      if (!canFollowFallenKnight) {
        return {
          reply: this.fallenKnightPersuasionHint(playerName, relation, killCount),
          mood: "neutral",
          followPlayer: false,
          attackPlayer: false,
          askAllyToSpeak: false,
          allyLine: null,
          memory: `Recusou seguir ${playerName} por falta de persuasao.`
        };
      }
    }

    if ((intent.askHelp || intent.askJoin || intent.objectiveKill3) && killCount >= 3) {
      return {
        reply: `${playerName}, voce provou valor. Eu e meu aliado vamos com voce.`,
        mood: "friendly",
        followPlayer: true,
        attackPlayer: false,
        askAllyToSpeak: true,
        allyLine: `Entendido, ${playerName}. Seguiremos voce por enquanto.`,
        memory: `Aceitou seguir ${playerName} apos objetivo de combate.`
      };
    }

    if (friendly || intent.greeting || intent.praise) {
      return {
        reply:
          enemy.aiPersonaId === "LAST_MONK"
            ? `Ola ${playerName}. Estou bem. Se precisar, posso manter voce de pe.`
            : `Ola ${playerName}. Estou firme. Diga o proximo passo.`,
        mood: "friendly",
        followPlayer: intent.askHelp || intent.askJoin,
        attackPlayer: false,
        askAllyToSpeak: intent.askJoin,
        allyLine: "Vamos observar voce de perto.",
        memory: `Interacao amigavel com ${playerName}.`
      };
    }

    return {
      reply: `${playerName}, estamos atentos. Mostre suas intencoes.`,
      mood: "neutral",
      followPlayer: false,
      attackPlayer: false,
      askAllyToSpeak: false,
      allyLine: null,
      memory: `Manteve postura neutra com ${playerName}.`
    };
  }

  private parseDecision(raw: Record<string, unknown> | null, fallback: CompanionDecision): CompanionDecision {
    if (!raw) {
      return fallback;
    }

    const moodRaw = typeof raw.mood === "string" ? raw.mood.toLowerCase() : "";
    const mood: AiDisposition =
      moodRaw === "friendly" || moodRaw === "hostile" || moodRaw === "neutral"
        ? moodRaw
        : fallback.mood;

    const reply =
      typeof raw.reply === "string" && raw.reply.trim().length > 0
        ? this.sanitizeAiChatText(raw.reply)
        : fallback.reply;

    const allyLine =
      typeof raw.allyLine === "string" && raw.allyLine.trim().length > 0
        ? this.sanitizeAiChatText(raw.allyLine)
        : fallback.allyLine;

    const memory =
      typeof raw.memory === "string" && raw.memory.trim().length > 0
        ? this.sanitizeAiChatText(raw.memory)
        : fallback.memory;

    return {
      reply,
      mood,
      followPlayer: typeof raw.followPlayer === "boolean" ? raw.followPlayer : fallback.followPlayer,
      attackPlayer: typeof raw.attackPlayer === "boolean" ? raw.attackPlayer : fallback.attackPlayer,
      askAllyToSpeak:
        typeof raw.askAllyToSpeak === "boolean" ? raw.askAllyToSpeak : fallback.askAllyToSpeak,
      allyLine,
      memory
    };
  }

  private async reactCompanionToPlayerMessage(
    enemy: OnlineEnemyState,
    player: { id: number; name: string; x: number; y: number; hp: number; maxHp: number },
    messageText: string,
    nowMs: number
  ): Promise<void> {
    if (this.aiChatInFlightByEnemyId.has(enemy.id)) {
      return;
    }

    this.aiChatInFlightByEnemyId.add(enemy.id);
    try {
      const relation = this.ensureRelationship(enemy.id, player.id);
      const intent = this.parseIntent(messageText);
      this.applyIntentToRelationship(enemy, relation, intent, nowMs);
      this.applyConversationPause(enemy, nowMs, messageText.length);

      const killCount = this.enemyKillsByPlayerId.get(player.id) ?? 0;
      if (intent.objectiveKill3) {
        if (killCount >= 3) {
          relation.trust = clamp(relation.trust + 16, -100, 100);
          relation.aggression = clamp(relation.aggression - 10, 0, 100);
        } else {
          relation.trust = clamp(relation.trust + 2, -100, 100);
        }
      }

      this.updateDispositionFromRelationship(enemy, relation, player.id);

      const fallback = this.fallbackReply(enemy, player.name, relation, intent, killCount);
      const signature = this.buildDecisionSignature(messageText, relation, killCount);
      const cachedDecision = this.getCachedDecision(enemy.id, player.id, signature, nowMs);

      let decision: CompanionDecision = fallback;
      if (cachedDecision) {
        decision = cachedDecision;
      } else if (this.shouldUseGeminiForPlayerDecision(messageText, intent, relation, nowMs)) {
        const prompt = [
          "NPC RPG. Responda apenas JSON curto.",
          `npc=${enemy.name};persona=${this.personaDescription(enemy.aiPersonaId)}`,
          `player=${player.name};hp=${player.hp}/${player.maxHp}`,
          `rel t=${relation.trust} a=${relation.aggression} atk=${relation.attacksReceived} chats=${relation.chats} kills=${killCount}`,
          `msg=${this.sanitizeAiChatText(messageText).slice(0, 128)}`,
          `mem=${enemy.recentMemory.slice(-2).join(" || ") || "-"}`,
          'json={"reply":"pt-BR curto","mood":"friendly|neutral|hostile","followPlayer":true,"attackPlayer":false,"askAllyToSpeak":false,"allyLine":"","memory":""}'
        ].join("\n");

        const rawDecision = await this.askGeminiJson(prompt);
        decision = this.parseDecision(rawDecision, fallback);
        if (rawDecision) {
          this.setCachedDecision(enemy.id, player.id, signature, decision, nowMs);
        }
      }

      const canFollowNow = this.canEnemyFollowPlayer(enemy, relation, player.id);
      if (!canFollowNow) {
        decision.followPlayer = false;
        if (decision.mood === "friendly") {
          decision.mood = "neutral";
        }
        if (
          enemy.aiPersonaId === "FALLEN_KNIGHT" &&
          (intent.askJoin || intent.askHelp || intent.objectiveKill3)
        ) {
          decision.reply = this.fallenKnightPersuasionHint(player.name, relation, killCount);
        }
      }

      enemy.aiDisposition = decision.mood;
      enemy.lastAiInteractionAtMs = nowMs;

      if (decision.attackPlayer || decision.mood === "hostile") {
        enemy.targetPlayerId = player.id;
        enemy.followPlayerId = null;
        relation.aggression = clamp(Math.max(relation.aggression, 70), 0, 100);
      } else if (decision.followPlayer || decision.mood === "friendly") {
        enemy.followPlayerId = player.id;
        enemy.targetPlayerId = null;
        relation.trust = clamp(Math.max(relation.trust, 35), -100, 100);
        relation.aggression = clamp(relation.aggression - 2, 0, 100);
      } else if (enemy.targetPlayerId === player.id && relation.aggression < 55) {
        enemy.targetPlayerId = null;
      }

      relation.notes.push(`msg:${this.sanitizeAiChatText(messageText).slice(0, 72)}`);
      if (relation.notes.length > 8) {
        relation.notes.splice(0, relation.notes.length - 8);
      }

      const memoryNote = decision.memory ?? fallback.memory;
      if (memoryNote) {
        this.remember(enemy, `${new Date(nowMs).toISOString()} ${memoryNote}`);
      }

      this.applyConversationPause(enemy, nowMs, decision.reply.length);
      this.queueAiMessage(enemy.id, decision.reply, randomInt(600, 1200));

      if (decision.askAllyToSpeak) {
        const ally = enemy.allyEnemyId !== null ? this.getEnemyById(enemy.allyEnemyId) : null;
        if (ally && ally.isAiCompanion && ally.deadUntilMs === null) {
          const allyText = decision.allyLine ?? `${player.name}, estou atento ao que acontece aqui.`;
          this.applyConversationPause(ally, nowMs, allyText.length);
          this.queueAiMessage(ally.id, allyText, randomInt(1200, 2000));
        }
      }

      logInfo("AI", "NPC respondeu jogador", {
        npc: enemy.name,
        player: player.name,
        mood: enemy.aiDisposition,
        trust: relation.trust,
        aggression: relation.aggression
      });
    } catch (error) {
      logError("AI", "Falha no processamento de chat do companion", {
        npc: enemy.name,
        player: player.name,
        error: error instanceof Error ? error.message : "erro desconhecido"
      });
    } finally {
      this.aiChatInFlightByEnemyId.delete(enemy.id);
    }
  }

  private async runCompanionConversation(
    nowMs: number,
    players: Array<{ id: number; x: number; y: number }>
  ): Promise<void> {
    const companions = this.getAliveAiCompanions(nowMs);
    if (companions.length < 2) {
      return;
    }

    const speaker = randomFrom(companions);
    const listener = companions.find((entry) => entry.id !== speaker.id) ?? companions[0];
    if (!speaker || !listener || speaker.id === listener.id) {
      return;
    }

    const dist = Math.hypot(speaker.x - listener.x, speaker.y - listener.y);
    if (dist > 7) {
      return;
    }

    const fallbackLine =
      speaker.aiPersonaId === "LAST_MONK"
        ? "O equilibrio deste vale mudou. Mantenha os olhos no horizonte."
        : "Fique pronto. O proximo conflito esta perto.";
    const fallbackResponse =
      listener.aiPersonaId === "LAST_MONK"
        ? "Entendido. Vou manter nossa posicao."
        : "Estou pronto. Ninguem nos pega desprevenidos.";

    let raw: Record<string, unknown> | null = null;
    if (this.shouldUseGeminiForCompanionConversation(nowMs, players, speaker, listener)) {
      const prompt = [
        "Dois NPCs RPG. Responda JSON curto.",
        `A=${speaker.name}:${this.personaDescription(speaker.aiPersonaId)}`,
        `B=${listener.name}:${this.personaDescription(listener.aiPersonaId)}`,
        `memA=${speaker.recentMemory.slice(-2).join(" || ") || "-"}`,
        `memB=${listener.recentMemory.slice(-2).join(" || ") || "-"}`,
        'json={"line":"fala curta","listenerLine":"resposta curta","memory":"nota"}'
      ].join("\n");
      raw = await this.askGeminiJson(prompt);
    }
    const line =
      typeof raw?.line === "string" && raw.line.trim().length > 0
        ? this.sanitizeAiChatText(raw.line)
        : fallbackLine;
    const listenerLine =
      typeof raw?.listenerLine === "string" && raw.listenerLine.trim().length > 0
        ? this.sanitizeAiChatText(raw.listenerLine)
        : fallbackResponse;
    const memoryNote =
      typeof raw?.memory === "string" && raw.memory.trim().length > 0
        ? this.sanitizeAiChatText(raw.memory)
        : "Conversa interna entre companheiros.";

    this.applyConversationPause(speaker, nowMs, line.length);
    this.applyConversationPause(listener, nowMs + 400, listenerLine.length);
    this.queueAiMessage(speaker.id, line, randomInt(500, 1000));
    this.queueAiMessage(listener.id, listenerLine, randomInt(1300, 2100));

    this.remember(speaker, `${new Date(nowMs).toISOString()} ${memoryNote}`);
    this.remember(listener, `${new Date(nowMs).toISOString()} ${memoryNote}`);
  }

  private updateAiTargeting(
    enemy: OnlineEnemyState,
    playerPositions: Array<{ characterId: number; x: number; y: number }>
  ): void {
    const playersById = new Map(playerPositions.map((player) => [player.characterId, player]));

    if (enemy.aiDisposition === "hostile") {
      if (enemy.targetPlayerId !== null) {
        const target = playersById.get(enemy.targetPlayerId);
        if (!target || Math.hypot(target.x - enemy.x, target.y - enemy.y) > AI_HOSTILE_CHASE_RADIUS) {
          enemy.targetPlayerId = null;
        }
      }

      if (enemy.targetPlayerId === null) {
        const relations = this.relationByEnemyId.get(enemy.id);
        let bestPlayerId: number | null = null;
        let bestScore = -1;

        if (relations) {
          for (const [playerId, relation] of relations.entries()) {
            const player = playersById.get(playerId);
            if (!player) {
              continue;
            }
            const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
            if (dist > AI_HOSTILE_CHASE_RADIUS) {
              continue;
            }
            if (relation.aggression > bestScore) {
              bestScore = relation.aggression;
              bestPlayerId = playerId;
            }
          }
        }

        enemy.targetPlayerId = bestPlayerId;
      }

      return;
    }

    enemy.targetPlayerId = null;

    if (enemy.aiDisposition === "friendly") {
      if (enemy.followPlayerId !== null) {
        const followed = playersById.get(enemy.followPlayerId);
        const relation = this.ensureRelationship(enemy.id, enemy.followPlayerId);
        if (!followed || !this.canEnemyFollowPlayer(enemy, relation, enemy.followPlayerId)) {
          enemy.followPlayerId = null;
        }
      }

      if (enemy.followPlayerId === null) {
        const relations = this.relationByEnemyId.get(enemy.id);
        let bestPlayerId: number | null = null;
        let bestTrust = AI_FRIENDLY_THRESHOLD;
        if (relations) {
          for (const [playerId, relation] of relations.entries()) {
            const player = playersById.get(playerId);
            if (!player) {
              continue;
            }
            const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
            if (dist > AI_HOSTILE_CHASE_RADIUS) {
              continue;
            }
            if (relation.trust >= bestTrust) {
              if (!this.canEnemyFollowPlayer(enemy, relation, playerId)) {
                continue;
              }
              bestTrust = relation.trust;
              bestPlayerId = playerId;
            }
          }
        }
        enemy.followPlayerId = bestPlayerId;
      }
    } else if (enemy.aiDisposition === "neutral") {
      enemy.followPlayerId = null;
    }
  }
}
