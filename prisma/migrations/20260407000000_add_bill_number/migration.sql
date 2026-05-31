-- AlterTable
ALTER TABLE "final_bills" ADD COLUMN "billNumber" TEXT;

-- Backfill existing rows
UPDATE "final_bills" SET "billNumber" = 'BILL-' || LPAD(ROW_NUMBER::TEXT, 3, '0')
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC) AS ROW_NUMBER
  FROM "final_bills"
) AS numbered
WHERE "final_bills".id = numbered.id;

-- CreateIndex
CREATE UNIQUE INDEX "final_bills_billNumber_key" ON "final_bills"("billNumber");
