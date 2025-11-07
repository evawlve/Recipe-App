-- CreateTable
CREATE TABLE "PortionOverride" (
    "id" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPortionOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "foodId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "grams" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPortionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortionOverride_unit_idx" ON "PortionOverride"("unit");

-- CreateIndex
CREATE UNIQUE INDEX "PortionOverride_foodId_unit_key" ON "PortionOverride"("foodId", "unit");

-- CreateIndex
CREATE INDEX "UserPortionOverride_userId_foodId_idx" ON "UserPortionOverride"("userId", "foodId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPortionOverride_userId_foodId_unit_key" ON "UserPortionOverride"("userId", "foodId", "unit");

-- AddForeignKey
ALTER TABLE "PortionOverride" ADD CONSTRAINT "PortionOverride_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPortionOverride" ADD CONSTRAINT "UserPortionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPortionOverride" ADD CONSTRAINT "UserPortionOverride_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

