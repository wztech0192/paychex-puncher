import { resolveConfig } from "./lib/env.js";
import { runApp } from "./app.js";
import { logger } from "./lib/logger.js";

async function main(): Promise<void> {
  const config = resolveConfig();
  logger.info(
    { action: config.paychexAction, headless: config.isHeadless },
    "Starting local Paychex runner",
  );
  await runApp(config);
}

main().catch((error) => {
  logger.error({ err: error }, "Local Paychex runner failed");
  process.exit(1);
});
