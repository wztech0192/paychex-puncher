export const PAYCHEX_URL =
  "https://myapps.paychex.com/landing_remote/login.do?lang=en&landingRedirect=true#?mode=employee&app=TAHTML_EMP&clients=001GJICFLZU616VSDEAQ";

export const punchSelectors = {
  clockIn:
    '[data-payxautoid="paychex.app.time.employee.punchwidget.buttons.clockIn"]',
  clockOut:
    '[data-payxautoid="paychex.app.time.employee.punchwidget.buttons.clockOut"]',

  test: '[data-payxautoid="paychex.app.time.employee.punchwidget.footer.moreoptions"]',
} as const;

export type PunchAction = keyof typeof punchSelectors;

export const actionLabels: Record<PunchAction, string> = {
  clockIn: "打卡上班",
  clockOut: "打卡下班",

  test: "打卡测试",
};

export const supportedTelegramActions = {
  打卡上班: "clockIn",
  打卡下班: "clockOut",
  打卡测试: "test",
} as const;

export type SupportedTelegramActionLabel =
  keyof typeof supportedTelegramActions;

const windowsChromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

const linuxChromeCandidates = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
  "/snap/bin/chromium",
];

export const defaultChromeCandidates = [
  process.env.CHROME_PATH,
  ...windowsChromeCandidates,
  ...linuxChromeCandidates,
].filter((value): value is string => Boolean(value));
