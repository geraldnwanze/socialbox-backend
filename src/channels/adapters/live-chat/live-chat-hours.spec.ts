import { isWithinHours, parseHours } from './live-chat-hours';

const hours = parseHours({
  enabled: true,
  timezone: 'America/New_York',
  days: '1,2,3,4,5',
  start: '09:00',
  end: '17:00',
});

describe('isWithinHours', () => {
  it('is always online when no schedule is configured', () => {
    expect(isWithinHours(undefined)).toBe(true);
    expect(
      isWithinHours(
        { ...hours, enabled: false },
        new Date('2026-10-24T03:00:00Z'),
      ),
    ).toBe(true);
  });

  it('uses the workspace time zone, not the server or visitor zone', () => {
    // Wed 2026-10-21 14:00 UTC = 10:00 in New York (EDT) -> open; 22:00 UTC = 18:00 -> closed.
    expect(isWithinHours(hours, new Date('2026-10-21T14:00:00Z'))).toBe(true);
    expect(isWithinHours(hours, new Date('2026-10-21T22:00:00Z'))).toBe(false);
  });

  it('treats the opening minute as open and the closing minute as closed', () => {
    expect(isWithinHours(hours, new Date('2026-10-21T13:00:00Z'))).toBe(true); // 09:00 EDT
    expect(isWithinHours(hours, new Date('2026-10-21T20:59:00Z'))).toBe(true); // 16:59
    expect(isWithinHours(hours, new Date('2026-10-21T21:00:00Z'))).toBe(false); // 17:00
  });

  it('is closed on days that are not selected', () => {
    expect(isWithinHours(hours, new Date('2026-10-24T15:00:00Z'))).toBe(false); // Saturday
  });

  it('follows daylight-saving changes', () => {
    // After clocks go back (2026-11-01) 14:00 UTC is 09:00 EST: still the opening minute.
    expect(isWithinHours(hours, new Date('2026-11-02T14:00:00Z'))).toBe(true);
    expect(isWithinHours(hours, new Date('2026-11-02T13:59:00Z'))).toBe(false);
  });
});

describe('parseHours', () => {
  it('applies defaults and accepts comma separated days', () => {
    expect(parseHours({})).toEqual({
      enabled: false,
      timezone: 'UTC',
      days: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '17:00',
    });
    expect(parseHours({ days: '6,0' }).days).toEqual([0, 6]);
  });

  it('rejects bad input with readable messages', () => {
    expect(() => parseHours({ timezone: 'Mars/Base' })).toThrow(
      'not a valid time zone',
    );
    expect(() => parseHours({ start: '9am' })).toThrow('09:00');
    expect(() => parseHours({ start: '17:00', end: '09:00' })).toThrow(
      'later than',
    );
    expect(() => parseHours({ days: '9' })).toThrow('0 (Sunday)');
    expect(() => parseHours({ enabled: true, days: [] })).toThrow(
      'at least one day',
    );
  });
});
