import { actionLabels } from "./constants.js";
import { runApp } from "./app.js";
import { loadLocalEnv, resolveConfig } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { sendMessageToTelegram } from "./lib/telegram.js";
import {
  formatScheduleConfig,
  getCurrentEasternDateTime,
  getScheduleConfigPath,
  getScheduleRunStatePath,
  loadScheduleConfig,
  loadScheduleRunState,
  markScheduledActionNotified,
  markScheduledActionTriggered,
  saveScheduleConfig,
  saveScheduleRunState,
  shouldSendScheduleNotification,
  shouldTriggerScheduledAction,
} from "./lib/schedule.js";

const pollIntervalMs = 30_000;

async function tick(): Promise<void> {
  const config = resolveConfig({ isHeadless: false, runtime: "local" });
  const scheduleConfig = saveScheduleConfig(loadScheduleConfig());
  let runState = loadScheduleRunState();
  const eastern = getCurrentEasternDateTime();

  logger.info(
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
        text: `提醒：${scheduleConfig.notifyMinutesBefore} 分钟后将自动执行 ${actionLabels[action]}，计划时间 ${notifyDecision.scheduledTime}（美东时间）${scheduleConfig.testMode ? "，当前为测试模式，将执行打卡测试" : ""}。`,
      });
      runState = markScheduledActionNotified(
        runState,
        notifyDecision.dateKey,
        eastern.time,
      );
      saveScheduleRunState(runState);
    }

    const decision = shouldTriggerScheduledAction(
      scheduleConfig,
      runState,
      action,
    );

    if (!decision.shouldRun) {
      logger.debug({ action, reason: decision.reason }, "Skipping scheduled action");
      continue;
    }

    logger.info({ action, dateKey: decision.dateKey }, "Triggering scheduled action");
    await runApp({
      ...config,
      paychexAction: scheduleConfig.testMode ? "test" : action,
    });

    runState = markScheduledActionTriggered(runState, decision.dateKey, eastern.time);
    saveScheduleRunState(runState);
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
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
    await tick();
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

main().catch((error) => {
  logger.error({ err: error }, "Scheduler crashed");
  process.exit(1);
});
