import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chromium from "@sparticuz/chromium";
import puppeteer, { type Page } from "puppeteer-core";
import { defaultChromeCandidates } from "../constants.js";
import type { AppConfig, BrowserSession } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iphone16ProMaxViewport = {
  width: 440,
  height: 956,
  deviceScaleFactor: 3,
  isLandscape: false,
  isMobile: true,
  hasTouch: true,
} as const;

function findLocalBrowserExecutable(explicitPath?: string): string {
  const candidates = [explicitPath, ...defaultChromeCandidates].filter(
    (value): value is string => Boolean(value),
  );

  const browserPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (!browserPath) {
    throw new Error(
      "No supported browser executable was found. Set CHROME_PATH to chrome.exe or msedge.exe.",
    );
  }

  return browserPath;
}

async function applyBrowserDefaults(page: Page): Promise<void> {
  await page.setViewport(iphone16ProMaxViewport);

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
  );

  await page.setExtraHTTPHeaders({
    "accept-language": "en-US,en;q=0.9",
  });

  await page.emulateTimezone("America/New_York");

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "language", {
      get: () => "en-US",
    });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });
    Object.defineProperty(navigator, "platform", {
      get: () => "Win32",
    });
    Object.defineProperty(navigator, "hardwareConcurrency", {
      get: () => 8,
    });
  });
}

export async function launchBrowser(config: AppConfig): Promise<BrowserSession> {
  if (config.runtime === "lambda") {
    const browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: chromium.args,
      defaultViewport: iphone16ProMaxViewport,
      headless: true,
    });

    const pages = await browser.pages();
    const page = pages[0] ?? (await browser.newPage());
    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(30000);
    await applyBrowserDefaults(page);

    return { browser, page };
  }

  const userDataDir = path.resolve(__dirname, "../../.chrome-profile");
  const browser = await puppeteer.launch({
    executablePath: findLocalBrowserExecutable(config.chromePath),
    headless: config.isHeadless,
    userDataDir,
    defaultViewport: null,
    args: ["--start-maximized", "--lang=en-US,en", "--window-position=40,40"],
  });

  const pages = await browser.pages();
  const page = pages[0] ?? (await browser.newPage());
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(30000);
  await applyBrowserDefaults(page);

  return {
    browser,
    page,
    userDataDir,
  };
}

export function waitForBrowserClose(
  browser: BrowserSession["browser"],
): Promise<void> {
  return new Promise((resolve) => {
    browser.once("disconnected", () => resolve());
  });
}
