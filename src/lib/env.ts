import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { AppConfig } from "../types.js";
import { resolveActionFromArgs } from "./cli.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, "../../.env.local");

dotenv.config({
  path: envPath,
  override: false,
});

export function parseBooleanEnv(name: string, defaultValue = false): boolean {
  const value = process.env[name];

  if (value == null || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function resolveConfig(
  options?: Partial<
    Pick<AppConfig, "isHeadless" | "runtime" | "paychexAction">
  >,
): AppConfig {
  const runtime =
    options?.runtime ??
    (process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "local");
  const paychexAction =
    options?.paychexAction ??
    resolveActionFromArgs(process.argv.slice(2)) ??
    ((process.env.PAYCHEX_ACTION as AppConfig["paychexAction"]) || "clockOut");

  return {
    isHeadless: options?.isHeadless ?? process.argv.includes("--headless"),
    runtime,
    chromePath: process.env.CHROME_PATH,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    telegramGroupTitle: process.env.TELEGRAM_GROUP_TITLE || "Punch",
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    paychexUsername: process.env.PAYCHEX_USERNAME || "",
    paychexPassword: process.env.PAYCHEX_PASSWORD || "",
    paychexAction,
  };
}
