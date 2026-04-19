import { logger } from "../lib/logger.js";
import { MediaIngestService } from "../services/ingest-media.js";

type SupportedFeed = "home" | "popular-movies" | "top-movies";

async function main(): Promise<void> {
  const [feed, ...args] = process.argv.slice(2);

  if (!isSupportedFeed(feed)) {
    throw new Error(
      'Usage: npm run ingest:home [-- --page=1 --limit=20] [-- --offset=0] | npm run ingest:popular-movies [-- --page=1 --limit=20] | npm run ingest:top-movies [-- --page=1 --limit=20]'
    );
  }

  const options = parseOptions(args);
  const service = new MediaIngestService();

  switch (feed) {
    case "home":
      await service.ingestHome({
        ...(options.page ? { page: options.page } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {})
      });
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
  let offset: number | undefined;

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

    if (arg === "--offset") {
      offset = parseNonNegativeInteger(args[index + 1], "offset");
      index += 1;
      continue;
    }

    if (arg.startsWith("--offset=")) {
      offset = parseNonNegativeInteger(arg.slice("--offset=".length), "offset");
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (page !== undefined && offset !== undefined) {
    throw new Error("Use either --page or --offset for home ingest, not both");
  }

  return { page, limit, offset };
}

function parsePositiveInteger(value: string | undefined, name: string) {
  const parsed = Number(value);

  if (!value || !Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${name}: ${value ?? ""}`);
  }

  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, name: string) {
  const parsed = Number(value);

  if (!value || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: ${value ?? ""}`);
  }

  return parsed;
}

main().catch((error: unknown) => {
  logger.error({ err: error }, "Feed ingestion failed");
  process.exitCode = 1;
});
