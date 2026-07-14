-- CreateTable
CREATE TABLE "nlp_requests_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nlp_requests_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nlp_requests_log_user_id_idx" ON "nlp_requests_log"("user_id");

-- CreateIndex
CREATE INDEX "nlp_requests_log_created_at_idx" ON "nlp_requests_log"("created_at");
