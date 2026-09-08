import { NextResponse } from "next/server";
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
    return NextResponse.json(
      { ok: false, error: String(error) },
      { status: 500 }
    );
  }
}
