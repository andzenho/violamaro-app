import {
  batchUpdate,
  getSheetId,
  getSpreadsheet,
  quoteTitle,
  valuesBatchClear,
  valuesBatchGet,
  valuesBatchUpdate,
  type Sheet,
} from "@/lib/google";
import { cleanupRequests, eventRequests, leadRequests, resizeRequest } from "@/lib/export/layout";
import { buildRows, EVENT_HEADER, LEAD_HEADER } from "@/lib/export/rows";

const LEADS_SHEET = "Заявки";
const EVENTS_SHEET = "События";

/* Пустая таблица, только что созданная в Google, приходит с одним листом со
   стандартным именем. Его переименовываем, а не заводим третий: листов
   должно остаться ровно два. */
const DEFAULT_TITLES = new Set(["Лист1", "Sheet1", "Sheet 1", "Лист 1"]);

/* Насколько глубоко заглядываем в лист, решая, есть ли на нём данные.
   Полностью читать чужую таблицу ради проверки незачем, а таблица, в
   которой кто-то работает, почти наверняка занята с первых строк. */
const PROBE_RANGE = "A1:Z10";

export class ForeignDataError extends Error {
  constructor(public readonly sheets: string[]) {
    super(
      `в таблице есть чужие данные (${sheets.join(", ")}) — выгрузка остановлена, ` +
        `ничего не перезаписано. Проверьте SHEET_ID; если таблица правильная и ` +
        `содержимое можно затереть, вызовите роут ещё раз с ?force=1`
    );
    this.name = "ForeignDataError";
  }
}

function isBlank(rows: unknown[][] | undefined): boolean {
  if (!rows || rows.length === 0) return true;
  return rows.every((row) => row.every((cell) => String(cell ?? "").trim() === ""));
}

function sameHeader(rows: unknown[][] | undefined, header: string[]): boolean {
  const first = rows?.[0];
  if (!first) return false;
  return header.every((title, i) => String(first[i] ?? "").trim() === title);
}

/* Перед первой записью убеждаемся, что таблица наша. Лист считается своим,
   если он пуст или если в первой строке стоит ровно наша шапка — значит,
   его писала прошлая выгрузка. Всё остальное — чужая работа, и затирать её
   мы не станем: SHEET_ID легко скопировать не от той таблицы, а
   перезапись здесь полная и необратимая. */
async function assertOurs(spreadsheetId: string, sheets: Sheet[]): Promise<void> {
  const titles = sheets.map((s) => s.properties.title);
  if (titles.length === 0) return;

  const probe = await valuesBatchGet(
    spreadsheetId,
    titles.map((title) => `${quoteTitle(title)}!${PROBE_RANGE}`)
  );

  const foreign: string[] = [];

  titles.forEach((title, index) => {
    const rows = probe.valueRanges?.[index]?.values as unknown[][] | undefined;
    if (isBlank(rows)) return;

    if (title === LEADS_SHEET && sameHeader(rows, LEAD_HEADER)) return;
    if (title === EVENTS_SHEET && sameHeader(rows, EVENT_HEADER)) return;

    foreign.push(title);
  });

  if (foreign.length > 0) throw new ForeignDataError(foreign);
}

/* Создаём недостающие листы. Если своё имя носит стандартный пустой лист —
   переименовываем его: удалить последний лист таблица не даст, а лишний
   пустой «Лист1» рядом с двумя нашими никому не нужен. */
function structureRequests(sheets: Sheet[]): unknown[] {
  const existing = new Set(sheets.map((s) => s.properties.title));
  const requests: unknown[] = [];
  const spare = sheets.filter((s) => DEFAULT_TITLES.has(s.properties.title));

  for (const title of [LEADS_SHEET, EVENTS_SHEET]) {
    if (existing.has(title)) continue;

    const reuse = spare.shift();
    if (reuse) {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: reuse.properties.sheetId, title },
          fields: "title",
        },
      });
    } else {
      requests.push({ addSheet: { properties: { title } } });
    }
    existing.add(title);
  }

  return requests;
}

function find(sheets: Sheet[], title: string): Sheet {
  const sheet = sheets.find((s) => s.properties.title === title);
  if (!sheet) throw new Error(`лист «${title}» не найден в таблице после создания`);
  return sheet;
}

export interface ExportResult {
  leads: number;
  events: number;
  people: number;
}

export async function runExport(force: boolean): Promise<ExportResult> {
  const spreadsheetId = getSheetId();

  // Данные собираем до первого обращения к таблице: если база недоступна,
  // лист не должен остаться очищенным.
  const rows = await buildRows();

  const before = await getSpreadsheet(spreadsheetId);
  if (!force) await assertOurs(spreadsheetId, before.sheets);

  const structure = structureRequests(before.sheets);
  if (structure.length > 0) await batchUpdate(spreadsheetId, structure);

  // Перечитываем схему: после создания и переименования нужны свежие
  // sheetId и актуальные списки правил, которые предстоит снять.
  const sheets = (structure.length > 0 ? await getSpreadsheet(spreadsheetId) : before).sheets;
  const leadsSheet = find(sheets, LEADS_SHEET);
  const eventsSheet = find(sheets, EVENTS_SHEET);

  /* Полная перезапись: сначала стираем всё, потом пишем заново. Иначе
     строки прошлой выгрузки, оказавшиеся ниже новых данных, остались бы
     висеть — и это была бы не старая копия, а вторая, противоречащая
     первой. */
  await valuesBatchClear(spreadsheetId, [quoteTitle(LEADS_SHEET), quoteTitle(EVENTS_SHEET)]);

  await batchUpdate(spreadsheetId, [
    ...cleanupRequests(
      leadsSheet.properties.sheetId,
      leadsSheet.conditionalFormats?.length ?? 0,
      Boolean(leadsSheet.basicFilter)
    ),
    ...cleanupRequests(
      eventsSheet.properties.sheetId,
      eventsSheet.conditionalFormats?.length ?? 0,
      Boolean(eventsSheet.basicFilter)
    ),
    resizeRequest(leadsSheet.properties.sheetId, rows.leads.length, LEAD_HEADER.length),
    resizeRequest(eventsSheet.properties.sheetId, rows.events.length, EVENT_HEADER.length),
  ]);

  await valuesBatchUpdate(spreadsheetId, [
    { range: `${quoteTitle(LEADS_SHEET)}!A1`, values: [LEAD_HEADER, ...rows.leads] },
    { range: `${quoteTitle(EVENTS_SHEET)}!A1`, values: [EVENT_HEADER, ...rows.events] },
  ]);

  await batchUpdate(spreadsheetId, [
    ...leadRequests(leadsSheet.properties.sheetId, rows.leads.length, LEAD_HEADER.length),
    ...eventRequests(eventsSheet.properties.sheetId, rows.events.length, EVENT_HEADER.length),
  ]);

  return { leads: rows.leads.length, events: rows.events.length, people: rows.peopleCount };
}
