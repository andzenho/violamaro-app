import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreatePerson, type EventBody, type Person } from "@/lib/people";
import { getSupabase } from "@/lib/supabase";

export interface EventInput extends EventBody {
  type: string;
  test?: string | null;
}

// Поля, которые анонимная запись передаёт опознанной при склейке.
// platform и platform_user_id сюда не входят — они и есть то, чем записи
// различаются. first_source входит: анонимное касание было раньше, значит
// его метка источника и есть настоящая первая.
const CARRIED_FIELDS = [
  "username",
  "first_name",
  "last_name",
  "phone",
  "phone_norm",
  "email",
  "first_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "referrer",
] as const satisfies readonly (keyof Person)[];

/* Человек сначала ходил анонимно, а потом открыл тест по ссылке с ключом.
   Это один человек с двумя записями: переносим его прежние события на
   опознанную и убираем анонимную, иначе воронка рвётся ровно посередине.

   Гонок здесь можно не бояться: перенос событий и удаление пустой записи
   при повторе — пустые операции, худшее последствие второго прохода это
   лишний запрос. */
async function absorbAnonymous(supabase: SupabaseClient, anonId: string, person: Person): Promise<void> {
  const { data, error } = await supabase
    .from("people")
    .select("*")
    .eq("platform", "web")
    .eq("platform_user_id", anonId)
    .maybeSingle();
  if (error) throw error;

  const anon = data as Person | null;
  if (!anon || anon.id === person.id) return;

  const { error: moveError } = await supabase
    .from("events")
    .update({ person_id: person.id })
    .eq("person_id", anon.id);
  if (moveError) throw moveError;

  const carry: Record<string, string> = {};
  for (const field of CARRIED_FIELDS) {
    const value = anon[field];
    if (!person[field] && value) carry[field] = value;
  }
  if (Object.keys(carry).length > 0) {
    carry.updated_at = new Date().toISOString();
    const { error: carryError } = await supabase.from("people").update(carry).eq("id", person.id);
    if (carryError) throw carryError;
  }

  // События уже переехали, так что удалять больше нечего, кроме самой
  // пустой записи. Не получилось — не беда: она осиротела, но никому не
  // мешает, а событие человека важнее.
  const { error: dropError } = await supabase.from("people").delete().eq("id", anon.id);
  if (dropError) console.error("не удалось убрать анонимную запись после склейки:", dropError);
}

/* Единственное место, где событие попадает в базу. Им пользуются оба роута:
   /api/event (для внешних сервисов, за ключом) и /api/track (для браузера,
   без ключа, но с жёстким белым списком полей). */
export async function recordEvent(input: EventInput, anonId?: string | null): Promise<string> {
  const supabase = getSupabase();
  const person = await findOrCreatePerson(supabase, input);

  const identifiedElsewhere = !(input.platform === "web" && input.platform_user_id === anonId);
  if (anonId && identifiedElsewhere) {
    await absorbAnonymous(supabase, anonId, person);
  }

  const { error } = await supabase.from("events").insert({
    person_id: person.id,
    type: input.type,
    source: input.source ?? null,
    test: input.test ?? null,
    payload: input.payload ?? null,
  });
  if (error) throw error;

  return person.id;
}
