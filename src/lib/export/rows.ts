import type { SupabaseClient } from "@supabase/supabase-js";
import { detailsLine, forkText, percent, testOutcome, toSerial } from "@/lib/export/format";
import { eventLabel, originLabel, platformLabel, sourceLabel, sphereListLabel, testLabel } from "@/lib/export/labels";
import { leadForm } from "@/lib/leadForm";
import { getSupabase } from "@/lib/supabase";

// Общие для обоих листов заявок колонки; «Заявки на ПЭ» добавляет к ним
// «Тариф» и «Готовность» в конце.
const BASE_LEAD_HEADER = [
  "Дата первой заявки",
  "Имя",
  "Контакт",
  "Платформа",
  "Источник",
  "Откуда",
  "Тест",
  "Результат",
  "Процент",
  "Заявок",
  "Дата последней заявки",
];

export const PREDZAPIS_LEAD_HEADER = BASE_LEAD_HEADER;
export const PE_LEAD_HEADER = [...BASE_LEAD_HEADER, "Тариф", "Готовность"];

export const EVENT_HEADER = [
  "Дата и время",
  "Человек",
  "Платформа",
  "Событие",
  "Источник",
  "Тест",
  "Детали",
];

// Логин и ID в мессенджере — только здесь, на листах тестов: по ним команда
// пишет человеку напрямую. На листах заявок их нет — там о них не спрашивают.
export const EMPAT_HEADER = [
  "Дата",
  "Имя",
  "Логин",
  "ID в мессенджере",
  "Платформа",
  "Источник",
  "Профиль",
  "Процент",
  "Что менять первым",
  "Где съедает",
  "Заявка",
];

export const KOLESO_HEADER = [
  "Дата",
  "Имя",
  "Логин",
  "ID в мессенджере",
  "Платформа",
  "Источник",
  "Отдаю",
  "Остаётся",
  "Просевшие сферы",
  "Где тяжелее",
  "Заявка",
];

interface PersonRow {
  id: string;
  platform: string | null;
  platform_user_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  first_source: string | null;
}

