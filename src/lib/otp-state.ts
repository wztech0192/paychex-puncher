import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ActiveOtpStateBase = {
  requestId: string;
  chatId?: string;
  createdAt: number;
  expiresAt: number;
};

type PendingOtpState = ActiveOtpStateBase & {
  status: "pending";
};

type SubmittedOtpState = ActiveOtpStateBase & {
  status: "submitted";
  code: string;
  submittedAt: number;
  messageId?: number;
};

type CompletedOtpState = {
  status: "completed" | "cancelled";
  requestId: string;
  completedAt: number;
};

type OtpState = PendingOtpState | SubmittedOtpState | CompletedOtpState;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const otpStateFilePath = path.resolve(__dirname, "../../.telegram-otp-state.json");

function readOtpState(): OtpState | null {
  if (!fs.existsSync(otpStateFilePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(otpStateFilePath, "utf8");
    return JSON.parse(raw) as OtpState;
  } catch {
    return null;
  }
}

function writeOtpState(state: OtpState): void {
  fs.writeFileSync(otpStateFilePath, JSON.stringify(state, null, 2), "utf8");
}

function isActiveOtpState(
  state: OtpState,
): state is PendingOtpState | SubmittedOtpState {
  return state.status === "pending" || state.status === "submitted";
}

function cancelExpiredOtpState(state: PendingOtpState | SubmittedOtpState): void {
  writeOtpState({
    status: "cancelled",
    requestId: state.requestId,
    completedAt: Date.now(),
  });
}

export function createOtpRequest(options: {
  requestId: string;
  chatId?: string;
  timeoutMs: number;
}): void {
  const now = Date.now();
  writeOtpState({
    status: "pending",
    requestId: options.requestId,
    chatId: options.chatId,
    createdAt: now,
    expiresAt: now + options.timeoutMs,
  });
}

export function getPendingOtpRequest(): PendingOtpState | null {
  const state = readOtpState();

  if (!state || !isActiveOtpState(state)) {
    return null;
  }

  if (state.expiresAt <= Date.now()) {
    cancelExpiredOtpState(state);
    return null;
  }

  return state.status === "pending" ? state : null;
}

export function submitOtpCode(options: {
  requestId: string;
  code: string;
  messageId?: number;
}): boolean {
  const state = readOtpState();

  if (!state || state.status !== "pending") {
    return false;
  }

  if (state.requestId !== options.requestId || state.expiresAt <= Date.now()) {
    if (state.requestId === options.requestId && state.expiresAt <= Date.now()) {
      cancelExpiredOtpState(state);
    }
    return false;
  }

  writeOtpState({
    ...state,
    status: "submitted",
    code: options.code,
    submittedAt: Date.now(),
    messageId: options.messageId,
  });

  return true;
}

export function getSubmittedOtpCode(requestId: string): string | null {
  const state = readOtpState();

  if (!state || state.status !== "submitted" || state.requestId !== requestId) {
    return null;
  }

  if (state.expiresAt <= Date.now()) {
    cancelExpiredOtpState(state);
    return null;
  }

  return state.code;
}

export function getSubmittedOtpDetails(requestId: string): {
  code: string;
  messageId?: number;
} | null {
  const state = readOtpState();

  if (!state || state.status !== "submitted" || state.requestId !== requestId) {
    return null;
  }

  if (state.expiresAt <= Date.now()) {
    cancelExpiredOtpState(state);
    return null;
  }

  return {
    code: state.code,
    messageId: state.messageId,
  };
}

export function completeOtpRequest(
  requestId: string,
  status: "completed" | "cancelled",
): void {
  const state = readOtpState();

  if (!state || state.requestId !== requestId) {
    return;
  }

  writeOtpState({
    status,
    requestId,
    completedAt: Date.now(),
  });
}

export function cancelActiveOtpRequest(): void {
  const state = readOtpState();

  if (!state || !isActiveOtpState(state)) {
    return;
  }

  writeOtpState({
    status: "cancelled",
    requestId: state.requestId,
    completedAt: Date.now(),
  });
}

export function getOtpStatePath(): string {
  return otpStateFilePath;
}
