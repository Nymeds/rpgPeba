-- Persisted chat history with encrypted message body and integrity hash.
CREATE TABLE "ChatMessage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playerId" INTEGER NOT NULL,
    "playerName" TEXT NOT NULL,
    "messageCipherText" TEXT NOT NULL,
    "messageHash" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ChatMessage_createdAt_idx" ON "ChatMessage"("createdAt");