interface EventRow {
  person_id: string;
  type: string;
  source: string | null;
  test: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

/* PostgREST отдаёт не больше 1000 строк за запрос и делает это молча: без
   постраничного чтения выгрузка обрежется на тысяче, и никто этого не
   заметит, пока не хватятся заявки. */
const PAGE = 1000;

async function fetchAll<T>(supabase: SupabaseClient, table: string, columns: string, orderBy: string): Promise<T[]> {
  const all: T[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      // id вторым ключом: у событий, записанных в одну миллисекунду, порядок
      // без него не определён, и страницы могут разъехаться — одна строка
      // попадёт дважды, другая ни разу.
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw error;
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

function fullName(person: PersonRow): string {
  return [person.first_name, person.last_name].map((p) => p?.trim()).filter(Boolean).join(" ");
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function payloadText(payload: Record<string, unknown> | null, key: string): string {
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/* Имя и контакт берём из payload заявки — там их ввёл сам человек. Если он
   оставлял заявку дважды и в первый раз поле было пустым, берём первое
   непустое, а не первое вообще. */
function firstFilled(leads: EventRow[], key: string): string {
  for (const lead of leads) {
    const value = payloadText(lead.payload, key);
    if (value) return value;
  }
  return "";
}

/* Заявка могла прийти и не из формы теста — например, от бота через
   /api/event, где payload пустой, а контакт разложен по колонкам человека.
   Тогда подставляем их: пустая колонка «Контакт» должна значить, что
   связаться правда нечем, — на этом стоит подсветка проблемных строк. */
function contactFallback(person: PersonRow): string {
  if (person.phone?.trim()) return person.phone.trim();
  if (person.username?.trim()) return `@${person.username.trim()}`;
  if (person.email?.trim()) return person.email.trim();
  return "";
}

/* «Человек» на листе событий: имя, иначе логин, иначе платформа и id.
   Имя из заявки идёт первым, а поля человека вторыми — ровно как в колонке
   «Имя» на листах заявок. Иначе один и тот же человек назывался бы на
   разных листах по-разному: в заявке «Иван Петров», как он представился
   сам, а в событиях «Иван», как его завёл бот. */
function personTitle(person: PersonRow, leads: EventRow[]): string {
  const name = firstFilled(leads, "name") || fullName(person);
  if (name) return name;
  if (person.username?.trim()) return `@${person.username.trim()}`;

  const platform = platformLabel(person.platform);
  const id = person.platform_user_id?.trim();
  if (platform && id) return `${platform} ${id}`;
  return platform || "Без имени";
}

// «ID в мессенджере» и «Логин» — только для настоящих мессенджеров. У
// платформы web там лежит либо наш анонимный id (web_a1b2c3d4), либо ничего:
// ни то, ни другое не годится, чтобы написать человеку напрямую.
const MESSENGER_PLATFORMS = new Set(["tg", "max", "vk"]);

function messengerId(person: PersonRow): string {
  if (!person.platform || !MESSENGER_PLATFORMS.has(person.platform)) return "";
  return person.platform_user_id?.trim() ?? "";
}

function messengerLogin(person: PersonRow): string {
  if (!person.platform || !MESSENGER_PLATFORMS.has(person.platform)) return "";
  const username = person.username?.trim();
  return username ? `@${username}` : "";
}

interface SortedRow {
  sort: number;
  row: unknown[];
}

/* Общая часть листов «Анкета предзаписи» и «Заявки на ПЭ»: разница только
   в том, каким payload.form отфильтрованы заявки и есть ли Тариф/Готовность
   в конце строки. leads здесь — уже заявки только нужного вида. */
function buildLeadRow(person: PersonRow, leads: EventRow[], lastDone: EventRow | undefined, withTariff: boolean): SortedRow {
  const outcome = testOutcome(lastDone?.test ?? null, lastDone?.payload ?? null);

  const tests = [...new Set(leads.map((e) => e.test).filter(Boolean))]
    .map((t) => testLabel(t))
    .join(", ");

  // Откуда — по source самих заявок этого вида: человек мог оставить
  // предзапись и через тест, и потом ещё раз через /pre/, тогда покажем оба.
  const origins = [...new Set(leads.map((e) => originLabel(e.source)))].join(", ");

  const lastLeadAt = toSerial(leads[leads.length - 1].created_at);

  const row: unknown[] = [
    toSerial(leads[0].created_at),
    firstFilled(leads, "name") || fullName(person),
    firstFilled(leads, "contact") || contactFallback(person),
    platformLabel(person.platform),
    sourceLabel(person.first_source),
    origins,
    tests,
    outcome.result,
    outcome.percent,
    leads.length,
    lastLeadAt,
  ];

  if (withTariff) {
    // Тот же ключ "ready", что использует форма предзаписи теста — «Детали»
    // на «Событиях» и так его показывают, отдельный словарь не нужен.
    row.push(firstFilled(leads, "tariff"), firstFilled(leads, "ready"));
  }

  return { sort: lastLeadAt, row };
}

function empatRow(person: PersonRow, lastDone: EventRow, hasLead: boolean): SortedRow {
  const outcome = testOutcome("empat", lastDone.payload);
  const sort = toSerial(lastDone.created_at);

  return {
    sort,
    row: [
      sort,
      fullName(person),
      messengerLogin(person),
      messengerId(person),
      platformLabel(person.platform),
      sourceLabel(lastDone.source),
      outcome.result,
      outcome.percent,
      forkText(lastDone.payload, "zapros"),
      forkText(lastDone.payload, "bol"),
      hasLead ? "да" : "нет",
    ],
  };
}

function kolesoRow(person: PersonRow, lastDone: EventRow, hasLead: boolean): SortedRow {
  const payload = lastDone.payload;
  const sort = toSerial(lastDone.created_at);

  return {
    sort,
    row: [
      sort,
      fullName(person),
      messengerLogin(person),
      messengerId(person),
      platformLabel(person.platform),
      sourceLabel(lastDone.source),
      percent(payload?.otdayu),
      percent(payload?.ostaetsya),
      sphereListLabel(str(payload?.worst)),
      forkText(payload, "bol"),
      hasLead ? "да" : "нет",
    ],
  };
}

export interface ExportRows {
  predzapisLeads: unknown[][];
  peLeads: unknown[][];
  events: unknown[][];
  empat: unknown[][];
  koleso: unknown[][];
  peopleCount: number;
}

export async function buildRows(): Promise<ExportRows> {
  const supabase = getSupabase();

  const [people, events] = await Promise.all([
    fetchAll<PersonRow>(
      supabase,
      "people",
      "id, platform, platform_user_id, username, first_name, last_name, phone, email, first_source",
      "created_at"
    ),
    fetchAll<EventRow>(supabase, "events", "person_id, type, source, test, payload, created_at", "created_at"),
  ]);

  const byPerson = new Map<string, EventRow[]>();
  for (const event of events) {
    const list = byPerson.get(event.person_id);
    if (list) list.push(event);
    else byPerson.set(event.person_id, [event]);
  }

  const predzapisRows: SortedRow[] = [];
  const peRows: SortedRow[] = [];
  const eventGroups: { sort: number; rows: unknown[][] }[] = [];
  const empatRows: SortedRow[] = [];
  const kolesoRows: SortedRow[] = [];

  for (const person of people) {
    // События уже отсортированы по времени по возрастанию — группировка
    // порядок сохраняет, поэтому путь человека читается сверху вниз.
    const own = byPerson.get(person.id) ?? [];
    if (own.length === 0) continue;

    const leads = own.filter((e) => e.type === "lead");
    const title = personTitle(person, leads);

    eventGroups.push({
      // Ключ сортировки групп — последнее событие, а не первое. Человек,
      // вернувшийся сегодня после месяца молчания, в заявках окажется
      // наверху; если здесь его группа останется на месяце давности, найти
      // её будет негде.
      sort: toSerial(own[own.length - 1].created_at),
      rows: own.map((event) => [
        toSerial(event.created_at),
        title,
        platformLabel(person.platform),
        eventLabel(event.type),
        sourceLabel(event.source),
        testLabel(event.test),
        detailsLine(event.type, event.test, event.payload),
      ]),
    });

    if (leads.length > 0) {
      const lastDone = own.filter((e) => e.type === "test_done").at(-1);

      const predzapisLeads = leads.filter((e) => leadForm(e.payload) === "predzapis");
      if (predzapisLeads.length > 0) {
        predzapisRows.push(buildLeadRow(person, predzapisLeads, lastDone, false));
      }

      const peLeads = leads.filter((e) => leadForm(e.payload) === "pe");
      if (peLeads.length > 0) {
        peRows.push(buildLeadRow(person, peLeads, lastDone, true));
      }
    }

    const hasLead = leads.length > 0;

    const lastEmpat = own.filter((e) => e.type === "test_done" && e.test === "empat").at(-1);
    if (lastEmpat) empatRows.push(empatRow(person, lastEmpat, hasLead));

    const lastKoleso = own.filter((e) => e.type === "test_done" && e.test === "koleso").at(-1);
    if (lastKoleso) kolesoRows.push(kolesoRow(person, lastKoleso, hasLead));
  }

  /* Свежие сверху на всех листах, по последней активности; внутри группы на
     «Событиях» порядок обратный, по возрастанию — иначе путь человека
     читался бы задом наперёд. */
  predzapisRows.sort((a, b) => b.sort - a.sort);
  peRows.sort((a, b) => b.sort - a.sort);
  eventGroups.sort((a, b) => b.sort - a.sort);
  empatRows.sort((a, b) => b.sort - a.sort);
  kolesoRows.sort((a, b) => b.sort - a.sort);

  return {
    predzapisLeads: predzapisRows.map((r) => r.row),
    peLeads: peRows.map((r) => r.row),
    events: eventGroups.flatMap((g) => g.rows),
    empat: empatRows.map((r) => r.row),
    koleso: kolesoRows.map((r) => r.row),
    peopleCount: people.length,
  };
}
