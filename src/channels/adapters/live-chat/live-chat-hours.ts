export interface LiveChatHours {
  enabled: boolean;
  /** IANA name, e.g. "Europe/London". */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "HH:MM", 24h, in the timezone above. `end` is exclusive and must be after `start`. */
  start: string;
  end: string;
}

export const DEFAULT_HOURS: LiveChatHours = {
  enabled: false,
  timezone: 'UTC',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00',
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Throws an Error with a user-facing message; the adapter wraps it into a 400. */
export function parseHours(input: {
  enabled?: unknown;
  timezone?: unknown;
  days?: unknown;
  start?: unknown;
  end?: unknown;
}): LiveChatHours {
  const enabled = input.enabled === true || input.enabled === 'true';
  const timezone =
    typeof input.timezone === 'string' && input.timezone.trim()
      ? input.timezone.trim()
      : DEFAULT_HOURS.timezone;
  if (!isValidTimezone(timezone)) {
    throw new Error(`"${timezone}" is not a valid time zone`);
  }

  const rawDays = Array.isArray(input.days)
    ? input.days
    : typeof input.days === 'string'
      ? input.days.split(',').filter((d) => d.trim() !== '') // "" means "no days", not "default"
      : DEFAULT_HOURS.days;
  const days = [...new Set(rawDays.map((d) => Number(d)))].sort();
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error('Days must be numbers from 0 (Sunday) to 6 (Saturday)');
  }
  if (enabled && days.length === 0) {
    throw new Error('Pick at least one day for your opening hours');
  }

  const start =
    typeof input.start === 'string' && input.start
      ? input.start
      : DEFAULT_HOURS.start;
  const end =
    typeof input.end === 'string' && input.end ? input.end : DEFAULT_HOURS.end;
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
    throw new Error('Opening and closing times must look like 09:00');
  }
  if (minutes(end) <= minutes(start)) {
    throw new Error('Closing time must be later than opening time');
  }
  return { enabled, timezone, days, start, end };
}

/** Always true when hours are not configured: a widget with no schedule is "always online". */
export function isWithinHours(
  hours: LiveChatHours | undefined,
  now: Date = new Date(),
): boolean {
  if (!hours?.enabled) return true;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: hours.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    get('weekday'),
  );
  const current = Number(get('hour')) * 60 + Number(get('minute'));
  return (
    hours.days.includes(day) &&
    current >= minutes(hours.start) &&
    current < minutes(hours.end)
  );
}
