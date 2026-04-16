import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { MediaIngestService } from "../services/ingest-media.js";

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(" ").trim();

  if (!query) {
    throw new Error("Usage: npm run ingest:search -- \"movie title\"");
  }

  const service = new MediaIngestService();
  await service.ingestByQuery({
    query,
    limit: env.INGEST_DEFAULT_LIMIT
  });
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Ingestion failed");
  process.exitCode = 1;
});

