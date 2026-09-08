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
import {
  cleanupRequests,
  eventRequests,
  EMPAT_WIDTHS,
  KOLESO_WIDTHS,
  leadRequests,
  PE_LEAD_WIDTHS,
  PREDZAPIS_LEAD_WIDTHS,
  resizeRequest,
  testRequests,
} from "@/lib/export/layout";
import {
  buildRows,
  EMPAT_HEADER,
  EVENT_HEADER,
  KOLESO_HEADER,
  PE_LEAD_HEADER,
  PREDZAPIS_LEAD_HEADER,
} from "@/lib/export/rows";

const PREDZAPIS_SHEET = "Анкета предзаписи";
const PE_SHEET = "Заявки на ПЭ";
const EMPAT_SHEET = "Тест: Эмпат ли вы";
const KOLESO_SHEET = "Тест: Колесо эмпата";
const EVENTS_SHEET = "События";

// Порядок листов — как в задании: анкета предзаписи, заявки на ПЭ, оба
// теста, события. Он же используется и при создании недостающих листов.
const ALL_SHEETS = [PREDZAPIS_SHEET, PE_SHEET, EMPAT_SHEET, KOLESO_SHEET, EVENTS_SHEET];

const HEADER_BY_TITLE: Record<string, string[]> = {
  [PREDZAPIS_SHEET]: PREDZAPIS_LEAD_HEADER,
  [PE_SHEET]: PE_LEAD_HEADER,
  [EMPAT_SHEET]: EMPAT_HEADER,
  [KOLESO_SHEET]: KOLESO_HEADER,
  [EVENTS_SHEET]: EVENT_HEADER,
};

/* Лист «Заявки» — старое имя листа с анкетами предзаписи, до того, как их
   разделили на два вида. Он больше не наш: не трогаем, не удаляем, не
   пишем в него, и в проверку «чужие ли данные» не включаем вовсе — иначе
   собственные же старые заявки, оставшиеся под старым именем, блокировали
   бы каждую выгрузку. */
const OLD_LEADS_SHEET = "Заявки";

/* Пустая таблица, только что созданная в Google, приходит с одним листом со
   стандартным именем. Его переименовываем, а не заводим шестой: листов
   должно остаться ровно пять. */
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
  const titles = sheets.map((s) => s.properties.title).filter((title) => title !== OLD_LEADS_SHEET);
  if (titles.length === 0) return;

  const probe = await valuesBatchGet(
    spreadsheetId,
    titles.map((title) => `${quoteTitle(title)}!${PROBE_RANGE}`)
  );

  const foreign: string[] = [];

  titles.forEach((title, index) => {
    const rows = probe.valueRanges?.[index]?.values as unknown[][] | undefined;
    if (isBlank(rows)) return;

    const header = HEADER_BY_TITLE[title];
    if (header && sameHeader(rows, header)) return;

    foreign.push(title);
  });

  if (foreign.length > 0) throw new ForeignDataError(foreign);
}

/* Создаём недостающие листы. Если своё имя носит стандартный пустой лист —
   переименовываем его: удалить последний лист таблица не даст, а лишний
   пустой «Лист1» рядом с нашими никому не нужен. */
function structureRequests(sheets: Sheet[]): unknown[] {
  const existing = new Set(sheets.map((s) => s.properties.title));
  const requests: unknown[] = [];
  const spare = sheets.filter((s) => DEFAULT_TITLES.has(s.properties.title));

  for (const title of ALL_SHEETS) {
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
  predzapisLeads: number;
  peLeads: number;
  empat: number;
  koleso: number;
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
  const predzapisSheet = find(sheets, PREDZAPIS_SHEET);
  const peSheet = find(sheets, PE_SHEET);
  const empatSheet = find(sheets, EMPAT_SHEET);
  const kolesoSheet = find(sheets, KOLESO_SHEET);
  const eventsSheet = find(sheets, EVENTS_SHEET);

  /* Полная перезапись: сначала стираем всё, потом пишем заново. Иначе
     строки прошлой выгрузки, оказавшиеся ниже новых данных, остались бы
     висеть — и это была бы не старая копия, а вторая, противоречащая
     первой. */
  await valuesBatchClear(spreadsheetId, ALL_SHEETS.map(quoteTitle));

  const cleanup = (sheet: Sheet) =>
    cleanupRequests(sheet.properties.sheetId, sheet.conditionalFormats?.length ?? 0, Boolean(sheet.basicFilter));

  await batchUpdate(spreadsheetId, [
    ...cleanup(predzapisSheet),
    ...cleanup(peSheet),
    ...cleanup(empatSheet),
    ...cleanup(kolesoSheet),
    ...cleanup(eventsSheet),
    resizeRequest(predzapisSheet.properties.sheetId, rows.predzapisLeads.length, PREDZAPIS_LEAD_HEADER.length),
    resizeRequest(peSheet.properties.sheetId, rows.peLeads.length, PE_LEAD_HEADER.length),
    resizeRequest(empatSheet.properties.sheetId, rows.empat.length, EMPAT_HEADER.length),
    resizeRequest(kolesoSheet.properties.sheetId, rows.koleso.length, KOLESO_HEADER.length),
    resizeRequest(eventsSheet.properties.sheetId, rows.events.length, EVENT_HEADER.length),
  ]);

  await valuesBatchUpdate(spreadsheetId, [
    { range: `${quoteTitle(PREDZAPIS_SHEET)}!A1`, values: [PREDZAPIS_LEAD_HEADER, ...rows.predzapisLeads] },
    { range: `${quoteTitle(PE_SHEET)}!A1`, values: [PE_LEAD_HEADER, ...rows.peLeads] },
    { range: `${quoteTitle(EMPAT_SHEET)}!A1`, values: [EMPAT_HEADER, ...rows.empat] },
    { range: `${quoteTitle(KOLESO_SHEET)}!A1`, values: [KOLESO_HEADER, ...rows.koleso] },
    { range: `${quoteTitle(EVENTS_SHEET)}!A1`, values: [EVENT_HEADER, ...rows.events] },
  ]);

  await batchUpdate(spreadsheetId, [
    ...leadRequests(predzapisSheet.properties.sheetId, rows.predzapisLeads.length, PREDZAPIS_LEAD_HEADER.length, PREDZAPIS_LEAD_WIDTHS),
    ...leadRequests(peSheet.properties.sheetId, rows.peLeads.length, PE_LEAD_HEADER.length, PE_LEAD_WIDTHS),
    ...testRequests(empatSheet.properties.sheetId, rows.empat.length, EMPAT_HEADER.length, EMPAT_WIDTHS),
    ...testRequests(kolesoSheet.properties.sheetId, rows.koleso.length, KOLESO_HEADER.length, KOLESO_WIDTHS),
    ...eventRequests(eventsSheet.properties.sheetId, rows.events.length, EVENT_HEADER.length),
  ]);

  return {
    predzapisLeads: rows.predzapisLeads.length,
    peLeads: rows.peLeads.length,
    empat: rows.empat.length,
    koleso: rows.koleso.length,
    events: rows.events.length,
    people: rows.peopleCount,
  };
}
