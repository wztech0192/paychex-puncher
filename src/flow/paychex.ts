import type { Page } from "puppeteer-core";
import { punchSelectors } from "../constants.js";
import { logger } from "../lib/logger.js";
import { sendMessageToTelegram, sendPhotoToTelegram } from "../lib/telegram.js";
import type { AppConfig } from "../types.js";
import {
  clickLikeHuman,
  focusAndTypeLikeHuman,
  pause,
  performHumanWarmup,
} from "../lib/human.js";
import {
  completeOtpRequest,
  createOtpRequest,
  getSubmittedOtpDetails,
} from "../lib/otp-state.js";
import { sleep } from "../lib/runtime.js";

// All Paychex page element selectors live here so they can be updated in one place.
const selectors = {
  body: "body",
  loginUsername: "#login-username",
  loginButton: "#login-button",
  password: "#password",
  otpCode: '[data-payxautoid="payx.auth0.login.verifyOtp"]',
  otpTrustCheckbox: "#rememberBrowser",
  loginSubmitButton: '[data-payxautoid="payx.auth0.login.submitButton"]',
  clockInWidget: punchSelectors.clockIn,
} as const;

const manualOtpCompletionTimeoutMs = 4 * 60 * 1000;
const maxLoginRecoveryAttempts = 3;
const dashboardWaitTimeoutMs = 30000;
const defaultTimeout = 15000;
const missingClockInAfterLoginError =
  "Paychex login completed, but the clock-in widget did not appear.";
const paychexLoadErrorText = "Sorry, this info didn't load correctly.";
export const otpCodePattern = /^\d{4,7}$/;

function isMissingClockInAfterLoginError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === missingClockInAfterLoginError
  );
}

async function hasPaychexLoadError(page: Page): Promise<boolean> {
  const bodyText = await page
    .$eval(selectors.body, (element) => element.innerText)
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
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("net::err_") ||
    message.includes("target closed") ||
    message.includes("detached frame") ||
    message.includes("execution context was destroyed")
  );
}

async function isAlreadyLoggedIn(page: Page): Promise<boolean> {
  const result = await Promise.race([
    page
      .waitForSelector(selectors.clockInWidget, { timeout: defaultTimeout })
      .then(() => "logged-in" as const)
      .catch(() => null),

    page
      .waitForSelector(selectors.loginUsername, { timeout: defaultTimeout })
      .then(() => "login" as const)
      .catch(() => null),
  ]);

  return result === "logged-in";
}

