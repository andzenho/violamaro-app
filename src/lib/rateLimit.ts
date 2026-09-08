/* Простейшая защита /api/lead от заливки заявок скриптом с одного адреса.
   Счётчик живёт в памяти процесса — как cooldown выгрузки в track.ts: он
   не переживёт холодный старт функции и не общий на все её копии, но и
   цель скромная — срезать очевидный поток с одного IP, а не построить
   точный распределённый лимитер. Что этот счётчик пропустит (адрес сменился
   или процесс перезапустился), не страшно: это защита от заливки, не от
   единичного дубля. */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;

// Верхняя граница на всякий случай: если адресов накопится слишком много
// (процесс живёт долго под большим потоком), чистим устаревшие записи,
// чтобы карта не росла бесконечно.
const MAX_TRACKED = 5000;

interface Bucket {
  count: number;
  resetAt: number;
}

const hits = new Map<string, Bucket>();

function sweep(now: number): void {
  for (const [ip, bucket] of hits) {
    if (now > bucket.resetAt) hits.delete(ip);
  }
}

/* true — лимит превышен, запрос нужно отклонить. */
export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > MAX_TRACKED) sweep(now);

  const bucket = hits.get(ip);
  if (!bucket || now > bucket.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_PER_WINDOW;
}

export function clientIp(request: Request): string {
  // На Vercel это ставит сама платформа; локально и за другими прокси
  // может не быть вовсе — тогда лимитируем всех под одним ведром "unknown",
  // это хуже, чем адресный лимит, но не хуже, чем никакого.
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
