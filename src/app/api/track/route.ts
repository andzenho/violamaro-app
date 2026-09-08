import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/error";
import { normalizeUsername, type Platform } from "@/lib/people";
import { recordEvent, type EventInput } from "@/lib/track";

/* Этот роут открыт наружу без ключа: его зовёт сам тест из браузера, а
   API_SECRET в браузер попасть не может. Значит, доверять здесь нельзя
   ничему — каждое поле либо из белого списка, либо разобрано по образцу,
   либо не доезжает до базы вовсе. Секрет остаётся на сервере: /api/track
   не ходит в /api/event по HTTP, а зовёт ту же функцию recordEvent. */

// Только то, что шлёт тест. Остальные типы событий заводят внешние сервисы
// через /api/event, за ключом.
const TRACK_TYPES = ["test_open", "test_done", "offer_view", "lead"] as const;
const TESTS = ["empat", "koleso"] as const;
const SOURCES = ["tg-bot", "max-bot", "vk-post", "landing", "chat"] as const;

// k выдаёт бот, это platform_user_id с префиксом платформы: tg_12345.
const KEY_RE = /^(tg|max|vk)_([A-Za-z0-9_-]{1,64})$/;
// Анонимный посетитель сам заводит себе id в localStorage: web_a1b2c3d4.
const ANON_RE = /^web_[a-z0-9]{6,32}$/;
// Ответы, шкалы и колесо — это несколько сотен байт. Килобайты здесь
// означают, что кто-то пробует использовать нас как хранилище.
const PAYLOAD_LIMIT = 8192;

interface TrackBody {
  type?: unknown;
  test?: unknown;
  k?: unknown;
  anon_id?: unknown;
  source?: unknown;
  name?: unknown;
  contact?: unknown;
  payload?: unknown;
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

/* Контакт человек вводит одним полем: кто-то пишет @логин, кто-то телефон.
   Раскладываем по колонкам, чтобы заявку можно было найти поиском и чтобы
   работала склейка дублей — она идёт по username и phone_norm. Само поле
   при этом остаётся в payload как есть. */
function splitContact(contact: string | null): { username: string | null; phone: string | null } {
  if (!contact) return { username: null, phone: null };
  const digits = contact.replace(/\D/g, "");
  if (digits.length >= 10) return { username: null, phone: contact };
  return { username: normalizeUsername(contact), phone: null };
}

export async function POST(request: Request) {
  let body: TrackBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: "0", error: "invalid json" }, { status: 400 });
  }

  const type = oneOf(TRACK_TYPES, body.type);
  if (!type) return NextResponse.json({ ok: "0", error: "invalid type" }, { status: 400 });

  const test = oneOf(TESTS, body.test);
  if (!test) return NextResponse.json({ ok: "0", error: "invalid test" }, { status: 400 });

  const source = oneOf(SOURCES, body.source);

  const payload =
    body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : null;
  if (payload && JSON.stringify(payload).length > PAYLOAD_LIMIT) {
    return NextResponse.json({ ok: "0", error: "payload too large" }, { status: 413 });
  }

  const key = typeof body.k === "string" ? KEY_RE.exec(body.k) : null;
  const anonId = typeof body.anon_id === "string" && ANON_RE.test(body.anon_id) ? body.anon_id : null;

  /* Ключа нет — человек анонимный, и его держит id из localStorage. Нет и
     его (память браузера закрыта) — пишем событие без опознания: такой
     заход разложится по отдельным записям, но терять заявку из-за
     настроек браузера мы не станем. */
  const platform: Platform = key ? (key[1] as Platform) : "web";
  const platformUserId = key ? key[2] : anonId;

  const name = text(body.name, 200);
  const contact = text(body.contact, 200);
  const { username, phone } = splitContact(contact);

  const input: EventInput = {
    platform,
    platform_user_id: platformUserId,
    type,
    test,
    source,
    payload,
    // Имя и контакт появляются только в заявке — на прочих событиях их нет.
    first_name: type === "lead" ? name : null,
    username: type === "lead" ? username : null,
    phone: type === "lead" ? phone : null,
  };

  try {
    const personId = await recordEvent(input, anonId);
    return NextResponse.json({ ok: "1", person_id: personId });
  } catch (error) {
    console.error("POST /api/track failed:", error);
    return NextResponse.json({ ok: "0", error: errorMessage(error) }, { status: 500 });
  }
}