async function notifyManualOtpRequired(config: AppConfig): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return;
  }

  await sendMessageToTelegram(config.telegramBotToken, {
    chatId: config.telegramChatId,
    text: "检测到 Paychex 一次性验证码页面。你可以直接在浏览器里完成验证，或在群里发送数验证码（不要带其他字符）。4 分钟内未完成将自动取消。",
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
  const requestId = `otp-${Date.now()}`;

  logger.warn(
    { timeoutMs: manualOtpCompletionTimeoutMs },
    "OTP step detected; waiting for manual verification in browser",
  );

  createOtpRequest({
    requestId,
    chatId: config.telegramChatId,
    timeoutMs: manualOtpCompletionTimeoutMs,
  });
  await notifyManualOtpRequired(config);

  const pollStartedAt = Date.now();
  let otpEnteredFromTelegram = false;

  while (Date.now() - pollStartedAt < manualOtpCompletionTimeoutMs) {
    const submittedOtp = getSubmittedOtpDetails(requestId);
    const otpText = submittedOtp?.code;

    if (otpText && otpCodePattern.test(otpText)) {
      logger.info(
        { text: otpText },
        "Received Telegram OTP code from shared listener state",
      );
      if (config.telegramBotToken && config.telegramChatId) {
        await sendMessageToTelegram(config.telegramBotToken, {
          chatId: config.telegramChatId,
          text: "已收到验证码，正在继续验证。",
          replyToMessageId: submittedOtp?.messageId,
        });
      }
      await focusAndTypeLikeHuman(page, selectors.otpCode, otpText);

      logger.info("Entering OTP and submitting verification");
      try {
        await clickLikeHuman(page, selectors.otpTrustCheckbox);
      } catch (error) {
        logger.warn({ error }, "Failed to click OTP trust checkbox");
      }
      await clickLikeHuman(page, selectors.loginSubmitButton);
      otpEnteredFromTelegram = true;
      break;
    }

    await sleep(1000);
  }

  if (otpEnteredFromTelegram) {
    await page
      .waitForNavigation({
        waitUntil: "networkidle2",
        timeout: defaultTimeout,
      })
      .catch(() => null);

    if (config.telegramBotToken && config.telegramChatId) {
      await sendPhotoToTelegram(
        config.telegramBotToken,
        config.telegramChatId,
        {
          photoBuffer: (await page.screenshot({
            type: "png",
          })) as Uint8Array,
          filename: "finish-screen.png",
          caption: `已输入 OTP，等待验证结果...`,
        },
      );
    }
  }

  const completed = await page
    .waitForFunction(
      async ({ otpCodeSelector, dashboardSelector }) => {
        const dashboard = document.querySelector(dashboardSelector);
        const otpField = document.querySelector(otpCodeSelector);

        return !otpField || Boolean(dashboard);
      },
      { timeout: manualOtpCompletionTimeoutMs },
      {
        otpCodeSelector: selectors.otpCode,
        dashboardSelector: selectors.clockInWidget,
      },
    )
    .then(() => true)
    .catch(() => false);

  if (!completed) {
    completeOtpRequest(requestId, "cancelled");
    await notifyManualOtpCancelled(config);
    throw new Error(
      "Manual OTP verification timed out after 4 minutes and was cancelled.",
    );
  }

  completeOtpRequest(requestId, "completed");
  logger.info("Manual OTP step completed");
}

async function runPaychexFlowOnce(
  page: Page,
  config: AppConfig,
): Promise<Uint8Array> {
  logger.info({ url: config.paychexLoginUrl }, "Opening Paychex login page");
  await page.goto(config.paychexLoginUrl, { waitUntil: "domcontentloaded" });
  await pause(page, 700, 1500);
  await page.waitForNetworkIdle({ idleTime: 800, timeout: defaultTimeout });
  logger.info("Running pre-login warmup");
  await performHumanWarmup(page);

  if (!(await isAlreadyLoggedIn(page))) {
    try {
      await performLogin(page, config);
    } catch (error) {
      if (await isAlreadyLoggedIn(page)) {
        logger.info("Login attempt failed, but session is already logged in");
      } else {
        throw error;
      }
    }
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
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: defaultTimeout,
      });
      await pause(page, 700, 1500);
      await page.waitForNetworkIdle({ idleTime: 800, timeout: defaultTimeout });
    }
  }

  throw new Error(missingClockInAfterLoginError);
}

async function performLogin(page: Page, config: AppConfig): Promise<void> {
  if (await hasPaychexLoadError(page)) {
    throw new Error(paychexLoadErrorText);
  }

  logger.info("Session not logged in, entering username");
  await focusAndTypeLikeHuman(
    page,
    selectors.loginUsername,
    config.paychexUsername,
  );
  await clickLikeHuman(page, selectors.loginButton);
  await page.waitForNavigation({
    waitUntil: "networkidle2",
    timeout: defaultTimeout,
  });

  logger.info("Entering password");
  await focusAndTypeLikeHuman(page, selectors.password, config.paychexPassword);
  await clickLikeHuman(page, selectors.loginSubmitButton);
  await page.waitForNetworkIdle({ idleTime: 800, timeout: defaultTimeout });

  await sleep(1000);

  await performHumanWarmup(page);

  logger.info("Checking for OTP field");
  const otpField = await page
    .waitForSelector(selectors.otpCode, {
      visible: true,
      timeout: 20000,
    })
    .catch(() => null);

  if (await hasPaychexLoadError(page)) {
    throw new Error(paychexLoadErrorText);
  }

  logger.info(`OTP field ${otpField ? "found" : "not found"}`);
  if (otpField) {
    await waitForManualOtpCompletion(page, config);
    await page.waitForNetworkIdle({ idleTime: 800, timeout: defaultTimeout });

    if (await hasPaychexLoadError(page)) {
      throw new Error(paychexLoadErrorText);
    }
  }

  logger.info("Login flow completed");
  const clockInButton = await page
    .waitForSelector(selectors.clockInWidget, {
      timeout: dashboardWaitTimeoutMs,
    })
    .catch(() => null);

  if (!clockInButton) {
    throw new Error(missingClockInAfterLoginError);
  }

  logger.info("Dashboard loaded, running warmup");
  await performHumanWarmup(page);
}
