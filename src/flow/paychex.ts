import type { Page } from "puppeteer-core";
import { PAYCHEX_URL, punchSelectors } from "../constants.js";
import { logger } from "../lib/logger.js";
import {
  getLastTelegramMessage,
  sendMessageToTelegram,
  sendPhotoToTelegram,
} from "../lib/telegram.js";
import type { AppConfig } from "../types.js";
import {
  clickLikeHuman,
  focusAndTypeLikeHuman,
  pause,
  performHumanWarmup,
} from "../lib/human.js";

const otpSelector = "#one-time-password";
const otpWaitTimeoutMs = 5000;

async function isAlreadyLoggedIn(page: Page): Promise<boolean> {
  const punchWidget = await page
    .waitForSelector(punchSelectors.clockIn, { timeout: 15000 })
    .catch(() => null);

  return Boolean(punchWidget);
}

async function notifyManualOtpRequired(config: AppConfig): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return;
  }

  await sendMessageToTelegram(config.telegramBotToken, {
    chatId: config.telegramChatId,
    text: "检测到 Paychex 一次性验证码页面。请发送5位数验证码，不带其他字符。4 分钟内未完成将自动取消。",
  });
}

async function notifyManualOtpCancelled(config: AppConfig): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return;
  }

  await sendMessageToTelegram(config.telegramBotToken, {
    chatId: config.telegramChatId,
    text: "验证码验证已取消：4 分钟内未完成手动操作。",
  });
}

async function waitForManualOtpCompletion(
  page: Page,
  config: AppConfig,
): Promise<void> {
  logger.warn(
    { timeoutMs: otpWaitTimeoutMs },
    "OTP step detected; waiting for manual verification in browser",
  );

  await sendPhotoToTelegram(config.telegramBotToken!, config.telegramChatId!, {
    photoBuffer: (await page.screenshot({
      type: "png",
    })) as Uint8Array,
    filename: "finish-screen.png",
    caption: `进入一次性验证码(OTP)页面...`,
  });

  await notifyManualOtpRequired(config);

  const lastMessage = await getLastTelegramMessage({
    token: config.telegramBotToken!,
    groupTitle: config.telegramGroupTitle,
    chatId: config.telegramChatId,
    botUsername: config.telegramBotUsername,
    timeout: 60 * 4,
    maxAgeSeconds: 10,
  });

  if (lastMessage?.message.text) {
    logger.info(
      { text: lastMessage.message.text },
      "Received Telegram message for OTP verification",
    );
    await focusAndTypeLikeHuman(
      page,
      "#one-time-password",
      lastMessage.message.text,
    );

    logger.info("Entering OTP and submitting verification");
    await clickLikeHuman(page, "#verify-otp-checkbox");
    await clickLikeHuman(page, "#otp-next-button");
  } else {
    logger.warn("No Telegram message received for OTP verification");
  }

  await page.waitForNavigation({
    waitUntil: "networkidle2",
    timeout: 120000,
  });

  await sendPhotoToTelegram(config.telegramBotToken!, config.telegramChatId!, {
    photoBuffer: (await page.screenshot({
      type: "png",
    })) as Uint8Array,
    filename: "finish-screen.png",
    caption: `已输入 OTP，等待验证结果...`,
  });

  const completed = await page
    .waitForFunction(
      async ({ otpSelector: fieldSelector, dashboardSelector }) => {
        const dashboard = document.querySelector(dashboardSelector);
        const otpField = document.querySelector(fieldSelector);

        return !otpField || Boolean(dashboard);
      },
      { timeout: otpWaitTimeoutMs },
      {
        otpSelector,
        dashboardSelector: punchSelectors.clockIn,
      },
    )
    .then(() => true)
    .catch(() => false);

  if (!completed) {
    await notifyManualOtpCancelled(config);
    throw new Error(
      "Manual OTP verification timed out after 4 minutes and was cancelled.",
    );
  }

  logger.info("Manual OTP step completed");
}

export async function runPaychexFlow(
  page: Page,
  config: AppConfig,
): Promise<Uint8Array> {
  logger.info({ url: PAYCHEX_URL }, "Opening Paychex login page");
  await page.goto(PAYCHEX_URL, { waitUntil: "domcontentloaded" });
  await pause(page, 700, 1500);
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 120000 });
  logger.info("Running pre-login warmup");
  await performHumanWarmup(page);

  if (!(await isAlreadyLoggedIn(page))) {
    logger.info("Session not logged in, entering username");
    await focusAndTypeLikeHuman(
      page,
      "#login-username",
      config.paychexUsername,
    );
    await clickLikeHuman(page, "#login-button");
    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    logger.info("Entering password");
    await focusAndTypeLikeHuman(
      page,
      "#login-password",
      config.paychexPassword,
    );
    await clickLikeHuman(page, "#login-button");
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 120000 });

    const otpField = await page
      .waitForSelector(otpSelector, {
        timeout: 10000,
      })
      .catch(() => null);

    if (otpField) {
      await performHumanWarmup(page);

      await waitForManualOtpCompletion(page, config);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 120000 });
    }

    logger.info("Login flow completed");

    await page.waitForSelector(punchSelectors.clockIn, { timeout: 120000 });
    logger.info("Dashboard loaded, running warmup");
    await performHumanWarmup(page);
  } else {
    logger.info("Existing logged-in session detected");
  }

  logger.info({ action: config.paychexAction }, "Clicking target punch action");
  await clickLikeHuman(page, punchSelectors[config.paychexAction]);
  await pause(page, 1500, 2500);

  logger.info("Capturing in-memory screenshot");
  return (await page.screenshot({ type: "png" })) as Uint8Array;
}
