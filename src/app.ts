import { actionLabels } from "./constants.js";
import { runPaychexFlow } from "./flow/paychex.js";
import { launchBrowser } from "./lib/browser.js";
import { logger } from "./lib/logger.js";
import { sendPhotoToTelegram } from "./lib/telegram.js";
import type { AppConfig } from "./types.js";

export async function runApp(config: AppConfig): Promise<void> {
  logger.info(
    {
      runtime: config.runtime,
      headless: config.isHeadless,
      action: config.paychexAction,
    },
    "Launching Paychex app",
  );
  const session = await launchBrowser(config);

  try {
    logger.info({ action: config.paychexAction }, "Running Paychex flow");
    const screenshot = await runPaychexFlow(session.page, config);

    if (config.telegramBotToken && config.telegramChatId) {
      logger.info(
        { chatId: config.telegramChatId, action: config.paychexAction },
        "Sending success screenshot to Telegram",
      );
      await sendPhotoToTelegram(
        config.telegramBotToken,
        config.telegramChatId,
        {
          photoBuffer: screenshot,
          filename: "finish-screen.png",
          caption: `打卡完成: ${actionLabels[config.paychexAction]}`,
        },
      );
    }
  } catch (error) {
    logger.error(
      { err: error, action: config.paychexAction },
      "Paychex flow failed",
    );
    if (config.telegramBotToken && config.telegramChatId) {
      const screenshot = (await session.page.screenshot({
        type: "png",
      })) as Uint8Array;
      const message = error instanceof Error ? error.message : String(error);

      await sendPhotoToTelegram(
        config.telegramBotToken,
        config.telegramChatId,
        {
          photoBuffer: screenshot,
          filename: "error-screen.png",
          caption: `打卡失败: ${actionLabels[config.paychexAction]} - ${message}`,
        },
      );
    }

    throw error;
  }

  logger.info("Closing browser session");
  await session.browser.close();
}
