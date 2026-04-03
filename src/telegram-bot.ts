import { parseBooleanEnv, resolveConfig } from "./lib/env.js";
import type { APIGatewayProxyResultV2, Handler } from "aws-lambda";
import { supportedTelegramActions } from "./constants.js";
import { runApp } from "./app.js";
import { analyzeTelegramMessage, generateFunnyPunchLine } from "./lib/llm.js";
import { logger } from "./lib/logger.js";
import { installProcessErrorHandlers, sleep } from "./lib/runtime.js";
import { runScheduler } from "./scheduler.js";
import {
  getLastTelegramMessage,
  sendMessageToTelegram,
} from "./lib/telegram.js";
import { getTelegramListenerStatePath } from "./lib/listener-state.js";
import {
  formatScheduleConfig,
  getCurrentEasternDateTime,
  getScheduleConfigPath,
  loadScheduleConfig,
  saveScheduleConfig,
} from "./lib/schedule.js";
import type { TelegramMessage, TelegramUpdate } from "./types.js";

const MAX_INPUT_LENGTH = 200;
const MAX_MESSAGE_AGE_SECONDS = 3;
const listenerErrorBackoffMs = 5_000;

function previewText(text: string, maxLength = 80): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getIncomingMessage(
  update: TelegramUpdate,
): TelegramMessage | undefined {
  return update.message ?? update.edited_message;
}

function isFreshMessage(message: TelegramMessage): boolean {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return nowInSeconds - message.date <= MAX_MESSAGE_AGE_SECONDS;
}

function messageMentionsBot(
  message: TelegramMessage,
  botUsername?: string,
): boolean {
  if (process.env.MUST_MENTION_BOT !== "true") {
    return true;
  }

  if (!botUsername || !message.text) {
    return false;
  }

  const normalizedUsername = botUsername.replace(/^@/, "").toLowerCase();
  const entities = message.entities ?? [];

  return entities.some((entity) => {
    if (entity.type !== "mention") {
      return false;
    }

    const mentionText = message.text?.slice(
      entity.offset,
      entity.offset + entity.length,
    );

    return mentionText?.replace(/^@/, "").toLowerCase() === normalizedUsername;
  });
}

