/*
  Warnings:

  - A unique constraint covering the columns `[phone]` on the table `patients` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "patients_aadhar_key";

-- CreateIndex
CREATE UNIQUE INDEX "patients_phone_key" ON "patients"("phone");
