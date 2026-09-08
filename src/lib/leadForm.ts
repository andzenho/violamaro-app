/* Заявка бывает по смыслу двух видов, и путать их нельзя: анкета
   предзаписи на практикум — это «оставьте контакт, напишем, когда откроем
   набор», а заявка на «Прикладную эмпатию» — человек уже выбрал тариф и
   готов платить. Различаются они полем form в payload события lead. */

export const FORM_TYPES = ["predzapis", "pe"] as const;

export type LeadFormType = (typeof FORM_TYPES)[number];

export function isLeadFormType(value: unknown): value is LeadFormType {
  return typeof value === "string" && (FORM_TYPES as readonly string[]).includes(value);
}

/* Поля может не быть вовсе — так выглядят все заявки, накопленные тестом
   до того, как оно появилось. Для них и для любой другой заявки без формы
   считаем predzapis: это тот же практикум, просто без явной метки. */
export function leadForm(payload: Record<string, unknown> | null | undefined): LeadFormType {
  const value = payload?.form;
  return isLeadFormType(value) ? value : "predzapis";
}
