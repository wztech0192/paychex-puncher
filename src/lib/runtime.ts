import { logger } from "./logger.js";

let processHandlersInstalled = false;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function installProcessErrorHandlers(service: string): void {
  if (processHandlersInstalled) {
    return;
  }

  processHandlersInstalled = true;

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason, service }, "Unhandled promise rejection");
  });

  process.on("uncaughtException", (error) => {
    logger.error({ err: error, service }, "Uncaught exception");
  });
}
