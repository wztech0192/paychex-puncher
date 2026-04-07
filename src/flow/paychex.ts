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
const maxLoginRecoveryAttempts = 3;
const dashboardWaitTimeoutMs = 30000;
const missingClockInAfterLoginError =
  "Paychex login completed, but the clock-in widget did not appear.";
const paychexLoadErrorText = "Sorry, this info didn't load correctly.";

function isMissingClockInAfterLoginError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === missingClockInAfterLoginError
  );
}

async function hasPaychexLoadError(page: Page): Promise<boolean> {
  const bodyText = await page
    .$eval("body", (element) => element.innerText)
    .catch(() => "");

  return bodyText.includes(paychexLoadErrorText);
}

function isRetryablePaychexError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (isMissingClockInAfterLoginError(error)) {
    return true;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes("manual otp verification timed out") ||
    message.includes("invalid password") ||
    message.includes("invalid username") ||
    message.includes("access denied") ||
    message.includes("account locked")
  ) {
    return false;
  }

  return (
    message.includes(paychexLoadErrorText.toLowerCase()) ||
    message.includes("navigation timeout") ||
    message.includes("net::err_") ||
    message.includes("target closed") ||
    message.includes("detached frame") ||
    message.includes("execution context was destroyed")
  );
}

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

async function notifyRefreshRetry(
  page: Page,
  config: AppConfig,
  attempt: number,
  maxAttempts: number,
  reason: string,
): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return;
  }

  const screenshot = (await page.screenshot({
    type: "png",
  })) as Uint8Array;

  await sendPhotoToTelegram(config.telegramBotToken, config.telegramChatId, {
    photoBuffer: screenshot,
    filename: `paychex-refresh-attempt-${attempt}.png`,
    caption: `Paychex 页面异常：${reason}。准备刷新后重试（${attempt}/${maxAttempts}）。`,
  });

  await sendMessageToTelegram(config.telegramBotToken, {
    chatId: config.telegramChatId,
    text: `Paychex 页面异常：${reason}。正在刷新页面并重试（${attempt}/${maxAttempts}）。`,
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

async function runPaychexFlowOnce(
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
    if (await hasPaychexLoadError(page)) {
      throw new Error(paychexLoadErrorText);
    }

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
    await performHumanWarmup(page);

    const otpField = await page
      .waitForSelector(otpSelector, {
        timeout: 10000,
      })
      .catch(() => null);

    if (otpField) {
      await waitForManualOtpCompletion(page, config);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 120000 });
    }

    if (await hasPaychexLoadError(page)) {
      throw new Error(paychexLoadErrorText);
    }

    logger.info("Login flow completed");
    const clockInButton = await page
      .waitForSelector(punchSelectors.clockIn, {
        timeout: dashboardWaitTimeoutMs,
      })
      .catch(() => null);

    if (!clockInButton) {
      throw new Error(missingClockInAfterLoginError);
    }

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

export async function runPaychexFlow(
  page: Page,
  config: AppConfig,
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxLoginRecoveryAttempts; attempt += 1) {
    try {
      return await runPaychexFlowOnce(page, config);
    } catch (error) {
      if (
        !isRetryablePaychexError(error) ||
        attempt === maxLoginRecoveryAttempts
      ) {
        throw error;
      }

      const reason =
        error instanceof Error ? error.message : "Unknown Paychex page error";

      logger.warn(
        { attempt, maxAttempts: maxLoginRecoveryAttempts, reason },
        "Retryable Paychex flow error detected; refreshing page and retrying flow",
      );
      await notifyRefreshRetry(
        page,
        config,
        attempt,
        maxLoginRecoveryAttempts,
        reason,
      );
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await pause(page, 700, 1500);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: 120000 });
    }
  }

  throw new Error(missingClockInAfterLoginError);
}
