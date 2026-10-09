-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PENDING', 'BANNED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('NEW', 'RENEW', 'TOPUP');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('YOOKASSA', 'STARS', 'MANUAL');

-- CreateEnum
CREATE TYPE "WhitelistAction" AS ENUM ('ADD', 'REMOVE');

-- CreateEnum
CREATE TYPE "WhitelistActor" AS ENUM ('ADMIN', 'SYSTEM', 'BOT', 'RCON_RETRY');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('NICK_CHANGE', 'SUPPORT', 'REFUND_REQUEST');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tgId" BIGINT NOT NULL,
    "tgUsername" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT DEFAULT 'ru',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mcNick" TEXT NOT NULL,
    "mcNickLower" TEXT NOT NULL,
    "status" "PlayerStatus" NOT NULL DEFAULT 'PENDING',
    "currentSeasonId" TEXT,
    "totalPaid" INTEGER NOT NULL DEFAULT 0,
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "firstPaidAt" TIMESTAMP(3),
    "lastPaidAt" TIMESTAMP(3),
    "banReason" TEXT,
    "bannedAt" TIMESTAMP(3),
    "bannedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSeason" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "status" "PlayerStatus" NOT NULL DEFAULT 'PENDING',
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "paidAmount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlayerSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "priceNew" INTEGER NOT NULL,
    "priceRenew" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seasonId" TEXT,
    "playerId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "type" "PaymentType" NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'YOOKASSA',
    "description" TEXT,
    "providerPaymentId" TEXT,
    "confirmationUrl" TEXT,
    "idempotencyKey" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "telegramPaymentChargeId" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhitelistLog" (
    "id" TEXT NOT NULL,
    "mcNick" TEXT NOT NULL,
    "mcNickLower" TEXT NOT NULL,
    "action" "WhitelistAction" NOT NULL,
    "actor" "WhitelistActor" NOT NULL DEFAULT 'SYSTEM',
    "seasonId" TEXT,
    "paymentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhitelistLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TicketType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "moderatorId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NickRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldNick" TEXT,
    "newNick" TEXT NOT NULL,
    "newNickLower" TEXT NOT NULL,
    "reason" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "moderatorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "NickRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorTgId" BIGINT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parseMode" TEXT NOT NULL DEFAULT 'HTML',
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McJob" (
    "id" TEXT NOT NULL,
    "queueJobId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tgId_key" ON "User"("tgId");

-- CreateIndex
CREATE INDEX "User_tgUsername_idx" ON "User"("tgUsername");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Player_mcNick_key" ON "Player"("mcNick");

-- CreateIndex
CREATE UNIQUE INDEX "Player_mcNickLower_key" ON "Player"("mcNickLower");

-- CreateIndex
CREATE INDEX "Player_status_idx" ON "Player"("status");

-- CreateIndex
CREATE INDEX "Player_currentSeasonId_idx" ON "Player"("currentSeasonId");

-- CreateIndex
CREATE INDEX "PlayerSeason_seasonId_status_idx" ON "PlayerSeason"("seasonId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSeason_playerId_seasonId_key" ON "PlayerSeason"("playerId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Season_number_key" ON "Season"("number");

-- CreateIndex
CREATE INDEX "Season_isActive_idx" ON "Season"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_seasonId_idx" ON "Payment"("seasonId");

-- CreateIndex
CREATE INDEX "WhitelistLog_mcNickLower_createdAt_idx" ON "WhitelistLog"("mcNickLower", "createdAt");

-- CreateIndex
CREATE INDEX "WhitelistLog_paymentId_action_idx" ON "WhitelistLog"("paymentId", "action");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_userId_idx" ON "Ticket"("userId");

-- CreateIndex
CREATE INDEX "NickRequest_status_createdAt_idx" ON "NickRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "NickRequest_newNickLower_idx" ON "NickRequest"("newNickLower");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Broadcast_status_idx" ON "Broadcast"("status");

-- CreateIndex
CREATE UNIQUE INDEX "McJob_queueJobId_key" ON "McJob"("queueJobId");

-- CreateIndex
CREATE INDEX "McJob_status_createdAt_idx" ON "McJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_currentSeasonId_fkey" FOREIGN KEY ("currentSeasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSeason" ADD CONSTRAINT "PlayerSeason_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSeason" ADD CONSTRAINT "PlayerSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhitelistLog" ADD CONSTRAINT "WhitelistLog_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhitelistLog" ADD CONSTRAINT "WhitelistLog_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NickRequest" ADD CONSTRAINT "NickRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

