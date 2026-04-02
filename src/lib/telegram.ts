import type {
  TelegramGetUpdatesResult,
  TelegramPhotoRequest,
  TelegramSendMessageRequest,
  TelegramUpdate,
} from "../types.js";

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
    throw new Error("Telegram getUpdates failed.");
  }

  return data.result;
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
