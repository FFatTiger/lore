function getTimeZonePart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value || '';
}

export function getDailyScheduleSlot(now: Date, timeZone: string): { slotKey: string; date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const year = getTimeZonePart(parts, 'year');
  const month = getTimeZonePart(parts, 'month');
  const day = getTimeZonePart(parts, 'day');
  const hour = Number(getTimeZonePart(parts, 'hour'));
  const date = `${year}-${month}-${day}`;
  return { slotKey: `daily:${date}`, date, hour };
}

export function shouldRunDailySchedule(
  now: Date,
  timeZone: string,
  scheduleHour: number,
): { due: boolean; slotKey: string; date: string; hour: number } {
  const slot = getDailyScheduleSlot(now, timeZone);
  return { ...slot, due: slot.hour === scheduleHour };
}
