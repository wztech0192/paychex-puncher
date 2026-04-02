import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stateFilePath = path.resolve(
  __dirname,
  "../../.telegram-listener-state.json",
);

type ListenerState = {
  lastUpdateId: number;
};

function isValidState(value: unknown): value is ListenerState {
  return (
    typeof value === "object" &&
    value !== null &&
    "lastUpdateId" in value &&
    typeof (value as { lastUpdateId: unknown }).lastUpdateId === "number"
  );
}

export function loadLastTelegramUpdateId(): number | undefined {
  if (!fs.existsSync(stateFilePath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!isValidState(parsed)) {
      return undefined;
    }

    return parsed.lastUpdateId;
  } catch {
    return undefined;
  }
}

export function saveLastTelegramUpdateId(updateId: number): void {
  const payload: ListenerState = {
    lastUpdateId: updateId,
  };

  fs.writeFileSync(stateFilePath, JSON.stringify(payload, null, 2), "utf8");
}

export function getTelegramListenerStatePath(): string {
  return stateFilePath;
}
