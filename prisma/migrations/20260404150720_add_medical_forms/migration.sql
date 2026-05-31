-- DropForeignKey
ALTER TABLE "medical_forms" DROP CONSTRAINT "medical_forms_createdBy_fkey";

-- DropIndex
DROP INDEX "medical_forms_admissionId_idx";

-- DropIndex
DROP INDEX "medical_forms_createdBy_idx";

-- AddForeignKey
ALTER TABLE "medical_forms" ADD CONSTRAINT "medical_forms_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
