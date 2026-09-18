/** Keeps a currency field editable while excluding values the API must reject. */
export function normalizePaymentAmountInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  const integer = (dot < 0 ? cleaned : cleaned.slice(0, dot)).slice(0, 10);
  if (dot < 0) return integer;
  const fraction = cleaned.slice(dot + 1).replaceAll(".", "").slice(0, 2);
  return `${integer || "0"}.${fraction}`;
}

export function isValidPaymentAmount(value: string): boolean {
  return /^\d{1,10}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
}
