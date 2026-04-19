import { logger } from "../lib/logger.js";
import { MediaIngestService } from "../services/ingest-media.js";

type SupportedFeed = "home" | "popular-movies" | "top-movies";

async function main(): Promise<void> {
  const [feed, ...args] = process.argv.slice(2);

  if (!isSupportedFeed(feed)) {
    throw new Error(
      'Usage: npm run ingest:home [-- --limit=20] | npm run ingest:popular-movies [-- --page=1 --limit=20] | npm run ingest:top-movies [-- --page=1 --limit=20]'
    );
  }

  const options = parseOptions(args);
  const service = new MediaIngestService();

  switch (feed) {
    case "home":
      await service.ingestHome({ ...(options.limit ? { limit: options.limit } : {}) });
      break;
    case "popular-movies":
      await service.ingestPopularMovies({
        ...(options.page ? { page: options.page } : {}),
        ...(options.limit ? { limit: options.limit } : {})
      });
      break;
    case "top-movies":
      await service.ingestTopMovies({
        ...(options.page ? { page: options.page } : {}),
        ...(options.limit ? { limit: options.limit } : {})
      });
      break;
  }
}

function isSupportedFeed(value: string | undefined): value is SupportedFeed {
  return value === "home" || value === "popular-movies" || value === "top-movies";
}

function parseOptions(args: string[]) {
  let page: number | undefined;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--page") {
      page = parsePositiveInteger(args[index + 1], "page");
      index += 1;
      continue;
    }

    if (arg.startsWith("--page=")) {
      page = parsePositiveInteger(arg.slice("--page=".length), "page");
      continue;
    }

    if (arg === "--limit") {
      limit = parsePositiveInteger(args[index + 1], "limit");
      index += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      limit = parsePositiveInteger(arg.slice("--limit=".length), "limit");
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { page, limit };
}

function parsePositiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);

  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value ?? ""}`);
  }

  return parsed;
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Feed ingestion failed");
  process.exitCode = 1;
});
