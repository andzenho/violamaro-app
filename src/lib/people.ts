import type { SupabaseClient } from "@supabase/supabase-js";

export const PLATFORMS = ["tg", "max", "vk", "web"] as const;

export type Platform = (typeof PLATFORMS)[number];

export function isPlatform(value: unknown): value is Platform {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value);
}

export function normalizeUsername(username?: string | null): string | null {
  if (!username) return null;
  const trimmed = username.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

// Нормализованный вид для склейки дублей: только цифры, 8 в начале -> 7.
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  return digits;
}

// В phone телефон хранится ровно в том виде, в каком его прислали.
function rawPhone(phone?: string | null): string | null {
  if (!phone || !phone.trim()) return null;
  return phone;
}

export interface EventBody {
  platform: Platform;
  platform_user_id?: string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface Person {
  id: string;
  platform: string | null;
  platform_user_id: string | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_norm: string | null;
  email: string | null;
  first_source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  referrer: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// Профильные поля, которые можно дозаполнить, если они ещё пустые.
// first_source сюда сознательно не входит — он не перезаписывается никогда.
const FILLABLE_FIELDS = [
  "platform",
  "platform_user_id",
  "username",
  "first_name",
  "last_name",
  "phone",
  "phone_norm",
  "email",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "referrer",
] as const;

function candidateValues(body: EventBody, username: string | null, phoneNorm: string | null) {
  const payload = body.payload ?? {};
  return {
    platform: body.platform ?? null,
    platform_user_id: body.platform_user_id ?? null,
    username,
    first_name: body.first_name ?? null,
    last_name: body.last_name ?? null,
    phone: rawPhone(body.phone),
    phone_norm: phoneNorm,
    email: body.email ?? null,
    utm_source: typeof payload.utm_source === "string" ? payload.utm_source : null,
    utm_medium: typeof payload.utm_medium === "string" ? payload.utm_medium : null,
    utm_campaign: typeof payload.utm_campaign === "string" ? payload.utm_campaign : null,
    utm_content: typeof payload.utm_content === "string" ? payload.utm_content : null,
    referrer: typeof payload.referrer === "string" ? payload.referrer : null,
  };
}

async function findPerson(
  supabase: SupabaseClient,
  platform: Platform,
  platformUserId: string | null,
  username: string | null,
  phoneNorm: string | null
): Promise<Person | null> {
  if (platformUserId) {
    const { data } = await supabase
      .from("people")
      .select("*")
      .eq("platform", platform)
      .eq("platform_user_id", platformUserId)
      .maybeSingle();
    if (data) return data as Person;
  }

  if (username) {
    const { data } = await supabase
      .from("people")
      .select("*")
      .eq("username", username)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data as Person;
  }

  if (phoneNorm) {
    const { data } = await supabase
      .from("people")
      .select("*")
      .eq("phone_norm", phoneNorm)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) return data as Person;
  }

  return null;
}

async function createPerson(
  supabase: SupabaseClient,
  values: ReturnType<typeof candidateValues>,
  firstSource: string | null
): Promise<Person> {
  const insertData = { ...values, first_source: firstSource };

  // Если есть пара platform+platform_user_id, две параллельные заявки от
  // одного и того же человека не должны создать два разных person_id.
  if (insertData.platform && insertData.platform_user_id) {
    const { data: inserted, error: insertError } = await supabase
      .from("people")
      .upsert(insertData, {
        onConflict: "platform,platform_user_id",
        ignoreDuplicates: true,
      })
      .select()
      .maybeSingle();

    if (insertError) throw insertError;
    if (inserted) return inserted as Person;

    const { data: existing, error: selectError } = await supabase
      .from("people")
      .select("*")
      .eq("platform", insertData.platform)
      .eq("platform_user_id", insertData.platform_user_id)
      .single();
    if (selectError) throw selectError;
    return existing as Person;
  }

  const { data, error } = await supabase.from("people").insert(insertData).select().single();
  if (error) throw error;
  return data as Person;
}

async function updatePerson(supabase: SupabaseClient, existing: Person, values: ReturnType<typeof candidateValues>): Promise<Person> {
  const updates: Record<string, string> = {};

  for (const field of FILLABLE_FIELDS) {
    const current = existing[field];
    const candidate = values[field];
    if (!current && candidate) {
      updates[field] = candidate;
    }
  }

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from("people").update(updates).eq("id", existing.id).select().single();
  if (error) throw error;
  return data as Person;
}

export async function findOrCreatePerson(supabase: SupabaseClient, body: EventBody): Promise<Person> {
  const username = normalizeUsername(body.username);
  const phoneNorm = normalizePhone(body.phone);
  const platformUserId = body.platform_user_id ?? null;

  const existing = await findPerson(supabase, body.platform, platformUserId, username, phoneNorm);
  const values = candidateValues(body, username, phoneNorm);

  if (!existing) {
    return createPerson(supabase, values, body.source ?? null);
  }

  return updatePerson(supabase, existing, values);
}
