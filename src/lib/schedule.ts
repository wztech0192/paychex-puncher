import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PunchAction } from "../constants.js";
import type {
  ScheduleConfig,
  ScheduleDay,
  ScheduleRunState,
} from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scheduleConfigPath = path.resolve(
  __dirname,
  "../../.schedule-config.json",
);
const scheduleRunStatePath = path.resolve(
  __dirname,
  "../../.schedule-run-state.json",
);

const scheduleDays: ScheduleDay[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const easternTimeZone = "America/New_York";

function defaultDailySchedule() {
  return {
    clockIn: null,
    clockOut: null,
  };
}

function createDefaultScheduleConfig(): ScheduleConfig {
  return {
    enabled: true,
    notifyMinutesBefore: 60,
    testMode: false,
    timezone: "America/New_York",
    weekly: {
      monday: defaultDailySchedule(),
      tuesday: defaultDailySchedule(),
      wednesday: defaultDailySchedule(),
      thursday: defaultDailySchedule(),
      friday: defaultDailySchedule(),
      saturday: defaultDailySchedule(),
      sunday: defaultDailySchedule(),
    },
    skipDates: [],
  };
}

function createDefaultRunState(): ScheduleRunState {
  return {
    lastTriggered: {},
    lastNotified: {},
  };
}

function isTimeString(value: unknown): value is string {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value);
}

function normalizeScheduleConfig(input: unknown): ScheduleConfig {
  const fallback = createDefaultScheduleConfig();

  if (typeof input !== "object" || input === null) {
    return fallback;
  }

  const source = input as Partial<ScheduleConfig>;
  const weekly = {} as ScheduleConfig["weekly"];

  for (const day of scheduleDays) {
    const daily = source.weekly?.[day];
    weekly[day] = {
      clockIn: isTimeString(daily?.clockIn) ? daily.clockIn : null,
      clockOut: isTimeString(daily?.clockOut) ? daily.clockOut : null,
    };
  }

  const skipDates = Array.isArray(source.skipDates)
    ? source.skipDates.filter(
        (value): value is string =>
          typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
      )
    : [];

  return {
    enabled: source.enabled !== false,
    notifyMinutesBefore:
      typeof source.notifyMinutesBefore === "number" &&
      Number.isInteger(source.notifyMinutesBefore) &&
      source.notifyMinutesBefore >= 0 &&
      source.notifyMinutesBefore <= 1440
        ? source.notifyMinutesBefore
        : 10,
    testMode: source.testMode === true,
    timezone: "America/New_York",
    weekly,
    skipDates: Array.from(new Set(skipDates)).sort(),
  };
}

function getEasternParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: easternTimeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    weekday: get("weekday").toLowerCase() as ScheduleDay,
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

export function prunePastSkipDates(config: ScheduleConfig): ScheduleConfig {
  const today = getEasternParts().date;

  return {
    ...config,
    skipDates: config.skipDates.filter((date) => date >= today),
  };
}

