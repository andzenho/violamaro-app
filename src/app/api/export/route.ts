import { NextResponse } from "next/server";
import { isAuthorized, unauthorizedResponse } from "@/lib/auth";
import { errorMessage } from "@/lib/error";
import { ForeignDataError, runExport } from "@/lib/export/run";

/* Тысячи строк из базы плюс полдесятка вызовов Google в десять секунд по
   умолчанию не укладываются. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* Расписание Vercel умеет только GET и своих заголовков не ставит: наш
   X-Api-Key ему передать нечем. Зато он сам шлёт Authorization с
   CRON_SECRET — по нему крон и опознаём. Ключ для людей и ключ для
   расписания намеренно разные: отзыв одного не задевает другое. */
function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(force: boolean) {
  try {
    const result = await runExport(force);
    return NextResponse.json({
      ok: "1",
      predzapisLeads: String(result.predzapisLeads),
      peLeads: String(result.peLeads),
      empat: String(result.empat),
      koleso: String(result.koleso),
      events: String(result.events),
      people: String(result.people),
    });
  } catch (error) {
    if (error instanceof ForeignDataError) {
      /* 409, а не 500: с нашей стороны всё исправно, просто в таблице лежит
         чужое. Отдельный код нужен, чтобы это не потерялось среди обычных
         сбоев — здесь требуется решение человека, а не повторный вызов. */
      console.error("/api/export остановлен:", error.message);
      return NextResponse.json({ ok: "0", error: error.message, sheets: error.sheets }, { status: 409 });
    }
    console.error("/api/export failed:", error);
    return NextResponse.json({ ok: "0", error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  /* force затирает даже непустую чужую таблицу, поэтому доступен только
     человеку с ключом. Крону его не выдаём: расписание, молча стирающее
     чужую работу раз в пятнадцать минут, — это авария, а не удобство. */
  const force = new URL(request.url).searchParams.get("force") === "1";
  return run(force);
}

export async function GET(request: Request) {
  if (!isCron(request)) return unauthorizedResponse();
  return run(false);
}
