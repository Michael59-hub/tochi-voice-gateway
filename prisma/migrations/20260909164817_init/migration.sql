-- CreateEnum
CREATE TYPE "InstallationStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "QuotaTier" AS ENUM ('UNVERIFIED', 'VERIFIED');

-- CreateEnum
CREATE TYPE "AttestationType" AS ENUM ('PLAY_INTEGRITY', 'APP_ATTEST', 'NONE');

-- CreateEnum
CREATE TYPE "RequestRecordStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "installations" (
    "id" TEXT NOT NULL,
    "refreshCredentialHash" TEXT NOT NULL,
    "status" "InstallationStatus" NOT NULL DEFAULT 'ACTIVE',
    "platform" "Platform" NOT NULL,
    "quotaTier" "QuotaTier" NOT NULL DEFAULT 'UNVERIFIED',
    "attestationType" "AttestationType" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_request_records" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprintHmac" TEXT NOT NULL,
    "status" "RequestRecordStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_request_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installations_refreshCredentialHash_key" ON "installations"("refreshCredentialHash");

-- CreateIndex
CREATE INDEX "voice_request_records_expiresAt_idx" ON "voice_request_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "voice_request_records_installationId_idempotencyKey_key" ON "voice_request_records"("installationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "voice_request_records" ADD CONSTRAINT "voice_request_records_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "installations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