export function loadScheduleConfig(): ScheduleConfig {
  const fallback = createDefaultScheduleConfig();

  if (!fs.existsSync(scheduleConfigPath)) {
    return fallback;
  }

  try {
    const raw = fs.readFileSync(scheduleConfigPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return prunePastSkipDates(normalizeScheduleConfig(parsed));
  } catch {
    return fallback;
  }
}

export function saveScheduleConfig(config: ScheduleConfig): ScheduleConfig {
  const normalized = prunePastSkipDates(normalizeScheduleConfig(config));
  fs.writeFileSync(
    scheduleConfigPath,
    JSON.stringify(normalized, null, 2),
    "utf8",
  );
  return normalized;
}

export function formatScheduleConfig(config: ScheduleConfig): string {
  const lines = [
    `Enabled: ${config.enabled ? "on" : "off"}`,
    `Notify Minutes Before: ${config.notifyMinutesBefore}`,
    `Test Mode: ${config.testMode ? "on" : "off"}`,
    `Timezone: ${config.timezone}`,
    "Weekly schedule:",
  ];

  for (const day of scheduleDays) {
    const daily = config.weekly[day];
    lines.push(
      `- ${day}: clockIn=${daily.clockIn ?? "off"}, clockOut=${daily.clockOut ?? "off"}`,
    );
  }

  lines.push(
    `Skip dates: ${config.skipDates.length > 0 ? config.skipDates.join(", ") : "none"}`,
  );

  return lines.join("\n");
}

export function getScheduleConfigPath(): string {
  return scheduleConfigPath;
}

export function getScheduleRunStatePath(): string {
  return scheduleRunStatePath;
}

export function loadScheduleRunState(): ScheduleRunState {
  if (!fs.existsSync(scheduleRunStatePath)) {
    return createDefaultRunState();
  }

  try {
    const raw = fs.readFileSync(scheduleRunStatePath, "utf8");
    const parsed = JSON.parse(raw) as ScheduleRunState;
    return {
      lastTriggered:
        typeof parsed.lastTriggered === "object" && parsed.lastTriggered
          ? parsed.lastTriggered
          : {},
      lastNotified:
        typeof parsed.lastNotified === "object" && parsed.lastNotified
          ? parsed.lastNotified
          : {},
    };
  } catch {
    return createDefaultRunState();
  }
}

export function saveScheduleRunState(state: ScheduleRunState): void {
  fs.writeFileSync(
    scheduleRunStatePath,
    JSON.stringify(state, null, 2),
    "utf8",
  );
}

export function getCurrentEasternDateTime(date = new Date()) {
  return getEasternParts(date);
}

export function shouldTriggerScheduledAction(
  config: ScheduleConfig,
  runState: ScheduleRunState,
  action: Extract<PunchAction, "clockIn" | "clockOut">,
  date = new Date(),
): { shouldRun: boolean; dateKey: string; reason?: string } {
  const eastern = getCurrentEasternDateTime(date);
  const daily = config.weekly[eastern.weekday];
  const scheduledTime = daily[action];
  const dateKey =
    `${eastern.date}:${action}` as `${string}:${"clockIn" | "clockOut"}`;

  if (!config.enabled) {
    return { shouldRun: false, dateKey, reason: "scheduler-disabled" };
  }

  if (config.skipDates.includes(eastern.date)) {
    return { shouldRun: false, dateKey, reason: "skip-date" };
  }

  if (!scheduledTime) {
    return { shouldRun: false, dateKey, reason: "no-time-configured" };
  }

  if (scheduledTime !== eastern.time) {
    return { shouldRun: false, dateKey, reason: "time-not-matched" };
  }

  if (runState.lastTriggered[dateKey] === eastern.time) {
    return { shouldRun: false, dateKey, reason: "already-triggered" };
  }

  return { shouldRun: true, dateKey };
}

function subtractMinutes(time: string, minutes: number): string | null {
  const [hourPart, minutePart] = time.split(":").map(Number);

  if (
    !Number.isInteger(hourPart) ||
    !Number.isInteger(minutePart) ||
    minutes < 0 ||
    minutes > 1440
  ) {
    return null;
  }

  const totalMinutes = hourPart * 60 + minutePart - minutes;

  if (totalMinutes < 0) {
    return null;
  }

  const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minute = String(totalMinutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function shouldSendScheduleNotification(
  config: ScheduleConfig,
  runState: ScheduleRunState,
  action: Extract<PunchAction, "clockIn" | "clockOut">,
  date = new Date(),
): {
  shouldNotify: boolean;
  dateKey: string;
  scheduledTime?: string;
  reason?: string;
} {
  const eastern = getCurrentEasternDateTime(date);
  const daily = config.weekly[eastern.weekday];
  const scheduledTime = daily[action];
  const dateKey =
    `${eastern.date}:${action}` as `${string}:${"clockIn" | "clockOut"}`;

  if (!config.enabled) {
    return { shouldNotify: false, dateKey, reason: "scheduler-disabled" };
  }

  if (config.skipDates.includes(eastern.date)) {
    return { shouldNotify: false, dateKey, reason: "skip-date" };
  }

  if (!scheduledTime) {
    return { shouldNotify: false, dateKey, reason: "no-time-configured" };
  }

  if (config.notifyMinutesBefore <= 0) {
    return { shouldNotify: false, dateKey, reason: "notification-disabled" };
  }

  const notifyTime = subtractMinutes(scheduledTime, config.notifyMinutesBefore);

  if (!notifyTime) {
    return {
      shouldNotify: false,
      dateKey,
      reason: "notification-time-invalid",
    };
  }

  if (notifyTime !== eastern.time) {
    return { shouldNotify: false, dateKey, reason: "time-not-matched" };
  }

  if (runState.lastNotified[dateKey] === eastern.time) {
    return { shouldNotify: false, dateKey, reason: "already-notified" };
  }

  return { shouldNotify: true, dateKey, scheduledTime };
}

export function markScheduledActionTriggered(
  runState: ScheduleRunState,
  dateKey: string,
  time: string,
): ScheduleRunState {
  return {
    lastTriggered: {
      ...runState.lastTriggered,
      [dateKey]: time,
    },
    lastNotified: runState.lastNotified,
  };
}

export function markScheduledActionNotified(
  runState: ScheduleRunState,
  dateKey: string,
  time: string,
): ScheduleRunState {
  return {
    ...runState,
    lastNotified: {
      ...runState.lastNotified,
      [dateKey]: time,
    },
  };
}
