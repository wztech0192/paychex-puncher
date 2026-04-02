import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../types.js";
import { resolveActionFromArgs } from "./cli.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadLocalEnv(): void {
  const envPath = path.resolve(__dirname, "../../.env.local");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
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
