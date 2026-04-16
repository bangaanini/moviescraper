import { logger } from "../lib/logger.js";

async function main(): Promise<void> {
  logger.info(
    "Backfill subtitle worker belum diimplementasikan terpisah. Gunakan sementara `npm run ingest:search -- \"judul\"`."
  );
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Subtitle backfill failed");
  process.exitCode = 1;
});