function stripBotMention(text: string, botUsername?: string): string {
  if (!botUsername) {
    return text.trim();
  }

  const escaped = botUsername
    .replace(/^@/, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentionPattern = new RegExp(`@${escaped}\\b`, "ig");
  return text.replace(mentionPattern, "").trim();
}

function tooLongMessage(text: string): string {
  return `Please keep your message under ${MAX_INPUT_LENGTH} characters. Current length: ${text.length}.`;
}

function isConfigCommand(text: string): boolean {
  return text.trim().toLowerCase() === "config";
}

function isHelpCommand(text: string): boolean {
  return text.trim() === "指令";
}

function buildCommandsHelpText(): string {
  return [
    "可用指令：",
    "1. 指令",
    "   显示所有可用指令。",
    "2. config",
    "   显示原始 .schedule-config.json 配置。",
    "3. 打开测试模式",
    "   打开测试模式。自动排程触发时，打卡上班/下班都会改为执行测试动作。",
    "4. 关闭测试模式",
    "   关闭测试模式。",
    "5. 打开自动",
    "   打开自动排程。",
    "6. 关闭自动",
    "   关闭自动排程。",
    "7. 打卡上班",
    "   立即执行上班打卡。",
    "8. 打卡下班",
    "   立即执行下班打卡。",
    "9. 打卡测试",
    "   立即执行测试动作。",
    "10. 自然语言排程修改",
    "   例如：把周一到周五上班改成 09:00，下班改成 18:00。",
    "11. 自然语言跳过日期",
    "   例如：跳过 2026-04-10 和 2026-04-11。",
    "12. 自然语言排程查询",
    "   例如：现在的自动排程是什么？提前几分钟提醒？",
  ].join("\n");
}

function getDirectScheduleToggleCommand(
  text: string,
): "enable-test" | "disable-test" | "enable-auto" | "disable-auto" | null {
  const normalized = text.trim();

  if (normalized === "打开测试模式") {
    return "enable-test";
  }

  if (normalized === "关闭测试模式") {
    return "disable-test";
  }

  if (normalized === "打开自动") {
    return "enable-auto";
  }

  if (normalized === "关闭自动") {
    return "disable-auto";
  }

  return null;
}

export async function processTelegramUpdate(
  update: TelegramUpdate,
  config = resolveConfig({ isHeadless: true, runtime: "lambda" }),
): Promise<void> {
  const message = getIncomingMessage(update);

  if (!message?.text || !config.telegramBotToken) {
    logger.debug(
      { updateId: update.update_id, hasText: Boolean(message?.text) },
      "Skipping Telegram update without text or bot token",
    );
    return;
  }

  logger.info(
    {
      updateId: update.update_id,
      chatId: message.chat.id,
      chatTitle: message.chat.title,
      chatType: message.chat.type,
      messageId: message.message_id,
      messageAgeSeconds: Math.floor(Date.now() / 1000) - message.date,
      textPreview: previewText(message.text),
    },
    "Received Telegram message",
  );

  if (!isFreshMessage(message)) {
    logger.info(
      {
        updateId: update.update_id,
        chatId: message.chat.id,
        messageId: message.message_id,
        messageDate: message.date,
        messageAgeSeconds: Math.floor(Date.now() / 1000) - message.date,
      },
      "Skipping stale Telegram message older than 3 seconds",
    );
    return;
  }

  if (!messageMentionsBot(message, config.telegramBotUsername)) {
    logger.debug(
      {
        updateId: update.update_id,
        chatId: message.chat.id,
        messageId: message.message_id,
        textPreview: previewText(message.text),
      },
      "Skipping Telegram message without bot mention",
    );
    return;
  }

  const prompt = stripBotMention(message.text, config.telegramBotUsername);
  logger.info(
    {
      chatId: message.chat.id,
      chatTitle: message.chat.title,
      messageId: message.message_id,
      promptLength: prompt.length,
      promptPreview: previewText(prompt),
    },
    "Processing Telegram mention",
  );

  if (isConfigCommand(prompt)) {
    const scheduleConfig = saveScheduleConfig(loadScheduleConfig());

    logger.info(
      {
        chatId: message.chat.id,
        messageId: message.message_id,
        scheduleConfigPath: getScheduleConfigPath(),
      },
      "Sending raw schedule config",
    );

    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: formatScheduleConfig(scheduleConfig),
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (isHelpCommand(prompt)) {
    logger.info(
      {
        chatId: message.chat.id,
        messageId: message.message_id,
      },
      "Sending command help text",
    );

    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: buildCommandsHelpText(),
      replyToMessageId: message.message_id,
    });
    return;
  }

  const directCommand = getDirectScheduleToggleCommand(prompt);

  if (directCommand) {
    const scheduleConfig = saveScheduleConfig(loadScheduleConfig());

    if (directCommand === "enable-test") {
      scheduleConfig.testMode = true;
    } else if (directCommand === "disable-test") {
      scheduleConfig.testMode = false;
    } else if (directCommand === "enable-auto") {
      scheduleConfig.enabled = true;
    } else if (directCommand === "disable-auto") {
      scheduleConfig.enabled = false;
    }

    const savedConfig = saveScheduleConfig(scheduleConfig);
    const commandReplyMap: Record<typeof directCommand, string> = {
      "enable-test": "已打开测试模式。",
      "disable-test": "已关闭测试模式。",
      "enable-auto": "已打开自动。",
      "disable-auto": "已关闭自动。",
    };

    logger.info(
      {
        chatId: message.chat.id,
        messageId: message.message_id,
        directCommand,
        enabled: savedConfig.enabled,
        testMode: savedConfig.testMode,
      },
      "Applied direct schedule toggle command",
    );

    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: `${commandReplyMap[directCommand]}}`,
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (!prompt) {
    logger.info(
      { chatId: message.chat.id, messageId: message.message_id },
      "Telegram mention had no prompt content",
    );
    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: "Mention me with a question or instruction after the @.",
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (prompt.length > MAX_INPUT_LENGTH) {
    logger.info(
      {
        chatId: message.chat.id,
        messageId: message.message_id,
        promptLength: prompt.length,
      },
      "Telegram prompt exceeded max length",
    );
    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: tooLongMessage(prompt),
      replyToMessageId: message.message_id,
    });
    return;
  }

  if (!config.openAiApiKey) {
    logger.warn(
      { chatId: message.chat.id, messageId: message.message_id },
      "OPENAI_API_KEY missing for Telegram interaction",
    );
    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: "OPENAI_API_KEY is not configured.",
      replyToMessageId: message.message_id,
    });
    return;
  }

  let intent;
  const scheduleConfig = saveScheduleConfig(loadScheduleConfig());
  const eastern = getCurrentEasternDateTime();

  try {
    intent = await analyzeTelegramMessage({
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
      input: prompt,
      scheduleConfig,
      todayText: `${eastern.date} ${eastern.weekday} America/New_York`,
      currentEasternDate: eastern.date,
      currentEasternWeekday: eastern.weekday,
    });
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown LLM error";

    logger.error(
      {
        err: error,
        chatId: message.chat.id,
        messageId: message.message_id,
      },
      "LLM analysis failed",
    );

    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: `LLM 处理失败: ${messageText}`,
      replyToMessageId: message.message_id,
    });

    throw error;
  }
  logger.info(
    {
      chatId: message.chat.id,
      messageId: message.message_id,
      intentKind: intent.kind,
      actionLabel: intent.kind === "action" ? intent.actionLabel : null,
      responsePreview: previewText(intent.response),
    },
    "LLM intent analyzed",
  );

  if (intent.kind === "action") {
    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: `开始执行: ${intent.actionLabel}`,
      replyToMessageId: message.message_id,
    });

    logger.info(
      {
        action: supportedTelegramActions[intent.actionLabel],
        actionLabel: intent.actionLabel,
        chatId: message.chat.id,
        messageId: message.message_id,
      },
      "Triggering Paychex flow from Telegram action",
    );
    await runApp({
      ...config,
      telegramChatId: String(message.chat.id),
      paychexAction: supportedTelegramActions[intent.actionLabel],
    });
    return;
  }

  if (intent.kind === "schedule_update") {
    const mergedConfig = {
      ...intent.scheduleConfig,
      enabled: scheduleConfig.enabled,
      testMode: scheduleConfig.testMode,
    };
    const savedConfig = saveScheduleConfig(mergedConfig);
    logger.info(
      { summary: formatScheduleConfig(savedConfig) },
      "Saved updated schedule config",
    );
    await sendMessageToTelegram(config.telegramBotToken, {
      chatId: String(message.chat.id),
      text: intent.response,
      replyToMessageId: message.message_id,
    });
    return;
  }

  logger.info(
    {
      chatId: message.chat.id,
      messageId: message.message_id,
      responsePreview: previewText(intent.response),
    },
    "Sending Telegram text reply",
  );
  await sendMessageToTelegram(config.telegramBotToken, {
    chatId: String(message.chat.id),
    text: intent.response || "I couldn't generate a response.",
    replyToMessageId: message.message_id,
  });
}

