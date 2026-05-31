/*
  Warnings:

  - The values [IN_TREATMENT] on the enum `AdmissionStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [YEARLY] on the enum `ExpenseFrequency` will be removed. If these variants are still used in the database, this will fail.
  - The values [PHARMACY] on the enum `UserRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `isDispensed` on the `prescriptions` table. All the data in the column will be lost.
  - You are about to drop the `pharmacy_bill_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `pharmacy_bills` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AdmissionStatus_new" AS ENUM ('ADMITTED', 'CRITICAL', 'READY_FOR_DISCHARGE', 'DISCHARGED');
ALTER TABLE "public"."admissions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "admissions" ALTER COLUMN "status" TYPE "AdmissionStatus_new" USING ("status"::text::"AdmissionStatus_new");
ALTER TYPE "AdmissionStatus" RENAME TO "AdmissionStatus_old";
ALTER TYPE "AdmissionStatus_new" RENAME TO "AdmissionStatus";
DROP TYPE "public"."AdmissionStatus_old";
ALTER TABLE "admissions" ALTER COLUMN "status" SET DEFAULT 'ADMITTED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ExpenseFrequency_new" AS ENUM ('MONTHLY', 'QUARTERLY');
ALTER TABLE "expenses" ALTER COLUMN "frequency" TYPE "ExpenseFrequency_new" USING ("frequency"::text::"ExpenseFrequency_new");
ALTER TYPE "ExpenseFrequency" RENAME TO "ExpenseFrequency_old";
ALTER TYPE "ExpenseFrequency_new" RENAME TO "ExpenseFrequency";
DROP TYPE "public"."ExpenseFrequency_old";
COMMIT;

-- AlterEnum
ALTER TYPE "PaymentMode" ADD VALUE 'BANK_TRANSFER';

-- AlterEnum
BEGIN;
CREATE TYPE "UserRole_new" AS ENUM ('SUPER_ADMIN', 'DOCTOR', 'RECEPTION');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "public"."UserRole_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "pharmacy_bill_items" DROP CONSTRAINT "pharmacy_bill_items_pharmacyBillId_fkey";

-- DropForeignKey
ALTER TABLE "pharmacy_bills" DROP CONSTRAINT "pharmacy_bills_billedBy_fkey";

-- DropForeignKey
ALTER TABLE "pharmacy_bills" DROP CONSTRAINT "pharmacy_bills_patientId_fkey";

-- AlterTable
ALTER TABLE "hospital_settings" ADD COLUMN     "city" TEXT,
ADD COLUMN     "mobile" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "registrationNo" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "tagline" TEXT;

-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "allergies" TEXT,
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emergencyName" TEXT;

-- AlterTable
ALTER TABLE "prescriptions" DROP COLUMN "isDispensed";

-- DropTable
DROP TABLE "pharmacy_bill_items";

-- DropTable
DROP TABLE "pharmacy_bills";

-- CreateTable
CREATE TABLE "discharge_cards" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "dischargeDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "diagnosis" TEXT NOT NULL,
    "conditionOnAdmission" TEXT,
    "conditionOnDischarge" TEXT,
    "treatmentGiven" TEXT,
    "investigations" JSONB,
    "medicinesOnDischarge" JSONB,
    "dietaryAdvice" TEXT,
    "followUpDate" TIMESTAMP(3),
    "followUpInstructions" TEXT,
    "emergencyInstructions" TEXT,
    "additionalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discharge_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discharge_cards_admissionId_key" ON "discharge_cards"("admissionId");

-- AddForeignKey
ALTER TABLE "discharge_cards" ADD CONSTRAINT "discharge_cards_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
