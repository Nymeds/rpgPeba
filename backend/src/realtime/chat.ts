import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { prisma } from "../db.js";
import { env } from "../env.js";
import { logInfo, logWarn } from "../logger.js";
import type { ChatHistoryPayload, ChatMessagePayload } from "./types.js";

const CHAT_HISTORY_LIMIT = 60;
const SYSTEM_PLAYER_ID = 0;
const SYSTEM_PLAYER_NAME = "Sistema";
const CHAT_CIPHER_ALGORITHM = "aes-256-gcm";
const CHAT_IV_BYTES = 12;

let chatHistory: ChatMessagePayload[] = [];
let chatHistoryLoaded = false;
let chatHistoryLoadPromise: Promise<void> | null = null;

const chatCryptoKey = createHash("sha256").update(env.CHAT_CRYPTO_SECRET, "utf8").digest();

type EncryptedMessage = {
  cipherTextBase64: string;
  messageHashHex: string;
  ivBase64: string;
  authTagBase64: string;
};

function pushMessage(message: ChatMessagePayload): ChatMessagePayload {
  chatHistory.push(message);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_LIMIT);
  }
  return message;
}

function hashMessage(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function encryptMessage(text: string): EncryptedMessage {
  const iv = randomBytes(CHAT_IV_BYTES);
  const cipher = createCipheriv(CHAT_CIPHER_ALGORITHM, chatCryptoKey, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cipherTextBase64: encrypted.toString("base64"),
    messageHashHex: hashMessage(text),
    ivBase64: iv.toString("base64"),
    authTagBase64: authTag.toString("base64")
  };
}

function decryptMessage(cipherTextBase64: string, ivBase64: string, authTagBase64: string): string {
  const decipher = createDecipheriv(
    CHAT_CIPHER_ALGORITHM,
    chatCryptoKey,
    Buffer.from(ivBase64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherTextBase64, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

async function loadHistoryFromDatabase(): Promise<void> {
  const records = await prisma.chatMessage.findMany({
    orderBy: { id: "desc" },
    take: CHAT_HISTORY_LIMIT
  });

  const orderedRecords = [...records].reverse();
  const loaded: ChatMessagePayload[] = [];

  for (const record of orderedRecords) {
    try {
      const text = decryptMessage(record.messageCipherText, record.iv, record.authTag);
      const calculatedHash = hashMessage(text);
      if (calculatedHash !== record.messageHash) {
        logWarn("CHAT", "Hash divergente no historico persistido", {
          messageId: record.id,
          playerId: record.playerId
        });
      }

      loaded.push({
        id: record.id,
        playerId: record.playerId,
        playerName: record.playerName,
        text,
        createdAt: record.createdAt.getTime()
      });
    } catch (error) {
      logWarn("CHAT", "Falha ao descriptografar mensagem persistida", {
        messageId: record.id,
        playerId: record.playerId,
        error: error instanceof Error ? error.message : "erro desconhecido"
      });
    }
  }

  chatHistory = loaded;
  chatHistoryLoaded = true;
  logInfo("CHAT", "Historico carregado do banco", { loaded: loaded.length });
}

export async function initializeChatHistory(): Promise<void> {
  if (chatHistoryLoaded) {
    return;
  }

  if (!chatHistoryLoadPromise) {
    chatHistoryLoadPromise = loadHistoryFromDatabase().catch((error) => {
      chatHistoryLoadPromise = null;
      throw error;
    });
  }

  await chatHistoryLoadPromise;
}

export async function appendChatMessage(
  playerId: number,
  playerName: string,
  text: string
): Promise<ChatMessagePayload> {
  await initializeChatHistory();

  const encrypted = encryptMessage(text);
  const persisted = await prisma.chatMessage.create({
    data: {
      playerId,
      playerName,
      messageCipherText: encrypted.cipherTextBase64,
      messageHash: encrypted.messageHashHex,
      iv: encrypted.ivBase64,
      authTag: encrypted.authTagBase64
    }
  });

  const message: ChatMessagePayload = {
    id: persisted.id,
    playerId,
    playerName,
    text,
    createdAt: persisted.createdAt.getTime()
  };

  return pushMessage(message);
}

export async function appendSystemChatMessage(text: string): Promise<ChatMessagePayload> {
  return appendChatMessage(SYSTEM_PLAYER_ID, SYSTEM_PLAYER_NAME, text);
}

export function buildChatHistoryPayload(): ChatHistoryPayload {
  return {
    messages: [...chatHistory]
  };
}
