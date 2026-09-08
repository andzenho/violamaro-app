import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/error";
import { isLeadFormType } from "@/lib/leadForm";
import { splitContact } from "@/lib/people";
import { clientIp, isRateLimited } from "@/lib/rateLimit";
import { recordEvent, type EventInput } from "@/lib/track";

/* Роут для внешних сайтов — /pre/ (анкета предзаписи не через тест) и
   главного сайта (заявка на «Прикладную эмпатию» с тарифом). Открыт без
   ключа, как и /api/track, ровно по той же причине: страница на чужом
   домене не может держать секрет. Доверять поэтому нельзя ничему — то же
   правило, только полей в анкете больше, и запрос идёт с другого домена,
   так что нужны ещё CORS-заголовки. */

// Значения задаёт задание, отданное верстальщикам сайтов, — их нельзя
// менять не предупредив: source различает даже не канал, а сам сайт, и по
// нему на листах заявок считается колонка «Откуда».
const SOURCES = ["site-pre", "site-pe"] as const;

// Скрытое поле-приманка: обычный человек его не видит и не заполняет,
// скрипт, который слепо заполняет все поля формы, — заполняет.
const HONEYPOT_FIELD = "company";

// Полей больше, чем в /api/track, и часть — произвольные, поэтому лимит
// выше; но это всё равно анкета, а не файловое хранилище.
const BODY_LIMIT = 16384;

// Поля произвольного «довеска» в payload обрезаем и по счёту, и по длине
// каждого — иначе кто-то пришлёт сотню полей по мегабайту.
const EXTRA_FIELD_LIMIT = 500;
const EXTRA_FIELDS_MAX = 20;

const KNOWN_FIELDS = new Set([
  "name",
  "contact",
  "phone",
  "email",
  "form",
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "referrer",
  "page",
  "consent_pd",
  "consent_ads",
  "tariff",
  "readiness",
  HONEYPOT_FIELD,
]);

interface LeadBody {
  [key: string]: unknown;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

function oneOf<T extends readonly string[]>(list: T, value: unknown): T[number] | null {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

const FALSE_STRINGS = new Set(["false", "0", "no", "нет"]);

function truthy(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 && !FALSE_STRINGS.has(trimmed);
  }
  return false;
}

export async function OPTIONS(): Promise<NextResponse> {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (isRateLimited(clientIp(request))) {
    return json({ ok: "0", error: "too many requests" }, 429);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ ok: "0", error: "invalid json" }, 400);
  }
  if (raw.length > BODY_LIMIT) {
    return json({ ok: "0", error: "payload too large" }, 413);
  }

  let body: LeadBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ ok: "0", error: "invalid json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: "0", error: "invalid json" }, 400);
  }

  // Приманка заполнена — молча отвечаем «ок» и не пишем ничего: человек не
  // должен догадаться, что его отфильтровали, иначе фильтр начнут обходить.
  if (truthy(body[HONEYPOT_FIELD])) {
    return json({ ok: "1" });
  }

  const form = isLeadFormType(body.form) ? body.form : null;
  if (!form) return json({ ok: "0", error: "invalid form" }, 400);

  const source = oneOf(SOURCES, body.source);
  if (!source) return json({ ok: "0", error: "invalid source" }, 400);

  const name = text(body.name, 200);
  const contact = text(body.contact, 200);
  const { username: contactUsername, phone: contactPhone } = splitContact(contact);

  const phone = text(body.phone, 40);
  const email = text(body.email, 200);
  const tariff = text(body.tariff, 200);
  const readiness = text(body.readiness, 500);
  const page = text(body.page, 500);
  const referrer = text(body.referrer, 500);
  const utmSource = text(body.utm_source, 200);
  const utmMedium = text(body.utm_medium, 200);
  const utmCampaign = text(body.utm_campaign, 200);
  const utmContent = text(body.utm_content, 200);

  const payload: Record<string, unknown> = { form };
  if (name) payload.name = name;
  if (contact) payload.contact = contact;
  if (tariff) payload.tariff = tariff;
  // Тот же ключ, что у теста в форме предзаписи — «Детали» на листе
  // «События» и так умеют показывать готовность, дублировать словарь незачем.
  if (readiness) payload.ready = readiness;
  if (page) payload.page = page;
  if (referrer) payload.referrer = referrer;
  if (utmSource) payload.utm_source = utmSource;
  if (utmMedium) payload.utm_medium = utmMedium;
  if (utmCampaign) payload.utm_campaign = utmCampaign;
  if (utmContent) payload.utm_content = utmContent;
  if (truthy(body.consent_pd)) payload.accept_pd = "да";
  if (truthy(body.consent_ads)) payload.accept_ads = "да";
  payload.consent_ts = new Date().toISOString();

  // Всё, что сайт прислал сверх известных полей, — тоже в payload: только
  // простые значения, с ограничением по числу и длине.
  let extraCount = 0;
  for (const [key, value] of Object.entries(body)) {
    if (KNOWN_FIELDS.has(key) || key in payload) continue;
    if (extraCount >= EXTRA_FIELDS_MAX) break;
    let shown: string | number | boolean | null = null;
    if (typeof value === "string") shown = value.trim().slice(0, EXTRA_FIELD_LIMIT) || null;
    else if (typeof value === "number" || typeof value === "boolean") shown = value;
    if (shown === null) continue;
    payload[key] = shown;
    extraCount += 1;
  }

  const input: EventInput = {
    platform: "web",
    type: "lead",
    source,
    payload,
    first_name: name,
    username: contactUsername,
    phone: phone || contactPhone,
    email,
  };

  try {
    const personId = await recordEvent(input);
    return json({ ok: "1", person_id: personId });
  } catch (error) {
    console.error("POST /api/lead failed:", error);
    return json({ ok: "0", error: errorMessage(error) }, 500);
  }
}
