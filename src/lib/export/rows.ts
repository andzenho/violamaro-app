import type { SupabaseClient } from "@supabase/supabase-js";
import { detailsLine, testOutcome, toSerial } from "@/lib/export/format";
import { eventLabel, platformLabel, sourceLabel, testLabel } from "@/lib/export/labels";
import { getSupabase } from "@/lib/supabase";

export const LEAD_HEADER = [
  "Дата первой заявки",
  "Имя",
  "Контакт",
  "Платформа",
  "Источник",
  "Тест",
  "Результат",
  "Процент",
  "Заявок",
  "Дата последней заявки",
];

export const EVENT_HEADER = [
  "Дата и время",
  "Человек",
  "Платформа",
  "Событие",
  "Источник",
  "Тест",
  "Детали",
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
   «Имя» на листе «Заявки». Иначе один и тот же человек назывался бы на двух
   листах по-разному: в заявке «Иван Петров», как он представился сам, а в
   событиях «Иван», как его завёл бот. */
function personTitle(person: PersonRow, leads: EventRow[]): string {
  const name = firstFilled(leads, "name") || fullName(person);
  if (name) return name;
  if (person.username?.trim()) return `@${person.username.trim()}`;

  const platform = platformLabel(person.platform);
  const id = person.platform_user_id?.trim();
  if (platform && id) return `${platform} ${id}`;
  return platform || "Без имени";
}

export interface ExportRows {
  leads: unknown[][];
  events: unknown[][];
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

  const leadRows: { sort: number; row: unknown[] }[] = [];
  const eventGroups: { sort: number; rows: unknown[][] }[] = [];

  for (const person of people) {
    // События уже отсортированы по времени по возрастанию — группировка
    // порядок сохраняет, поэтому путь человека читается сверху вниз.
    const own = byPerson.get(person.id) ?? [];
    if (own.length === 0) continue;

    const leads = own.filter((e) => e.type === "lead");
    const title = personTitle(person, leads);

    eventGroups.push({
      // Ключ сортировки групп — последнее событие, а не первое. Человек,
      // вернувшийся сегодня после месяца молчания, в «Заявках» окажется
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

    // Лист «Заявки» — только про тех, кто заявку оставил.
    if (leads.length === 0) continue;

    const lastDone = own.filter((e) => e.type === "test_done").at(-1);
    const outcome = testOutcome(lastDone?.test ?? null, lastDone?.payload ?? null);

    const tests = [...new Set(leads.map((e) => e.test).filter(Boolean))]
      .map((t) => testLabel(t))
      .join(", ");

    const lastLeadAt = toSerial(leads[leads.length - 1].created_at);

    leadRows.push({
      sort: lastLeadAt,
      row: [
        toSerial(leads[0].created_at),
        firstFilled(leads, "name") || fullName(person),
        firstFilled(leads, "contact") || contactFallback(person),
        platformLabel(person.platform),
        sourceLabel(person.first_source),
        tests,
        outcome.result,
        outcome.percent,
        leads.length,
        lastLeadAt,
      ],
    });
  }

  /* Свежие сверху на обоих листах, и по одному правилу — по последней
     активности: руководитель заходит за новыми заявками и ради них не
     должен листать вниз. Внутри человека порядок обратный, по возрастанию:
     иначе путь читался бы задом наперёд. */
  leadRows.sort((a, b) => b.sort - a.sort);
  eventGroups.sort((a, b) => b.sort - a.sort);

  return {
    leads: leadRows.map((r) => r.row),
    events: eventGroups.flatMap((g) => g.rows),
    peopleCount: people.length,
  };
}
