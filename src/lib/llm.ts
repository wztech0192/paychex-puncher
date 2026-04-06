import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  supportedTelegramActions,
  type SupportedTelegramActionLabel,
} from "../constants.js";
import type { PunchAction } from "../constants.js";
import type { ScheduleConfig, TelegramIntent } from "../types.js";
import { z } from "zod";

function isSupportedActionLabel(
  value: string,
): value is SupportedTelegramActionLabel {
  return value in supportedTelegramActions;
}

const telegramIntentSchema = z.object({
  kind: z.enum(["action", "reply", "schedule_update"]),
  actionLabel: z
    .enum(["打卡上班", "打卡下班", "打卡测试"])
    .nullable()
    .describe("Set only when kind is action."),
  scheduleConfig: z
    .object({
      enabled: z.boolean(),
      notifyMinutesBefore: z.number().int().min(0).max(1440),
      testMode: z.boolean(),
      timezone: z.literal("America/New_York"),
      weekly: z.object({
        monday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
        tuesday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
        wednesday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
        thursday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
        friday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
        saturday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
        sunday: z.object({
          clockIn: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
          clockOut: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .nullable(),
        }),
      }),
      skipDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    })
    .nullable()
    .describe("Set only when kind is schedule_update."),
  response: z.string().min(1).max(600).describe("Short Telegram reply text."),
});

export async function analyzeTelegramMessage(options: {
  apiKey: string;
  model: string;
  input: string;
  scheduleConfig: ScheduleConfig;
  todayText: string;
  currentEasternDate: string;
  currentEasternWeekday: string;
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
      "You are a Telegram assistant for Paychex actions. Your name is 琦琦打卡小助手.",
      `Today's date is ${options.todayText}.`,
      `Today is ${options.currentEasternWeekday} in America/New_York.`,
      `All schedule times are in America/New_York. Today in Eastern time is ${options.currentEasternDate} (${options.currentEasternWeekday}).`,
      "Supported direct commands are:",
      "- 指令: list all commands",
      "- config: show raw schedule config",
      "- 打开测试模式: enable test mode",
      "- 关闭测试模式: disable test mode",
      "- 打开自动: enable scheduler",
      "- 关闭自动: disable scheduler",
      "Decide whether the user is requesting one of these exact actions:",
      "- 打卡上班",
      "- 打卡下班",
      "- 打卡测试",
      "You can also update the scheduling config when the user asks to change work days, work times, or skip specific dates.",
      "The scheduler has notifyMinutesBefore for early notification.",
      "The scheduler has enabled and testMode fields, but those are controlled only by direct commands, not by you.",
      "Never change enabled or testMode in schedule_update output. Preserve their current values exactly.",
      "For schedule updates, set kind=schedule_update and return the full updated scheduleConfig.",
      "If the user asks about the schedule or about any command, answer using the current schedule config and the command definitions above.",
      "Skip dates are one-off YYYY-MM-DD dates in Eastern time.",
      "Remove any skipDates that are before today.",
      "If the user clearly requests one of those actions, set kind=action and set actionLabel to the matching phrase.",
      "If kind is reply, set actionLabel to null and scheduleConfig to null.",
      "If kind is action, set scheduleConfig to null.",
      "Always provide a concise response message in Chinese.",
      `Current schedule config:\n${JSON.stringify(options.scheduleConfig)}`,
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

  if (output.kind === "schedule_update" && output.scheduleConfig) {
    return {
      kind: "schedule_update",
      response: output.response,
      scheduleConfig: output.scheduleConfig,
    };
  }

  return {
    kind: "reply",
    response: output.response || "我暂时无法处理这条消息。",
  };
}

export async function generateFunnyPunchLine(options: {
  apiKey: string;
  model: string;
  action: Extract<PunchAction, "clockIn" | "clockOut">;
}): Promise<string> {
  const openai = createOpenAI({
    apiKey: options.apiKey,
  });

  const actionTopic =
    options.action === "clockIn" ? "牛马打卡上班" : "牛马打卡下班";

  const { text } = await generateText({
    model: openai(options.model),
    providerOptions: {
      openai: {
        reasoningEffort: "minimal",
      },
    },
    system: [
      "You write short funny Chinese one-liners for Telegram.",
      `The topic is ${actionTopic}.`,
      `Do not include ${actionTopic} in the output.`,
      "Use a playful, witty tone, also inspired by Chinese internet humor. Inspire creativity and humor in a concise manner.",
      "Keep it to exactly one sentence.",
      "Keep it under 40 Chinese characters when possible.",
      "Output only the sentence itself.",
    ].join(" "),
    prompt:
      options.action === "clockIn"
        ? "写一句关于牛马打卡上班的随机搞笑句子。"
        : "写一句关于牛马打卡下班的随机搞笑句子。",
  });

  return text.trim();
}
