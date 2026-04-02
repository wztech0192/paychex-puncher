import type { Page } from "puppeteer-core";
import { PAYCHEX_URL, punchSelectors } from "../constants.js";
import { logger } from "../lib/logger.js";
import type { AppConfig } from "../types.js";
import {
  clickLikeHuman,
  focusAndTypeLikeHuman,
  pause,
  performHumanWarmup,
} from "../lib/human.js";

async function isAlreadyLoggedIn(page: Page): Promise<boolean> {
  const punchWidget = await page
    .waitForSelector(punchSelectors.clockIn, { timeout: 5000 })
    .catch(() => null);

  return Boolean(punchWidget);
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
    await page.waitForNavigation({
      waitUntil: "networkidle2",
      timeout: 120000,
    });
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
