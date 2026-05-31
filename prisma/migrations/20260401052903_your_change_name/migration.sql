/*
  Warnings:

  - Added the required column `discountAmount` to the `final_bills` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "final_bills" ADD COLUMN     "discountAmount" DECIMAL(10,2) NOT NULL;
