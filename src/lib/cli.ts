import type { PunchAction } from "../constants.js";

const actionAliases: Record<string, PunchAction> = {
  clockin: "clockIn",
  clockout: "clockOut",
  test: "test",
};

export function resolveActionFromArgs(args: string[]): PunchAction | undefined {
  for (const arg of args) {
    const normalized = arg.replace(/^--action=/, "").toLowerCase();

    if (normalized in actionAliases) {
      return actionAliases[normalized];
    }
  }

  return undefined;
}
