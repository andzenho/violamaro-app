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

`SUPABASE_SERVICE_KEY` — секретный ключ с полным доступом к базе. Используется только на сервере
(в API-роутах), никогда не должен попадать в код на клиенте или в публичный репозиторий.

## Деплой на Vercel

1. Зайдите на [vercel.com](https://vercel.com) → Add New → Project.
2. Импортируйте этот репозиторий (`violamaro-app`).
3. В настройках проекта (Settings → Environment Variables) добавьте те же переменные,
   что и в `.env.example`: `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_SERVICE_KEY`.
4. Запустите деплой. Vercel сам определит Next.js и настроит сборку.
5. После деплоя проверьте `https://<ваш-домен>/api/health`.
