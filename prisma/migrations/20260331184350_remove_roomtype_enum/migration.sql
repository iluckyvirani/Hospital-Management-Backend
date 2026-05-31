/*
  Warnings:

  - You are about to drop the column `typeText` on the `room_type_configs` table. All the data in the column will be lost.
  - Changed the type of `type` on the `room_type_configs` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "room_type_configs" DROP COLUMN "typeText",
DROP COLUMN "type",
ADD COLUMN     "type" TEXT NOT NULL;

-- DropEnum
DROP TYPE "RoomType";

-- CreateIndex
CREATE UNIQUE INDEX "room_type_configs_type_key" ON "room_type_configs"("type");
