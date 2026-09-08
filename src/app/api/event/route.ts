import { NextResponse } from "next/server";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { errorMessage } from "@/lib/error";
import { isEventType } from "@/lib/events";
import { isPlatform } from "@/lib/people";
import { recordEvent, type EventInput } from "@/lib/track";

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  let body: EventInput;
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
    const personId = await recordEvent(body);
    return NextResponse.json({ ok: "1", person_id: personId });
  } catch (error) {
    console.error("POST /api/event failed:", error);
    return NextResponse.json({ ok: "0", error: errorMessage(error) }, { status: 500 });
  }
}
