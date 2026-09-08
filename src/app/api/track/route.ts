import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/error";
import { normalizeUsername, splitContact, type Platform } from "@/lib/people";
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
  u?: unknown;
  n?: unknown;
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

  // Логин и имя из ссылки бота: ?u=ivan_petrov&n=Иван, бот подставляет их
  // сам, как k и src. Приходят на каждом событии, не только на заявке —
  // это самое раннее место, где можно узнать человека, и колонки «Логин»/
  // «Имя» на листах тестов заполнятся уже с первого касания.
  const botUsername = normalizeUsername(text(body.u, 100));
  const botName = text(body.n, 200);

  const input: EventInput = {
    platform,
    platform_user_id: platformUserId,
    type,
    test,
    source,
    payload,
    // На заявке в приоритете то, что человек ввёл сам; не ввёл — берём то,
    // что уже знает бот. На прочих событиях контакта ещё нет, есть только бот.
    first_name: (type === "lead" ? name : null) || botName,
    username: (type === "lead" ? username : null) || botUsername,
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
