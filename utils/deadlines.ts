import { Order, ProductTemplate } from '../types';

export const LOS_ANGELES_TZ = 'America/Los_Angeles';
export const SHIP_CUTOFF_HOUR = 16;
export const PRINTER_DAY_START_HOUR = 9;
export const PRINTER_NORMAL_DAY_MINUTES = 12 * 60;
export const PRINTER_EXTENDED_DAY_MINUTES = 20 * 60;
export const PRINTER_CHANGEOVER_MINUTES = 10;

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const pad2 = (v: number) => String(v).padStart(2, '0');

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const getZonedParts = (timestamp: number, timeZone: string = LOS_ANGELES_TZ): ZonedParts => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const partMap = Object.fromEntries(parts.map(p => [p.type, p.value]));

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
    weekday: WEEKDAY_MAP[partMap.weekday] ?? 0,
  };
};

export const zonedDateTimeToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string = LOS_ANGELES_TZ
): number => {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessParts = getZonedParts(utcGuess, timeZone);
  const asIfUtc = Date.UTC(
    guessParts.year,
    guessParts.month - 1,
    guessParts.day,
    guessParts.hour,
    guessParts.minute,
    guessParts.second
  );
  const offset = asIfUtc - utcGuess;
  const corrected = utcGuess - offset;

  const verify = getZonedParts(corrected, timeZone);
  if (
    verify.year === year &&
    verify.month === month &&
    verify.day === day &&
    verify.hour === hour &&
    verify.minute === minute &&
    verify.second === second
  ) {
    return corrected;
  }

  const verifyAsIfUtc = Date.UTC(
    verify.year,
    verify.month - 1,
    verify.day,
    verify.hour,
    verify.minute,
    verify.second
  );
  const verifyOffset = verifyAsIfUtc - corrected;
  return corrected - verifyOffset;
};

export const toDayKeyInLA = (timestamp: number): string => {
  const p = getZonedParts(timestamp, LOS_ANGELES_TZ);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};

export const dayKeyToUtc = (dayKey: string, hour: number, minute: number = 0): number => {
  const [y, m, d] = dayKey.split('-').map(Number);
  return zonedDateTimeToUtc(y, m, d, hour, minute, 0, LOS_ANGELES_TZ);
};

export const nextDayKey = (dayKey: string): string => {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
};

export const isWorkingDayKey = (dayKey: string): boolean => {
  const noonTs = dayKeyToUtc(dayKey, 12);
  const weekday = getZonedParts(noonTs, LOS_ANGELES_TZ).weekday;
  return weekday >= 1 && weekday <= 6; // Monday-Saturday
};

export const addWorkingDaysToDeadline = (startTimestamp: number, workdays: number): number => {
  let remaining = Math.max(1, Math.floor(workdays || 1));
  let dayKey = toDayKeyInLA(startTimestamp);

  while (true) {
    if (isWorkingDayKey(dayKey)) {
      remaining -= 1;
      if (remaining === 0) {
        return dayKeyToUtc(dayKey, SHIP_CUTOFF_HOUR, 0);
      }
    }
    dayKey = nextDayKey(dayKey);
  }
};

export const parseDateTimeLocalAsLA = (value: string): number | null => {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, ys, ms, ds, hs, mins] = m;
  return zonedDateTimeToUtc(Number(ys), Number(ms), Number(ds), Number(hs), Number(mins), 0, LOS_ANGELES_TZ);
};

export const parseDateAsLADeadline = (value: string): number | null => {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, ys, ms, ds] = m;
  return zonedDateTimeToUtc(Number(ys), Number(ms), Number(ds), SHIP_CUTOFF_HOUR, 0, 0, LOS_ANGELES_TZ);
};

export const nowInputDateTimeLA = (): string => {
  const p = getZonedParts(Date.now(), LOS_ANGELES_TZ);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
};

export const dateTimeInputFromTimestampLA = (timestamp: number): string => {
  const p = getZonedParts(timestamp, LOS_ANGELES_TZ);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
};

export const dateInputFromTimestampLA = (timestamp: number): string => {
  const p = getZonedParts(timestamp, LOS_ANGELES_TZ);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
};

export const formatDateTimeLA = (timestamp?: number): string => {
  if (!timestamp) return 'No deadline';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: LOS_ANGELES_TZ,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
};

export const computePrintDeadline = (order: Order, template?: ProductTemplate): number | null => {
  if (!order.deadlineAt) return null;
  if (!template) return order.deadlineAt;
  const prepMinutes = (template.assemblyTimeMinutes || 0) + (template.packingTimeMinutes || 0);
  return order.deadlineAt - prepMinutes * 60 * 1000;
};

export const makePlateSignature = (
  plateName: string,
  colors: string[],
  weight: number,
  printTime: number,
  type: string
): string => {
  const safeWeight = Number.isFinite(weight) ? weight : 0;
  const safePrintTime = Number.isFinite(printTime) ? printTime : 0;
  return `${plateName}::${colors.slice().sort().join('-')}::${safeWeight.toFixed(2)}::${safePrintTime.toFixed(1)}::${type || 'UNKNOWN'}`;
};

export const isOrderOverdue = (order: Order): boolean => {
  if (!order.deadlineAt) return false;
  if (order.status === 'SHIPPED' || order.status === 'STORED') return false;
  return Date.now() > order.deadlineAt;
};
