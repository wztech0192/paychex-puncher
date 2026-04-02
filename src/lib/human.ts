import type { Page } from "puppeteer-core";

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function pause(_page: Page, min = 120, max = 420): Promise<void> {
  await sleep(randomBetween(min, max));
}

export async function moveMouseLikeHuman(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const steps = randomBetween(18, 36);
  await page.mouse.move(x, y, { steps });
  await pause(page, 60, 180);
}

export async function clickLikeHuman(
  page: Page,
  selector: string,
): Promise<void> {
  const element = await page.waitForSelector(selector, { visible: true });
  const box = await element?.boundingBox();

  if (!box) {
    throw new Error(`Element ${selector} is not clickable.`);
  }

  const targetX = box.x + box.width / 2 + randomBetween(-4, 4);
  const targetY = box.y + box.height / 2 + randomBetween(-3, 3);

  await moveMouseLikeHuman(page, targetX, targetY);
  await page.mouse.down();
  await pause(page, 40, 90);
  await page.mouse.up();
  await pause(page, 150, 320);
}

export async function focusAndTypeLikeHuman(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  const element = await page.waitForSelector(selector, { visible: true });
  const box = await element?.boundingBox();

  if (!box || !element) {
    throw new Error(`Element ${selector} is not focusable.`);
  }

  const targetX = box.x + box.width / 2 + randomBetween(-5, 5);
  const targetY = box.y + box.height / 2 + randomBetween(-4, 4);

  await moveMouseLikeHuman(page, targetX, targetY);
  await page.mouse.down();
  await pause(page, 35, 80);
  await page.mouse.up();
  await pause(page, 100, 220);

  await element.focus();
  await pause(page, 120, 240);

  for (const character of text) {
    await page.keyboard.type(character, { delay: randomBetween(90, 220) });
    await pause(page, 20, 80);
  }

  await pause(page, 180, 320);
}

async function hoverKnownActions(page: Page): Promise<boolean> {
  const selectors = [
    'button[type="submit"]',
    "button",
    'a[href*="login"]',
    'input[type="email"]',
    'input[type="text"]',
  ];

  for (const selector of selectors) {
    const handle = await page.$(selector);
    const box = await handle?.boundingBox();

    if (!box) {
      continue;
    }

    const x = box.x + box.width / 2 + randomBetween(-6, 6);
    const y = box.y + box.height / 2 + randomBetween(-4, 4);

    await moveMouseLikeHuman(page, x, y);
    await pause(page, 120, 260);
    return true;
  }

  return false;
}

async function scrollLikeHuman(page: Page): Promise<void> {
  const scrollSteps = randomBetween(2, 5);

  for (let index = 0; index < scrollSteps; index += 1) {
    await page.mouse.wheel({ deltaY: randomBetween(80, 180) });
    await pause(page, 120, 260);
  }

  for (let index = 0; index < scrollSteps; index += 1) {
    await page.mouse.wheel({ deltaY: -randomBetween(80, 160) });
    await pause(page, 120, 260);
  }
}

export async function performHumanWarmup(page: Page): Promise<void> {
  await moveMouseLikeHuman(
    page,
    randomBetween(120, 260),
    randomBetween(120, 260),
  );
  await pause(page, 250, 500);
  await scrollLikeHuman(page);
  await hoverKnownActions(page);
}

