import { NextResponse } from "next/server";

export function isAuthorized(request: Request): boolean {
  const key = request.headers.get("x-api-key");
  const secret = process.env.API_SECRET;
  return Boolean(secret) && key === secret;
}

export function unauthorizedResponse() {
  return NextResponse.json({ ok: "0", error: "unauthorized" }, { status: 401 });
}
