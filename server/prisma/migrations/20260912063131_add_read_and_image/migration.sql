-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "read" BOOLEAN NOT NULL DEFAULT false;
