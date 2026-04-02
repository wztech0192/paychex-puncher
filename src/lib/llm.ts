import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  supportedTelegramActions,
  type SupportedTelegramActionLabel,
} from "../constants.js";
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
        monday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
        tuesday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
        wednesday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
        thursday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
        friday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
        saturday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
        sunday: z.object({ clockIn: z.string().regex(/^\d{2}:\d{2}$/).nullable(), clockOut: z.string().regex(/^\d{2}:\d{2}$/).nullable() }),
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
      "You are a Telegram assistant for Paychex actions.",
      `Today's date is ${options.todayText}.`,
      `Today is ${options.currentEasternWeekday} in America/New_York.`,
      `All schedule times are in America/New_York. Today in Eastern time is ${options.currentEasternDate} (${options.currentEasternWeekday}).`,
      "Decide whether the user is requesting one of these exact actions:",
      "- 打卡上班",
      "- 打卡下班",
      "- 打卡测试",
      "You can also update the scheduling config when the user asks to change work days, work times, or skip specific dates.",
      "The scheduler also has an enabled flag. The user can ask to turn the scheduler on or off.",
      "The scheduler also has notifyMinutesBefore for early notification and testMode which makes both scheduled clockIn and clockOut run the test action instead.",
      "For schedule updates, set kind=schedule_update and return the full updated scheduleConfig.",
      "If the user asks about the schedule, answer using the current schedule config.",
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
