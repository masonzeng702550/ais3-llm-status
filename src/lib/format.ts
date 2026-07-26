/** Date formatting. Storage is UTC throughout; display is always Taipei time. */
const TZ = 'Asia/Taipei';

const dateTimeFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const monthFmt = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  year: 'numeric',
  month: 'long',
});

export function formatDateTime(value: string | Date): string {
  return dateTimeFmt.format(new Date(value));
}

export function formatDate(value: string | Date): string {
  return dateFmt.format(new Date(value));
}

export function formatMonth(value: string | Date): string {
  return monthFmt.format(new Date(value));
}

/** `YYYY-MM-DD` keys are already UTC calendar days; format without re-shifting. */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split('-');
  return `${y}/${m}/${d}`;
}

export function relativeTime(value: string | Date, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 個月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** How long the current status has held, e.g. "已正常運作 3 天". */
export function durationSince(value: string | Date, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} 分鐘`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時`;
  return `${Math.floor(hours / 24)} 天`;
}
