import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  supportedTelegramActions,
  type SupportedTelegramActionLabel,
} from "../constants.js";
import type { TelegramIntent } from "../types.js";
import { z } from "zod";

function isSupportedActionLabel(
  value: string,
): value is SupportedTelegramActionLabel {
  return value in supportedTelegramActions;
}

const telegramIntentSchema = z.object({
  kind: z.enum(["action", "reply"]),
  actionLabel: z
    .enum(["打卡上班", "打卡下班", "打卡测试"])
    .nullable()
    .describe("Set only when kind is action."),
  response: z.string().min(1).max(600).describe("Short Telegram reply text."),
});

export async function analyzeTelegramMessage(options: {
  apiKey: string;
  model: string;
  input: string;
}): Promise<TelegramIntent> {
  const openai = createOpenAI({
    apiKey: options.apiKey,
  });

  const { output } = await generateText({
    model: openai(options.model),
    providerOptions: {
      openai: {
        reasoningEffort: "minimal",
      },
    },
    output: Output.object({
      schema: telegramIntentSchema,
    }),
    system: [
      "You are a Telegram assistant for Paychex actions.",
      "Decide whether the user is requesting one of these exact actions:",
      "- 打卡上班",
      "- 打卡下班",
      "- 打卡测试",
      "If the user clearly requests one of those actions, set kind=action and set actionLabel to the matching phrase.",
      "Otherwise set kind=reply and set actionLabel to null.",
      "Always provide a concise response message in Chinese.",
    ].join(" "),
    prompt: options.input,
  });

  if (output.kind === "action" && output.actionLabel) {
    if (!isSupportedActionLabel(output.actionLabel)) {
      return {
        kind: "reply",
        response: output.response || "我暂时无法处理这条消息。",
      };
    }

    return {
      kind: "action",
      actionLabel: output.actionLabel,
      response: output.response,
    };
  }

  return {
    kind: "reply",
    response: output.response || "我暂时无法处理这条消息。",
  };
}
