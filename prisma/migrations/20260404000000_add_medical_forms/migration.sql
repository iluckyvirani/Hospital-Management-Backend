-- CreateTable
CREATE TABLE "medical_forms" (
    "id" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "formType" TEXT NOT NULL,
    "formData" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medical_forms_admissionId_formType_key" ON "medical_forms"("admissionId", "formType");

-- CreateIndex
CREATE INDEX "medical_forms_admissionId_idx" ON "medical_forms"("admissionId");

-- CreateIndex
CREATE INDEX "medical_forms_createdBy_idx" ON "medical_forms"("createdBy");

-- AddForeignKey
ALTER TABLE "medical_forms" ADD CONSTRAINT "medical_forms_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_forms" ADD CONSTRAINT "medical_forms_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON UPDATE CASCADE;
