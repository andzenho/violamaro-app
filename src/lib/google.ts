import { JWT } from "google-auth-library";

/* Доступ к таблице идёт от сервисного аккаунта: у него свой почтовый адрес,
   которому таблица выдана в редакторы. Ни OAuth-окна, ни живого человека в
   этой цепочке нет — крону некому нажимать «разрешить». */

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const API = "https://sheets.googleapis.com/v4/spreadsheets";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/* Ключ приходит переменной окружения, и до нас он доезжает в двух видах.
   Обычный JSON — как скачали из консоли Google. Base64 — потому что в
   private_key стоят переносы строк, а поля ввода на хостингах их регулярно
   схлопывают; тогда JSON.parse падает на невалидном ключе, и понять почему
   по сообщению невозможно. Base64 переживает любое поле ввода. */
function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: не разбирается ни как JSON, ни как base64 от JSON");
  }

  const account = parsed as Partial<ServiceAccount>;
  if (!account.client_email || !account.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON: в ключе нет client_email или private_key");
  }

  // Если ключ прошёл через поле, где \n остался двумя символами, вернём перенос.
  return {
    client_email: account.client_email,
    private_key: account.private_key.replace(/\\n/g, "\n"),
  };
}

let client: JWT | undefined;

function getClient(): JWT {
  if (!client) {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("не задана переменная GOOGLE_SERVICE_ACCOUNT_JSON");
    const account = parseServiceAccount(raw);
    client = new JWT({ email: account.client_email, key: account.private_key, scopes: SCOPES });
  }
  return client;
}

export function getSheetId(): string {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("не задана переменная SHEET_ID");
  return id;
}

async function call<T>(url: string, init?: { method: string; body: unknown }): Promise<T> {
  const token = await getClient().getAccessToken();
  if (!token.token) throw new Error("Google не выдал access-токен для сервисного аккаунта");

  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token.token}`,
      ...(init ? { "Content-Type": "application/json" } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    /* Ответ Google на ошибку — JSON с полем error.message, где написано по
       делу: нет доступа, нет листа, слишком длинный диапазон. Достаём именно
       его, иначе в лог уедет «500» без единой подсказки. */
    const body = await response.text();
    let detail = body.slice(0, 500);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // не JSON — оставляем как есть
    }
    throw new Error(`Google Sheets API ${response.status}: ${detail}`);
  }

  return (await response.json()) as T;
}

export interface SheetProperties {
  sheetId: number;
  title: string;
  index: number;
  gridProperties?: { rowCount?: number; columnCount?: number; frozenRowCount?: number };
}

export interface Sheet {
  properties: SheetProperties;
  // Нужны только длина списка правил и сам факт наличия фильтра: и то, и
  // другое надо снять перед тем, как накладывать своё.
  conditionalFormats?: unknown[];
  basicFilter?: unknown;
}

export interface Spreadsheet {
  sheets: Sheet[];
}

// fields обязателен не для экономии: без него Google отдаёт вместе со схемой
// всё содержимое таблицы — на тысячах строк это мегабайты в каждом вызове.
export function getSpreadsheet(spreadsheetId: string): Promise<Spreadsheet> {
  const fields = [
    "sheets.properties(sheetId,title,index,gridProperties)",
    "sheets.conditionalFormats.ranges",
    "sheets.basicFilter.range",
  ].join(",");
  return call<Spreadsheet>(`${API}/${spreadsheetId}?fields=${encodeURIComponent(fields)}`);
}

/* Заголовок листа в диапазоне A1 берётся в одинарные кавычки, а свои
   кавычки внутри удваиваются. Без этого лист с апострофом в названии
   ломает разбор диапазона на стороне Google. */
export function quoteTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<unknown> {
  if (requests.length === 0) return Promise.resolve({});
  return call(`${API}/${spreadsheetId}:batchUpdate`, { method: "POST", body: { requests } });
}

export interface ValueRange {
  range?: string;
  values?: unknown[][];
}

export function valuesBatchGet(spreadsheetId: string, ranges: string[]): Promise<{ valueRanges?: ValueRange[] }> {
  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  return call(`${API}/${spreadsheetId}/values:batchGet?${query}`);
}

/* RAW, а не USER_ENTERED, и это принципиально: USER_ENTERED прогоняет каждую
   ячейку через разбор формул, и телефон «+7 999…» превращается в ошибку
   разбора. RAW кладёт строку ровно так, как её прислали. */
export function valuesBatchUpdate(spreadsheetId: string, data: ValueRange[]): Promise<unknown> {
  return call(`${API}/${spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: { valueInputOption: "RAW", data },
  });
}

export function valuesBatchClear(spreadsheetId: string, ranges: string[]): Promise<unknown> {
  return call(`${API}/${spreadsheetId}/values:batchClear`, { method: "POST", body: { ranges } });
}
