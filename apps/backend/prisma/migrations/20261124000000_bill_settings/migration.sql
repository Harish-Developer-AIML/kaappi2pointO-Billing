-- What the printed bill shows (Settings > Bill). NULL = the standard bill.
ALTER TABLE "branches" ADD COLUMN "billSettings" JSONB;
