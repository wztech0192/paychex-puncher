import { resolveConfig } from "./lib/env.js";
import { actionLabels } from "./constants.js";
import { runApp } from "./app.js";
import { generateFunnyPunchLine } from "./lib/llm.js";
import { logger } from "./lib/logger.js";
import { installProcessErrorHandlers, sleep } from "./lib/runtime.js";
import { sendMessageToTelegram } from "./lib/telegram.js";
import {
  formatScheduleConfig,
  getCurrentEasternDateTime,
  getScheduleConfigPath,
  getScheduleRunStatePath,
  loadScheduleConfig,
  loadScheduleRunState,
  markScheduledActionAttempted,
  markScheduledActionNotified,
  markScheduledActionTriggered,
  saveScheduleConfig,
  saveScheduleRunState,
  shouldSendScheduleNotification,
  shouldTriggerScheduledAction,
} from "./lib/schedule.js";

const pollIntervalMinMs = 30_000;
const pollIntervalMaxMs = 50_000;
const schedulerErrorBackoffMs = 15_000;

function getRandomPollIntervalMs(): number {
  return (
    pollIntervalMinMs +
    Math.floor(Math.random() * (pollIntervalMaxMs - pollIntervalMinMs + 1))
  );
}

async function tick(): Promise<void> {
  const config = resolveConfig({ isHeadless: true, runtime: "local" });
  const scheduleConfig = saveScheduleConfig(loadScheduleConfig());
  let runState = loadScheduleRunState();
  const eastern = getCurrentEasternDateTime();

  logger.debug(
    {
      nowDate: eastern.date,
      nowTime: eastern.time,
      weekday: eastern.weekday,
    },
    "Scheduler tick",
  );

  for (const action of ["clockIn", "clockOut"] as const) {
    const notifyDecision = shouldSendScheduleNotification(
      scheduleConfig,
      runState,
      action,
    );

    if (
      notifyDecision.shouldNotify &&
      config.telegramBotToken &&
      config.telegramChatId
    ) {
      try {
        logger.info(
          {
            action,
            dateKey: notifyDecision.dateKey,
            scheduledTime: notifyDecision.scheduledTime,
            notifyMinutesBefore: scheduleConfig.notifyMinutesBefore,
          },
          "Sending early schedule notification",
        );
        await sendMessageToTelegram(config.telegramBotToken, {
          chatId: config.telegramChatId,
          text: `琦琦打卡小助手提醒：${scheduleConfig.notifyMinutesBefore} 分钟后将自动执行 ${actionLabels[action]}，计划时间 ${notifyDecision.scheduledTime}（美东时间）${scheduleConfig.testMode ? "，当前为测试模式，将执行打卡测试" : ""}。`,
        });
        runState = markScheduledActionNotified(
          runState,
          notifyDecision.dateKey,
          eastern.time,
        );
        saveScheduleRunState(runState);
      } catch (error) {
        logger.error(
          { err: error, action, dateKey: notifyDecision.dateKey },
          "Failed to send early schedule notification",
        );
      }
    } else {
      logger.debug(
        {
          action,
          reason: notifyDecision.reason,
          dateKey: notifyDecision.dateKey,
          telegramReady: Boolean(
            config.telegramBotToken && config.telegramChatId,
          ),
        },
        "Skipping early schedule notification",
      );
    }

    const decision = shouldTriggerScheduledAction(
      scheduleConfig,
      runState,
      action,
    );

    if (!decision.shouldRun) {
      logger.debug(
        { action, reason: decision.reason },
        "Skipping scheduled action",
      );
      continue;
    }

    try {
      logger.info(
        { action, dateKey: decision.dateKey },
        "Triggering scheduled action",
      );
      runState = markScheduledActionAttempted(
        runState,
        decision.dateKey,
        eastern.time,
      );
      saveScheduleRunState(runState);

      if (
        config.telegramBotToken &&
        config.telegramChatId &&
        config.openAiApiKey
      ) {
        try {
          const funnyLine = await generateFunnyPunchLine({
            apiKey: config.openAiApiKey,
            model: config.openAiModel,
            action,
          });

          logger.info(
            { action, dateKey: decision.dateKey, funnyLine },
            "Sending funny pre-punch Telegram message",
          );

          await sendMessageToTelegram(config.telegramBotToken, {
            chatId: config.telegramChatId,
            text: funnyLine,
          });
        } catch (error) {
          logger.error(
            { err: error, action, dateKey: decision.dateKey },
            "Failed to send funny pre-punch Telegram message",
          );
        }
      }

      await runApp({
        ...config,
        paychexAction: scheduleConfig.testMode ? "test" : action,
      });

      runState = markScheduledActionTriggered(
        runState,
        decision.dateKey,
        eastern.time,
      );
      saveScheduleRunState(runState);
    } catch (error) {
      logger.error(
        { err: error, action, dateKey: decision.dateKey },
        "Scheduled action failed; scheduler will continue running",
      );
    }
  }
}

export async function runScheduler(options?: {
  loadEnv?: boolean;
  installErrorHandlers?: boolean;
}): Promise<void> {
  if (options?.installErrorHandlers !== false) {
    installProcessErrorHandlers("scheduler");
  }

  const scheduleConfig = saveScheduleConfig(loadScheduleConfig());

  logger.info(
    {
      scheduleConfigPath: getScheduleConfigPath(),
      scheduleRunStatePath: getScheduleRunStatePath(),
      summary: formatScheduleConfig(scheduleConfig),
    },
    "Scheduler started",
  );

  while (true) {
    try {
      await tick();
      const nextPollInMs = getRandomPollIntervalMs();
      logger.debug({ nextPollInMs }, "Scheduler sleeping before next tick");
      await sleep(nextPollInMs);
    } catch (error) {
      logger.error(
        { err: error, backoffMs: schedulerErrorBackoffMs },
        "Scheduler loop failed; retrying after backoff",
      );
      await sleep(schedulerErrorBackoffMs);
    }
  }
}

function isDirectSchedulerEntry(): boolean {
  return (
    process.argv[1]?.endsWith("scheduler.ts") ||
    process.argv[1]?.endsWith("scheduler.js")
  );
}

if (isDirectSchedulerEntry()) {
  runScheduler().catch((error) => {
    logger.fatal({ err: error }, "Scheduler failed during startup");
  });
}
