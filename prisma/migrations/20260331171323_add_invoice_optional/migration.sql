/*
  Warnings:

  - A unique constraint covering the columns `[invoiceNumber]` on the table `opd_visits` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "opd_visits" ADD COLUMN     "invoiceNumber" TEXT,
ADD COLUMN     "invoiceSeq" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "opd_visits_invoiceNumber_key" ON "opd_visits"("invoiceNumber");
