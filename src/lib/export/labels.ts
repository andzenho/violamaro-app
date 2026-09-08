/* Таблицу читает человек, а не машина: в базе лежат ключи (`tg`, `test_done`,
   `donor`), а в колонках должны стоять слова. Все словари собраны здесь, чтобы
   переименование теста или источника правилось в одном месте. */

// Ключ, которого в словаре нет, отдаём как есть: пустая ячейка врёт сильнее,
// чем незнакомое слово, и по нему сразу видно, что словарь пора дополнить.
function label(dict: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "";
  return dict[key] ?? key;
}

const PLATFORMS: Record<string, string> = {
  tg: "Telegram",
  max: "MAX",
  vk: "ВКонтакте",
  web: "Сайт",
};

// «Откуда» на листах заявок — не канал (это уже «Источник»), а то, какая
// из трёх форм её прислала. Различаются они только на двух внешних сайтах:
// у них source — фиксированная метка самого сайта (см. /api/lead). Всё
// прочее — источники самого теста (или событие без source вовсе) — точно
// «Тест», других мест анкета предзаписи взяться не может.
const ORIGIN_BY_SOURCE: Record<string, string> = {
  "site-pre": "Сайт предзаписи",
  "site-pe": "Сайт ПЭ",
};

// «Источник» человека — это его first_source, метка самого первого касания.
// Если человек впервые появился прямо на /pre/ или главном сайте (см.
// /api/lead), первым касанием будет site-pre/site-pe — те же ключи, что и
// у «Откуда», поэтому подписи для них переиспользуются из ORIGIN_BY_SOURCE,
// а не заводятся вторым словарём.
const SOURCES: Record<string, string> = {
  "tg-bot": "Телеграм-бот",
  "max-bot": "MAX-бот",
  "vk-post": "Пост ВКонтакте",
  landing: "Лендинг",
  chat: "Чат",
  ...ORIGIN_BY_SOURCE,
};

const TESTS: Record<string, string> = {
  empat: "Эмпат ли вы",
  koleso: "Колесо эмпата",
};

const EVENTS: Record<string, string> = {
  post_click: "Клик по посту",
  bot_start: "Старт бота",
  subscribed: "Подписался",
  test_open: "Открыл тест",
  test_done: "Прошёл тест",
  offer_view: "Посмотрел программу",
  lead: "Заявка",
  dialog_in: "Написал",
  dialog_out: "Ответили",
  unsub: "Отписался",
};

// Ранги теста «Эмпат ли вы» — названия дословно из public/legacy/empat.html.
const RANKS: Record<string, string> = {
  donor: "Эмпат-донор",
  filter: "Эмпат без фильтра",
  sleeping: "Спящий эмпат",
  awake: "Проснувшийся эмпат",
  reader: "Считывающий",
  caring: "Сочувствующий",
  other: "Другая настройка",
};

// Сферы «Колеса эмпата» — тоже дословно из public/legacy/koleso.html.
const SPHERES: Record<string, string> = {
  partner: "Партнёр",
  semya: "Семья",
  rabota: "Работа",
  dengi: "Деньги",
  telo: "Тело и силы",
  delo: "Своё дело",
};

export const platformLabel = (key?: string | null) => label(PLATFORMS, key);
export const sourceLabel = (key?: string | null) => label(SOURCES, key);
export const testLabel = (key?: string | null) => label(TESTS, key);
export const eventLabel = (key?: string | null) => label(EVENTS, key);
export const rankLabel = (key?: string | null) => label(RANKS, key);
export const sphereLabel = (key?: string | null) => label(SPHERES, key);
export const originLabel = (key?: string | null) => (key && ORIGIN_BY_SOURCE[key]) || "Тест";

// worst в «Колесе» приходит одной строкой: "telo,dengi".
export function sphereListLabel(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .split(",")
    .map((k) => sphereLabel(k.trim()))
    .filter(Boolean)
    .join(", ");
}
