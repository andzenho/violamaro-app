import type { NextConfig } from "next";

/* Тесты «Эмпат ли вы» и «Колесо эмпата» — готовые однофайловые страницы,
   которые лежат в public/legacy. Отдаём их по человеческим адресам
   /test/empat и /test/koleso; параметры ?k=…&src=… при rewrite сохраняются.
   Обратный редирект нужен, чтобы у каждой страницы был ровно один адрес:
   иначе тот же тест открывался бы ещё и как /legacy/empat.html. */
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/test/empat", destination: "/legacy/empat.html" },
      { source: "/test/koleso", destination: "/legacy/koleso.html" },
    ];
  },
  async redirects() {
    return [
      { source: "/legacy/empat.html", destination: "/test/empat", permanent: true },
      { source: "/legacy/koleso.html", destination: "/test/koleso", permanent: true },
    ];
  },
};

export default nextConfig;
