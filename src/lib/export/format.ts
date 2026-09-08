import { rankLabel, sphereListLabel, testLabel } from "@/lib/export/labels";

/* Часовой пояс, в котором смотрят таблицу. В базе время лежит в UTC, и без
   явного пояса заявка, оставленная в час ночи по Москве, уезжает в таблице
   на предыдущий день. */
const TIMEZONE = "Europe/Moscow";

// Ноль шкалы дат в Таблицах — 30.12.1899; между ним и 01.01.1970 ровно
// 25569 суток. Из этого и считается серийный номер даты.
const EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/* Дата уходит в таблицу числом, а не строкой. Строку Таблицы считают текстом:
   сортировка идёт по алфавиту, фильтр по датам не предлагает диапазонов.
   Число же с числовым форматом колонки и выглядит как дата, и ведёт себя
   как дата. */
export function toSerial(iso: string): number {
  const parts = partsFormat.formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );

  return asUtc / MS_PER_DAY + EPOCH_OFFSET_DAYS;
}

export function nowSerial(): number {
  return toSerial(new Date().toISOString());
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function percent(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  return /%$/.test(raw) ? raw : `${raw}%`;
}

function duration(value: unknown): string {
  const seconds = Number(text(value));
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} мин ${rest} с` : `${minutes} мин`;
}

type Payload = Record<string, unknown> | null;

/* Поля, которые в «Детали» не попадают никогда. Сырьё для калибровки
   (ответы, шкалы, развилки) — это сотни чисел, читать их человеку незачем.
   Отметки об акценте — юридический след, он остаётся в базе. */
const HIDDEN_FIELDS = new Set([
  "answers",
  "scales",
  "wheel",
  "forks",
  "consent_ts",
  "doc_version_consent",
  "accept_pd",
  "utm_medium",
  "utm_content",
]);

const READY_PREFIX = "готовность: ";

const ANKETA: Record<string, string> = {
  predzapis: "предзапись на практикум",
  sobytie: "событие",
};

const OTKUDA: Record<string, string> = {
  test: "после теста",
  "pryamaya-ssylka": "по прямой ссылке",
};

function leadDetails(payload: Payload): string[] {
  if (!payload) return [];
  const parts: string[] = [];

  const name = text(payload.name);
  const contact = text(payload.contact);
  if (name) parts.push(name);
  if (contact) parts.push(contact);

  const anketa = text(payload.anketa);
  if (anketa) parts.push(ANKETA[anketa] ?? anketa);

  const otkuda = text(payload.otkuda);
  if (otkuda) parts.push(OTKUDA[otkuda] ?? otkuda);

  const ready = text(payload.ready);
  if (ready) parts.push(READY_PREFIX + ready);

  if (text(payload.accept_ads)) parts.push("согласие на рассылку");

  return parts;
}

function testDoneDetails(test: string | null, payload: Payload): string[] {
  if (!payload) return [];
  const parts: string[] = [];

  if (test === "koleso") {
    const out = percent(payload.otdayu);
    const inn = percent(payload.ostaetsya);
    if (out) parts.push(`отдаю ${out}`);
    if (inn) parts.push(`остаётся ${inn}`);
    const worst = sphereListLabel(text(payload.worst));
    if (worst) parts.push(`проседает: ${worst}`);
  } else {
    const rank = rankLabel(text(payload.rank));
    if (rank) parts.push(rank);
    const pct = percent(payload.percent);
    if (pct) parts.push(pct);
  }

  const spent = duration(payload.seconds);
  if (spent) parts.push(spent);

  /* Две метки честности прохождения. Их ставит сам тест: «быстро» — 24
     вопроса меньше чем за 25 секунд, читать человек физически не успевал;
     «однообразно» — на все вопросы одна и та же кнопка. Руководителю по ним
     сразу видно, что за результатом ничего нет. */
  if (payload.fast === true) parts.push("быстро");
  if (payload.monotone === true) parts.push("однообразно");

  return parts;
}

/* Событие могло прийти и от внешнего сервиса через /api/event с любым
   payload, какого мы не предусмотрели. Показать «—» здесь нельзя: данные в
   базе есть, а в таблице их не видно. Поэтому берём простые поля как есть,
   складные в строку, и ограничиваем их число — колонка должна остаться
   строкой, а не абзацем. */
function genericDetails(payload: Payload): string[] {
  if (!payload) return [];
  const parts: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (HIDDEN_FIELDS.has(key)) continue;
    const shown = text(value);
    if (!shown) continue;
    parts.push(`${key}: ${shown.slice(0, 80)}`);
    if (parts.length >= 6) break;
  }

  return parts;
}

// Ячейка «Детали»: одна строка, части через « · », без сырого JSON.
export function detailsLine(type: string, test: string | null, payload: Payload): string {
  let parts: string[];

  if (type === "lead") parts = leadDetails(payload);
  else if (type === "test_done") parts = testDoneDetails(test, payload);
  else parts = genericDetails(payload);

  return parts.filter(Boolean).join(" · ").slice(0, 900);
}

/* Колонки «Результат» и «Процент» на листе «Заявки». Тесты устроены
   по-разному: у «Эмпата» есть готовый ранг и процент эмпатии, у «Колеса»
   ни того, ни другого — там результат складывается из проседающих сфер, а
   процентом идёт доля, которая остаётся человеку на себя. */
export function testOutcome(test: string | null, payload: Payload): { result: string; percent: string } {
  if (!payload) return { result: "", percent: "" };

  if (test === "koleso") {
    const worst = sphereListLabel(text(payload.worst));
    return {
      result: worst ? `Проседает: ${worst}` : testLabel(test),
      percent: percent(payload.ostaetsya),
    };
  }

  return { result: rankLabel(text(payload.rank)), percent: percent(payload.percent) };
}
