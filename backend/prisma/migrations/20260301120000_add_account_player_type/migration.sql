-- Add player type selection stored at account level.
-- Existing accounts default to WARRIOR for backward compatibility.
ALTER TABLE "Account"
ADD COLUMN "playerType" TEXT NOT NULL DEFAULT 'WARRIOR';
