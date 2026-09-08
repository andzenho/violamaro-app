import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/error";
import { getSupabase } from "@/lib/supabase";

export async function GET() {
  try {
    const { error } = await getSupabase().auth.admin.listUsers({
      perPage: 1,
    });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      db: "1",
      time: new Date().toISOString(),
      version: "1",
    });
  } catch (error) {
    console.error("GET /api/health failed:", error);
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
