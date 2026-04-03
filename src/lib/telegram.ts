import type {
  LastTelegramMessageResult,
  TelegramGetUpdatesResult,
  TelegramPhotoRequest,
  TelegramSendMessageRequest,
  TelegramMessage,
  TelegramUpdate,
} from "../types.js";
import {
  loadLastTelegramUpdateId,
  saveLastTelegramUpdateId,
} from "./listener-state.js";
import { logger } from "./logger.js";

type TelegramResponse = {
  ok: boolean;
  description?: string;
  result?: unknown;
};

async function telegramRequest(
  token: string,
  method: string,
  payload: BodyInit,
  isMultipart = false,
): Promise<unknown> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      body: payload,
      headers: isMultipart ? undefined : { "content-type": "application/json" },
    },
  );

  const data = (await response.json()) as TelegramResponse;

  if (!response.ok || !data.ok) {
    throw new Error(data.description || `Telegram ${method} failed.`);
  }

  return data.result;
}

export async function sendMessageToTelegram(
  token: string,
  request: TelegramSendMessageRequest,
): Promise<void> {
  await telegramRequest(
    token,
    "sendMessage",
    JSON.stringify({
      chat_id: request.chatId,
      text: request.text,
      reply_to_message_id: request.replyToMessageId,
    }),
  );
}

export async function getTelegramUpdates(
  token: string,
  offset?: number,
  timeout = 30,
): Promise<TelegramUpdate[]> {
  const params = new URLSearchParams();

  if (typeof offset === "number") {
    params.set("offset", String(offset));
  }

  params.set("timeout", String(timeout));

  const response = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?${params.toString()}`,
  );
  const data = (await response.json()) as TelegramGetUpdatesResult;
  if (!response.ok || !data.ok) {
    throw new Error("Telegram getUpdates failed.", { cause: data });
  }

  return data.result;
}

function getIncomingMessage(
  update: TelegramUpdate,
): TelegramMessage | undefined {
  return update.message ?? update.edited_message;
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

function isPunchGroupMessage(
  message: TelegramMessage,
  groupTitle: string,
  chatId?: string,
): boolean {
  if (chatId && String(message.chat.id) === chatId) {
    return true;
  }

  return message.chat.title === groupTitle;
}

function isFreshEnough(
  message: TelegramMessage,
  maxAgeSeconds: number,
): boolean {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return nowInSeconds - message.date <= maxAgeSeconds;
}

export async function getLastTelegramMessage(options: {
  token: string;
  groupTitle: string;
  chatId?: string;
  botUsername?: string;
  timeout?: number;
  maxAgeSeconds?: number;
}): Promise<LastTelegramMessageResult | null> {
  const lastUpdateId = loadLastTelegramUpdateId();
  const offset =
    typeof lastUpdateId === "number" ? lastUpdateId + 1 : undefined;
  const updates = await getTelegramUpdates(
    options.token,
    offset,
    options.timeout ?? 30,
  );

  logger.debug(
    {
      count: updates.length,
      lastUpdateId,
    },
    "Received Telegram updates batch",
  );

  let lastAccepted: LastTelegramMessageResult | null = null;

  for (const update of updates) {
    saveLastTelegramUpdateId(update.update_id);
    const message = getIncomingMessage(update);

    if (!message) {
      continue;
    }

    if (!isPunchGroupMessage(message, options.groupTitle, options.chatId)) {
      logger.debug(
        {
          updateId: update.update_id,
          chatId: message.chat.id,
          chatTitle: message.chat.title,
          messageId: message.message_id,
        },
        "Skipping message outside Punch group",
      );
      continue;
    }

    if (!messageMentionsBot(message, options.botUsername)) {
      logger.debug(
        {
          updateId: update.update_id,
          chatId: message.chat.id,
          messageId: message.message_id,
        },
        "Skipping Punch group message without bot mention",
      );
      continue;
    }

    if (!isFreshEnough(message, options.maxAgeSeconds ?? 10)) {
      logger.debug(
        {
          updateId: update.update_id,
          chatId: message.chat.id,
          messageId: message.message_id,
          messageAgeSeconds: Math.floor(Date.now() / 1000) - message.date,
        },
        "Skipping stale Punch group message",
      );
      continue;
    }

    lastAccepted = {
      update,
      message,
    };
  }

  return lastAccepted;
}

export async function sendPhotoToTelegram(
  token: string,
  chatId: string,
  request: TelegramPhotoRequest,
): Promise<void> {
  const formData = new FormData();
  const photoBuffer = Buffer.from(request.photoBuffer);

  formData.append("chat_id", chatId);
  formData.append("caption", request.caption || "");
  formData.append("photo", new Blob([photoBuffer]), request.filename);

  await telegramRequest(token, "sendPhoto", formData, true);
}
