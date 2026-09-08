import { NextResponse } from "next/server";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { errorMessage } from "@/lib/error";
import { getSupabase } from "@/lib/supabase";

function flag(hasRows: boolean): "1" | "0" {
  return hasRows ? "1" : "0";
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const platform = searchParams.get("platform");
  const platformUserId = searchParams.get("platform_user_id");
  const test = searchParams.get("test");

  if (!platform || !platformUserId || !test) {
    return NextResponse.json(
      { ok: "0", error: "platform, platform_user_id and test are required" },
      { status: 400 }
    );
  }

  try {
    const supabase = getSupabase();

    const { data: person, error: personError } = await supabase
      .from("people")
      .select("id")
      .eq("platform", platform)
      .eq("platform_user_id", platformUserId)
      .maybeSingle();
    if (personError) throw personError;

    if (!person) {
      return NextResponse.json({
        ok: "1",
        found: "0",
        test_open: "0",
        test_done: "0",
        lead: "0",
        lead_any: "0",
      });
    }

    const [openResult, doneResult, leadResult, leadAnyResult] = await Promise.all([
      supabase
        .from("events")
        .select("id")
        .eq("person_id", person.id)
        .eq("type", "test_open")
        .eq("test", test)
        .limit(1),
      supabase
        .from("events")
        .select("payload, created_at")
        .eq("person_id", person.id)
        .eq("type", "test_done")
        .eq("test", test)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("events")
        .select("id")
        .eq("person_id", person.id)
        .eq("type", "lead")
        .eq("test", test)
        .limit(1),
      supabase.from("events").select("id").eq("person_id", person.id).eq("type", "lead").limit(1),
    ]);

    if (openResult.error) throw openResult.error;
    if (doneResult.error) throw doneResult.error;
    if (leadResult.error) throw leadResult.error;
    if (leadAnyResult.error) throw leadAnyResult.error;

    const lastDone = doneResult.data?.[0] as { payload: Record<string, unknown> | null; created_at: string } | undefined;
    const payload = lastDone?.payload ?? {};

    return NextResponse.json({
      ok: "1",
      found: "1",
      test_open: flag((openResult.data?.length ?? 0) > 0),
      test_done: flag(Boolean(lastDone)),
      lead: flag((leadResult.data?.length ?? 0) > 0),
      lead_any: flag((leadAnyResult.data?.length ?? 0) > 0),
      rank: lastDone && payload.rank != null ? String(payload.rank) : "",
      percent: lastDone && payload.percent != null ? String(payload.percent) : "",
      test_date: lastDone ? lastDone.created_at.slice(0, 10) : "",
    });
  } catch (error) {
    console.error("GET /api/status failed:", error);
    return NextResponse.json({ ok: "0", error: errorMessage(error) }, { status: 500 });
  }
}
