import { NextResponse } from "next/server";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { errorMessage } from "@/lib/error";
import { isEventType } from "@/lib/events";
import { findOrCreatePerson, isPlatform, type EventBody } from "@/lib/people";
import { getSupabase } from "@/lib/supabase";

interface EventRequestBody extends EventBody {
  type: string;
  test?: string | null;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  let body: EventRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: "0", error: "invalid json" }, { status: 400 });
  }

  if (!isPlatform(body.platform)) {
    return NextResponse.json({ ok: "0", error: "invalid platform" }, { status: 400 });
  }

  if (!isEventType(body.type)) {
    return NextResponse.json({ ok: "0", error: "invalid type" }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const person = await findOrCreatePerson(supabase, body);

    const { error } = await supabase.from("events").insert({
      person_id: person.id,
      type: body.type,
      source: body.source ?? null,
      test: body.test ?? null,
      payload: body.payload ?? null,
    });
    if (error) throw error;

    return NextResponse.json({ ok: "1", person_id: person.id });
  } catch (error) {
    console.error("POST /api/event failed:", error);
    return NextResponse.json({ ok: "0", error: errorMessage(error) }, { status: 500 });
  }
}
