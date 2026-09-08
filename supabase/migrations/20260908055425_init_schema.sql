-- Extensions
create extension if not exists pgcrypto;

-- people: одна запись на человека, независимо от того, сколькими
-- платформами/тестами/заявками он воспользовался
create table people (
  id                uuid primary key default gen_random_uuid(),
  platform          text,
  platform_user_id  text,
  username          text,
  first_name        text,
  last_name         text,
  phone             text,
  email             text,
  first_source      text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  referrer          text,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Обычный (непарциальный) уникальный индекс: по правилам SQL строка,
-- где platform или platform_user_id равны null, никогда не считается
-- дублирующей другую такую же строку — то есть "оба не null" уже
-- обеспечено семантикой NULL, отдельный WHERE не нужен. Это важно и для
-- ON CONFLICT (platform, platform_user_id) в коде — Postgres не может
-- сматчить его с партиционным индексом без WHERE прямо в самом ON CONFLICT.
create unique index people_platform_user_id_key
  on people (platform, platform_user_id);

create index people_username_idx on people (username);
create index people_phone_idx on people (phone);

alter table people enable row level security;

-- events: лог действий человека (клики, старты бота, прохождение тестов,
-- заявки, диалоги). type/test не ограничены constraint-ом на базе —
-- проверка допустимых значений делается в коде роутов.
create table events (
  id          bigserial primary key,
  person_id   uuid not null references people (id) on delete cascade,
  type        text not null,
  source      text,
  test        text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index events_person_id_idx on events (person_id);
create index events_type_idx on events (type);
create index events_created_at_idx on events (created_at);

alter table events enable row level security;

-- links: сгенерированные ссылки на бота/сайт с метками источника
create table links (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  kind        text,
  platform    text,
  target      text,
  params      jsonb,
  url         text,
  created_at  timestamptz not null default now()
);

alter table links enable row level security;