export const telegramWebhookHandler: Handler = async (
  event,
): Promise<APIGatewayProxyResultV2> => {
  try {
    logger.info("Received Telegram webhook request");
    const rawBody =
      typeof event === "object" && event && "body" in event ? event.body : null;
    const isBase64Encoded =
      typeof event === "object" &&
      event &&
      "isBase64Encoded" in event &&
      Boolean(event.isBase64Encoded);

    if (!rawBody) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Missing request body." }),
      };
    }

    const body =
      typeof rawBody === "string"
        ? isBase64Encoded
          ? Buffer.from(rawBody, "base64").toString("utf8")
          : rawBody
        : String(rawBody);
    const update = JSON.parse(body) as TelegramUpdate;
    await processTelegramUpdate(update);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (error) {
    logger.error({ err: error }, "Telegram webhook handler failed");
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

export async function runTelegramListener(): Promise<void> {
  installProcessErrorHandlers("telegram-listener");
  const config = resolveConfig({
    isHeadless: parseBooleanEnv("TELEGRAM_LISTENER_HEADLESS", false),
    runtime: "local",
  });

  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  logger.info(
    {
      groupTitle: config.telegramGroupTitle,
      chatId: config.telegramChatId,
      botUsername: config.telegramBotUsername,
      statePath: getTelegramListenerStatePath(),
    },
    "Telegram bot listener started",
  );

  void runScheduler({
    loadEnv: false,
    installErrorHandlers: false,
  }).catch((error) => {
    logger.error({ err: error }, "Embedded scheduler failed during startup");
  });

  while (true) {
    try {
      const lastMessage = await getLastTelegramMessage({
        token: config.telegramBotToken,
        groupTitle: config.telegramGroupTitle,
        chatId: config.telegramChatId,
        botUsername: config.telegramBotUsername,
        timeout: 30,
        maxAgeSeconds: 10,
      });

      if (!lastMessage) {
        continue;
      }

      logger.info(
        {
          updateId: lastMessage.update.update_id,
          chatId: lastMessage.message.chat.id,
          chatTitle: lastMessage.message.chat.title,
          messageId: lastMessage.message.message_id,
          textPreview: previewText(lastMessage.message.text || ""),
        },
        "Processing latest Telegram listener update",
      );
      await processTelegramUpdate(lastMessage.update, config);
    } catch (error) {
      logger.error(
        { err: error, backoffMs: listenerErrorBackoffMs },
        "Telegram listener iteration failed; retrying after backoff",
      );
      await sleep(listenerErrorBackoffMs);
    }
  }
}

if (
  process.argv[1]?.endsWith("telegram-bot.ts") ||
  process.argv[1]?.endsWith("telegram-bot.js")
) {
  runTelegramListener().catch((error) => {
    logger.fatal({ err: error }, "Telegram bot listener failed during startup");
  });
}
