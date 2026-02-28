import type { ChatHistoryPayload, ChatMessagePayload } from "./types.js";

const CHAT_HISTORY_LIMIT = 60;
const SYSTEM_PLAYER_ID = 0;
const SYSTEM_PLAYER_NAME = "Sistema";
const chatHistory: ChatMessagePayload[] = [];
let nextChatMessageId = 1;

function pushMessage(message: ChatMessagePayload): ChatMessagePayload {
  chatHistory.push(message);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_LIMIT);
  }
  return message;
}

export function appendChatMessage(playerId: number, playerName: string, text: string): ChatMessagePayload {
  const message: ChatMessagePayload = {
    id: nextChatMessageId++,
    playerId,
    playerName,
    text,
    createdAt: Date.now()
  };

  return pushMessage(message);
}

export function appendSystemChatMessage(text: string): ChatMessagePayload {
  return appendChatMessage(SYSTEM_PLAYER_ID, SYSTEM_PLAYER_NAME, text);
}

export function buildChatHistoryPayload(): ChatHistoryPayload {
  return {
    messages: [...chatHistory]
  };
}
