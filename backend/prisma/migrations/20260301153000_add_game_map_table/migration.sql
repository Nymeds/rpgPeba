-- Table that stores editable map definitions (layers + objects as JSON)
CREATE TABLE "GameMap" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "mapKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapSize" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Unique key per map identifier (supports multiple maps in the future)
CREATE UNIQUE INDEX "GameMap_mapKey_key" ON "GameMap"("mapKey");
