import type { APIGatewayProxyResultV2, Handler } from "aws-lambda";
import { supportedTelegramActions } from "./constants.js";
import { runApp } from "./app.js";
import { analyzeTelegramMessage } from "./lib/llm.js";
import { loadLocalEnv, resolveConfig } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import {
  getTelegramUpdates,
  sendMessageToTelegram,
} from "./lib/telegram.js";
import {
  getTelegramListenerStatePath,
  loadLastTelegramUpdateId,
  saveLastTelegramUpdateId,
} from "./lib/listener-state.js";
import type { TelegramMessage, TelegramUpdate } from "./types.js";

const MAX_INPUT_LENGTH = 200;
const MAX_MESSAGE_AGE_SECONDS = 3;

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

function isPunchGroupMessage(
  update: TelegramUpdate,
  groupTitle: string,
  chatId?: string,
): boolean {
  const message = getIncomingMessage(update);

  if (!message) {
    return false;
  }

  if (chatId && String(message.chat.id) === chatId) {
    return true;
  }

  return message.chat.title === groupTitle;
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

  try {
    intent = await analyzeTelegramMessage({
      apiKey: config.openAiApiKey,
      model: config.openAiModel,
      input: prompt,
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
      text: intent.response,
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
  loadLocalEnv();
  const config = resolveConfig({ isHeadless: false, runtime: "local" });

  if (!config.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }

  const lastUpdateId = loadLastTelegramUpdateId();
  let offset = typeof lastUpdateId === "number" ? lastUpdateId + 1 : undefined;

  logger.info(
    {
      groupTitle: config.telegramGroupTitle,
      chatId: config.telegramChatId,
      botUsername: config.telegramBotUsername,
      lastUpdateId,
      statePath: getTelegramListenerStatePath(),
    },
    "Telegram bot listener started",
  );

  while (true) {
    const updates = await getTelegramUpdates(config.telegramBotToken, offset, 30);
    logger.debug({ count: updates.length }, "Received Telegram updates batch");

    for (const update of updates) {
      offset = update.update_id + 1;
      saveLastTelegramUpdateId(update.update_id);
      const message = getIncomingMessage(update);

      if (!message) {
        continue;
      }

      if (
        !isPunchGroupMessage(
          update,
          config.telegramGroupTitle,
          config.telegramChatId,
        )
      ) {
        logger.debug(
          {
            chatId: message.chat.id,
            chatTitle: message.chat.title,
            messageId: message.message_id,
          },
          "Skipping message outside Punch group",
        );
        continue;
      }

      if (!messageMentionsBot(message, config.telegramBotUsername)) {
        logger.debug(
          {
            chatId: message.chat.id,
            messageId: message.message_id,
          },
          "Skipping Punch group message without bot mention",
        );
        continue;
      }

      logger.info(
        {
          updateId: update.update_id,
          chatId: message.chat.id,
          chatTitle: message.chat.title,
          messageId: message.message_id,
          textPreview: previewText(message.text || ""),
        },
        "Processing Telegram listener update",
      );
      await processTelegramUpdate(update, config);
    }
  }
}

if (process.argv[1]?.endsWith("telegram-bot.ts") || process.argv[1]?.endsWith("telegram-bot.js")) {
  runTelegramListener().catch((error) => {
    logger.error({ err: error }, "Telegram bot listener crashed");
    process.exit(1);
  });
}
