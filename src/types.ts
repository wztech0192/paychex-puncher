import type { Browser, Page } from "puppeteer-core";
import type {
  PunchAction,
  SupportedTelegramActionLabel,
} from "./constants.js";

export interface AppConfig {
  isHeadless: boolean;
  runtime: "local" | "lambda";
  chromePath?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramGroupTitle: string;
  telegramBotUsername?: string;
  openAiApiKey?: string;
  openAiModel: string;
  paychexUsername: string;
  paychexPassword: string;
  paychexAction: PunchAction;
}

export interface BrowserSession {
  browser: Browser;
  page: Page;
  userDataDir?: string;
}

export interface TelegramPhotoRequest {
  photoBuffer: Uint8Array;
  filename: string;
  caption?: string;
}

export interface TelegramSendMessageRequest {
  chatId: string;
  text: string;
  replyToMessageId?: number;
}

export interface TelegramGetUpdatesResult {
  ok: boolean;
  result: TelegramUpdate[];
}

export interface TelegramChat {
  id: number;
  title?: string;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
}

export interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

export type TelegramIntent =
  | {
      kind: "action";
      actionLabel: SupportedTelegramActionLabel;
      response: string;
    }
  | {
      kind: "reply";
      response: string;
    };
