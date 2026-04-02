# Paychex Puncher

This project now uses TypeScript modules with a shared Puppeteer core that can run locally or inside AWS Lambda.
Local runs use `pino` with `pino-pretty` for readable step-by-step logs.

## What gets persisted

When you run locally, Chrome keeps its normal profile data in `.chrome-profile/`, including:

- Cookies
- `localStorage`
- `sessionStorage`
- Other Chrome profile data tied to the session

That profile directory is intentionally ignored by git. In AWS Lambda, browser state is ephemeral.

## Install

```bash
npm install
npm run build
```

## Local Usage

Use the interactive local runner:

```bash
npm run dev
```

Trigger a specific action directly:

```bash
npm run dev:clockin
npm run dev:clockout
npm run dev:test
```

For headless local execution:

```bash
npm run dev:headless
```

Or run the compiled output:

```bash
npm run start:headless
```

Run the Telegram bot listener only:

```bash
npm run dev:bot
```

The local Telegram listener only processes messages in the `Punch` group chat that explicitly mention the bot.

## Lambda Usage

Build output is written to `dist/`. The Lambda handler entry is `dist/lambda.js` and exports `handler`.
The Telegram webhook Lambda entry is `dist/telegram-bot.js` and exports `telegramWebhookHandler`.

Required Lambda environment variables:

- `PAYCHEX_USERNAME`
- `PAYCHEX_PASSWORD`
- `PAYCHEX_ACTION`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_BOT_USERNAME`
- `OPENAI_API_KEY`

Optional local-only variables in `.env.local`:

- `CHROME_PATH`
- `TELEGRAM_GROUP_TITLE`
- `OPENAI_MODEL`

Telegram webhook behavior:

- Responds only when the bot is explicitly mentioned, such as `@WZ01192_BOT summarize this`.
- Rejects prompts longer than 200 characters.
- Uses the Vercel AI SDK with the OpenAI provider to analyze and answer the message.
- Supported action phrases:
- `打卡上班` -> triggers `runPaychexFlow` with `punchSelectors.clockIn`
- `打卡下班` -> triggers `runPaychexFlow` with `punchSelectors.clockOut`
- `打卡测试` -> triggers `runPaychexFlow` with `punchSelectors.moreOptions`

## Structure

- `src/index.ts`: local CLI entry
- `src/lambda.ts`: AWS Lambda handler
- `src/telegram-bot.ts`: Telegram webhook handler and local long-poll listener
- `src/app.ts`: shared application orchestration
- `src/flow/paychex.ts`: Paychex login and punch flow
- `src/lib/browser.ts`: local Chrome and Lambda Chromium launch logic
- `src/lib/telegram.ts`: Telegram image delivery
