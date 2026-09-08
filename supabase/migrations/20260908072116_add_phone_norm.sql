-- Разделяем телефон на два поля:
--   phone      — как прислал внешний сервис, без изменений
--   phone_norm — только цифры (8 в начале приводится к 7), по нему идёт склейка дублей
alter table people add column phone_norm text;

create index people_phone_norm_idx on people (phone_norm);

-- Существующие строки: в phone сейчас лежит уже нормализованное значение,
-- переносим его в phone_norm, phone не трогаем.
update people
set phone_norm = phone
where phone is not null and phone_norm is null;
