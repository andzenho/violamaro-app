# Виола Маро

Next.js 15 (App Router, TypeScript) + Supabase.

## Запуск локально

1. Установите зависимости:

   ```bash
   npm install
   ```

2. Скопируйте `.env.example` в `.env.local` и заполните переменные:

   ```bash
   cp .env.example .env.local
   ```

3. Запустите dev-сервер:

   ```bash
   npm run dev
   ```

   Приложение откроется на [http://localhost:3000](http://localhost:3000).
   Проверить подключение к базе можно на [http://localhost:3000/api/health](http://localhost:3000/api/health).

## Переменные окружения

| Переменная                  | Где взять                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`   | Supabase Dashboard → выбранный проект → Project Settings → Data API → Project URL             |
| `SUPABASE_SERVICE_KEY`       | Supabase Dashboard → выбранный проект → Project Settings → API Keys → `service_role` секретный ключ |
| `API_SECRET`                 | Придумываете сами (любая случайная строка) — им защищены `/api/event` и `/api/status`         |

`SUPABASE_SERVICE_KEY` — секретный ключ с полным доступом к базе. Используется только на сервере
(в API-роутах), никогда не должен попадать в код на клиенте или в публичный репозиторий.

`API_SECRET` нужно передавать во внешний сервис (Salebot и т.п.) — он ставит его в заголовок
`X-Api-Key` при каждом запросе к нашим роутам.

## Миграции базы (Supabase CLI)

Схема (`people`, `events`, `links`) лежит в `supabase/migrations/` как обычные `.sql`-файлы.
GitHub-интеграция Supabase не подключена — миграции применяются вручную.

Накатить на реальный проект Supabase:

```bash
npx supabase login
npx supabase link --project-ref <ваш-project-ref>
npx supabase db push
```

`<ваш-project-ref>` — это часть URL проекта в Supabase Dashboard (`https://supabase.com/dashboard/project/<project-ref>`).

Добавить новую миграцию в будущем:

```bash
npx supabase migration new <название>
```

## Деплой на Vercel

1. Зайдите на [vercel.com](https://vercel.com) → Add New → Project.
2. Импортируйте этот репозиторий (`violamaro-app`).
3. В настройках проекта (Settings → Environment Variables) добавьте те же переменные,
   что и в `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `API_SECRET`.
4. Запустите деплой. Vercel сам определит Next.js и настроит сборку.
5. После деплоя проверьте `https://<ваш-домен>/api/health`.

## Проверка API

Ниже — примеры для локального запуска (`http://localhost:3000`); на проде замените адрес
и подставьте свой `API_SECRET`.

### POST /api/event

Новый человек из Telegram-бота, открыл тест:

```bash
curl -X POST http://localhost:3000/api/event \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <ваш API_SECRET>" \
  -d '{
    "platform": "tg",
    "platform_user_id": "12345",
    "username": "ivan_petrov",
    "first_name": "Иван",
    "type": "test_open",
    "source": "tg-bot",
    "test": "empat",
    "payload": { "utm_source": "instagram", "utm_medium": "cpc", "utm_campaign": "launch" }
  }'
# { "ok": "1", "person_id": "..." }
```

Тот же человек прошёл тест (событие допишется к уже существующей записи):

```bash
curl -X POST http://localhost:3000/api/event \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <ваш API_SECRET>" \
  -d '{
    "platform": "tg",
    "platform_user_id": "12345",
    "type": "test_done",
    "source": "tg-bot",
    "test": "empat",
    "payload": { "rank": "Эмпат без фильтра", "percent": 73 }
  }'
# { "ok": "1", "person_id": "..." }
```

Заявка с сайта — без `platform_user_id`, склейка произойдёт по телефону/username, если человек
уже встречался в другой сети:

```bash
curl -X POST http://localhost:3000/api/event \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <ваш API_SECRET>" \
  -d '{
    "platform": "web",
    "phone": "+7 999 123-45-67",
    "type": "lead",
    "source": "landing",
    "test": "empat"
  }'
# { "ok": "1", "person_id": "..." }
```

### GET /api/status

Человек найден, тест пройден:

```bash
curl "http://localhost:3000/api/status?platform=tg&platform_user_id=12345&test=empat" \
  -H "X-Api-Key: <ваш API_SECRET>"
# { "ok": "1", "found": "1", "test_open": "1", "test_done": "1", "lead": "0", "lead_any": "0",
#   "rank": "Эмпат без фильтра", "percent": "73", "test_date": "2026-09-08" }
```

Человека нет в базе — штатный ответ, не ошибка:

```bash
curl "http://localhost:3000/api/status?platform=tg&platform_user_id=99999&test=empat" \
  -H "X-Api-Key: <ваш API_SECRET>"
# { "ok": "1", "found": "0", "test_open": "0", "test_done": "0", "lead": "0", "lead_any": "0" }
```

### Без API-ключа

```bash
curl -w "\n%{http_code}\n" "http://localhost:3000/api/status?platform=tg&platform_user_id=12345&test=empat"
# { "ok": "0", "error": "unauthorized" }
# 401
```
