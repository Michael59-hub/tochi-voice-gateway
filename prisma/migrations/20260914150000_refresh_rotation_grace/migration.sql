ALTER TABLE "installations"
ADD COLUMN "previousRefreshCredentialHash" TEXT,
ADD COLUMN "previousRefreshCredentialExpiresAt" TIMESTAMP(3);

CREATE INDEX "installations_previousRefreshCredentialHash_idx"
ON "installations"("previousRefreshCredentialHash");
