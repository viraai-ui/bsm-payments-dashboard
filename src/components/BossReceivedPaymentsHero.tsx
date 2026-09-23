"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Payment } from "@/lib/payments";
import { receivedPaymentsByPeriod, type ReceivedPeriod } from "@/lib/viewer-payment-metrics";

const PERIODS: ReceivedPeriod[] = ["day", "week", "month"];
const PERIOD_NAMES: Record<ReceivedPeriod, string> = { day: "Day", week: "Week", month: "Month" };
const LABELS: Record<ReceivedPeriod, string> = {
  day: "Payments added today",
  week: "Payments added this week",
  month: "Payments added this month",
};
const money = (paise: number) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 0,
}).format(paise / 100);
const shortDate = (date: Date) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);

export function BossReceivedPaymentsHero({ payments }: { payments: Payment[] }) {
  const [period, setPeriod] = useState<ReceivedPeriod>("day");
  const [now, setNow] = useState(() => new Date());
  const refreshClock = useCallback(() => setNow(new Date()), []);

  useEffect(() => {
    let timer = 0;
    const scheduleMidnight = () => {
      window.clearTimeout(timer);
      const current = new Date();
      const next = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = window.setTimeout(() => { refreshClock(); scheduleMidnight(); }, Math.max(1, +next - +current + 50));
    };
    const onVisibility = () => { if (document.visibilityState === "visible") { refreshClock(); scheduleMidnight(); } };
    scheduleMidnight();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refreshClock]);

  const metric = useMemo(() => receivedPaymentsByPeriod(payments, period, now), [payments, period, now]);
  const support = period === "day"
    ? new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" }).format(now)
    : `${shortDate(metric.start)} – ${shortDate(now)}`;

  return <section className="boss-received-hero" aria-labelledby="boss-received-title">
    <div className="boss-received-glow" aria-hidden="true" />
    <div id="boss-received-panel" role="tabpanel" aria-live="polite" aria-labelledby={`boss-period-${period}`}>
      <p id="boss-received-title">{LABELS[period]}</p>
      <strong className="boss-received-amount">{money(metric.amountPaise)}</strong>
      <div className="boss-received-support">
        <span>{metric.count} {metric.count === 1 ? "receipt" : "receipts"}</span><i aria-hidden="true" />
        <time dateTime={now.toISOString().slice(0, 10)}>{support}</time>
      </div>
    </div>
    <div className="boss-period-tabs" role="tablist" aria-label="Payments added period">
      {PERIODS.map(item => <button key={item} id={`boss-period-${item}`} type="button" role="tab"
        aria-selected={period === item} aria-controls="boss-received-panel" tabIndex={period === item ? 0 : -1}
        onClick={() => setPeriod(item)}>{PERIOD_NAMES[item]}</button>)}
    </div>
  </section>;
}
