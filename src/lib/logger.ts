import pino from "pino";

const usePretty =
  process.env.AWS_LAMBDA_FUNCTION_NAME == null &&
  process.env.PINO_PRETTY !== "false";

export const logger = pino({
  level: process.env.LOG_LEVEL || "debug",
  transport: usePretty
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});
