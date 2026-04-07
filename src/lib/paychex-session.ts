import type { Page } from "puppeteer-core";
import { logger } from "./logger.js";

const paychexOrigins = ["https://myapps.paychex.com"] as const;

export async function clearPaychexSessionState(page: Page): Promise<void> {
  logger.info(
    { origins: paychexOrigins },
    "Clearing Paychex session cookies and sessionStorage",
  );

  const client = await page.createCDPSession();

  try {
    const { cookies } = await client.send("Network.getCookies", {
      urls: [...paychexOrigins],
    });

    const sessionCookies = cookies.filter(
      (cookie) => cookie.session || cookie.expires === -1,
    );

    for (const cookie of sessionCookies) {
      await client.send("Network.deleteCookies", {
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        partitionKey: cookie.partitionKey,
      });
    }

    for (const origin of paychexOrigins) {
      await client.send("DOMStorage.clear", {
        storageId: {
          securityOrigin: origin,
          isLocalStorage: false,
        },
      });
    }

    logger.info(
      { clearedSessionCookieCount: sessionCookies.length },
      "Finished clearing Paychex transient session state",
    );
  } finally {
    await client.detach().catch(() => undefined);
  }
}
