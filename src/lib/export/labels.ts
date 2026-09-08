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

const SOURCES: Record<string, string> = {
  "tg-bot": "Телеграм-бот",
  "max-bot": "MAX-бот",
  "vk-post": "Пост ВКонтакте",
  landing: "Лендинг",
  chat: "Чат",
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

// worst в «Колесе» приходит одной строкой: "telo,dengi".
export function sphereListLabel(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .split(",")
    .map((k) => sphereLabel(k.trim()))
    .filter(Boolean)
    .join(", ");
}
