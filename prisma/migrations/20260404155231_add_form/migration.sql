/*
  Warnings:

  - You are about to drop the column `formData` on the `medical_forms` table. All the data in the column will be lost.
  - You are about to drop the column `formType` on the `medical_forms` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[admissionId]` on the table `medical_forms` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sections` to the `medical_forms` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "medical_forms_admissionId_formType_key";

-- AlterTable
ALTER TABLE "medical_forms" DROP COLUMN "formData",
DROP COLUMN "formType",
ADD COLUMN     "sections" JSONB NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "medical_forms_admissionId_key" ON "medical_forms"("admissionId");
