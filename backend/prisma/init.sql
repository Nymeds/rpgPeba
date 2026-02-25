PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Character" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "x" INTEGER NOT NULL DEFAULT 10,
    "y" INTEGER NOT NULL DEFAULT 10,
    "hp" INTEGER NOT NULL DEFAULT 100,
    "maxHp" INTEGER NOT NULL DEFAULT 100,
    "inventory" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Character_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account" ("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_username_key" ON "Account"("username");
CREATE UNIQUE INDEX IF NOT EXISTS "Character_name_key" ON "Character"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Character_accountId_key" ON "Character"("accountId");
