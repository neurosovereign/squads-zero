/**
 * Donation/tip configuration + the frequency cap for the post-execution
 * success line. Everything lives here — components never hardcode the address
 * or the cap rules.
 */

/** App name used in the on-chain memo and donation copy. */
export const APP_NAME = 'Squads V4 Console';

/**
 * The operator's donation address (treasury vault). Env var wins (build-time
 * via webpack DefinePlugin), else the constant below.
 */
const FALLBACK_DONATION_ADDRESS = '6piTAsCPHAEAJoA7ms25QQYCkyKcyqAZwBiK3Vjqm37B';

declare const process: { env?: Record<string, string | undefined> } | undefined;

export const DONATION_ADDRESS: string =
  (typeof process !== 'undefined' && process.env?.DONATION_ADDRESS) || FALLBACK_DONATION_ADDRESS;

/** On-chain memo so tips are greppable. */
export const DONATION_MEMO = `tip via ${APP_NAME}`;

/** Preset donation amounts in SOL. */
export const DONATION_PRESETS = [0.05, 0.25, 1] as const;

// ---------------------------------------------------------------------------
// Frequency cap for the post-execution success line.
//
// Rules (hard requirements):
// - show on the first successful execution,
// - then at most once every 5th successful execution,
// - never more than once per 30 days,
// - a permanent "x" dismiss disables the line entirely.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'donation-nudge-v1';

type NudgeState = {
  /** Total successful executions observed. */
  executions: number;
  /** Execution count at which the line was last shown. */
  lastShownAtExecution: number;
  /** Timestamp (ms) when the line was last shown. */
  lastShownAt: number;
  /** Permanent dismissal via the "x". */
  dismissed: boolean;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const EVERY_NTH_EXECUTION = 5;

function readState(): NudgeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('empty');
    const parsed = JSON.parse(raw) as Partial<NudgeState>;
    return {
      executions: parsed.executions ?? 0,
      lastShownAtExecution: parsed.lastShownAtExecution ?? 0,
      lastShownAt: parsed.lastShownAt ?? 0,
      dismissed: parsed.dismissed ?? false,
    };
  } catch {
    return { executions: 0, lastShownAtExecution: 0, lastShownAt: 0, dismissed: false };
  }
}

function writeState(state: NudgeState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private mode etc. — the line simply stays quiet
  }
}

/**
 * Call once per confirmed successful execution. Returns whether the tip line
 * may be shown for THIS execution and records the impression when it does.
 */
export function recordExecutionAndShouldShowTip(): boolean {
  const state = readState();
  state.executions += 1;
  const show =
    !state.dismissed &&
    (state.lastShownAtExecution === 0 ||
      (state.executions - state.lastShownAtExecution >= EVERY_NTH_EXECUTION &&
        Date.now() - state.lastShownAt >= THIRTY_DAYS_MS));
  if (show) {
    state.lastShownAtExecution = state.executions;
    state.lastShownAt = Date.now();
  }
  writeState(state);
  return show;
}

/** Permanently dismiss the success line (the "x"). */
export function dismissTipLine(): void {
  const state = readState();
  state.dismissed = true;
  writeState(state);
}
