"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { AppRole } from "@/lib/auth";
import type { Payment } from "@/lib/payments";
import { PAYMENT_MODES } from "@/lib/payment-domain";
import {
  orderSummary,
  paymentOutstandingById,
  paymentMatchesSearch,
  paymentStatusLabel,
  pendingOrderSummaries,
  sortPayments,
} from "@/lib/payment-settlement";
import { viewerPaymentMetrics } from "@/lib/viewer-payment-metrics";
import {
  PaymentProofViewer,
  type ViewerProof,
} from "@/components/PaymentProofViewer";
import { NotificationCenter } from "@/components/NotificationCenter";
import { normalizePaymentAmountInput } from "@/lib/payment-amount";
import { managementPaymentMetrics } from "@/lib/management-payment-metrics";

type Tab = "all" | "unauthorised" | "pending";
type Order = {
  id: string;
  salesOrderNumber: string;
  customerName: string;
  status: string;
  rawStatus: string;
  orderDate: string;
  orderTotal: number;
  currency: string;
  settlement: { advanceReceived: number; pendingPayment: number; confirmedReceived: number; submittedAmount: number; confirmedOutstanding: number; provisionalOutstanding: number };
};
type Form = {
  salesOrderId: string;
  salesOrderNumber: string;
  customerName: string;
  orderTotal: string;
  paymentAmount: string;
  paymentMode: string;
  remarks: string;
  utrReference: string;
  ownerUserId: string;
  confirmedReceived: string;
  submittedAmount: string;
  provisionalOutstanding: string;
};
type Filters = {
  status: string;
  mode: string;
  salesperson: string;
  from: string;
  to: string;
};
const emptyForm = (): Form => ({
  salesOrderId: "",
  salesOrderNumber: "",
  customerName: "",
  orderTotal: "",
  paymentAmount: "",
  paymentMode: "Bank Transfer",
  remarks: "",
  utrReference: "",
  ownerUserId: "",
  confirmedReceived: "0",
  submittedAmount: "0",
  provisionalOutstanding: "",
});
const emptyFilters: Filters = {
  status: "",
  mode: "",
  salesperson: "",
  from: "",
  to: "",
};
const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);
const salesperson = (p: Payment) => p.salespersonName || (p.addedBy && !/^u[-_]/i.test(p.addedBy) ? p.addedBy : "—");
const date = (v?: string) => {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
  return Number.isNaN(+d) ? v : new Intl.DateTimeFormat("en-GB").format(d);
};
const proofsFor = (p: Payment): ViewerProof[] =>
  (p.attachments || []).map((x, i) => ({
    ...x,
    url: `/api/payments/${encodeURIComponent(p.id)}/proof?index=${i}`,
  }));
export function PaymentsClient({
  initialPayments,
  userRole,
  userId,
  salespeople = [],
}: {
  initialPayments: Payment[];
  userRole: AppRole;
  userId: string;
  salespeople?: { id: string; name: string; username: string }[];
}) {
  const [payments, setPayments] = useState(initialPayments),
    [tab, setTab] = useState<Tab>("all"),
    [search, setSearch] = useState(""),
    [filters, setFilters] = useState<Filters>(emptyFilters),
    [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Payment | null>(null),
    [highlight, setHighlight] = useState<string | null>(null),
    [viewer, setViewer] = useState<ViewerProof[] | null>(null),
    [error, setError] = useState("");
  const [claimError, setClaimError] = useState("");
  const [open, setOpen] = useState(false),
    [paymentType, setPaymentType] = useState<"unauthorised" | "regular">(
      "unauthorised",
    ),
    [claiming, setClaiming] = useState<Payment | null>(null),
    [form, setForm] = useState<Form>(emptyForm),
    [proofs, setProofs] = useState<File[]>([]),
    [saving, setSaving] = useState(false),
    [updating, setUpdating] = useState<string | null>(null),
    [editing, setEditing] = useState<Payment | null>(null),
    [deleting, setDeleting] = useState<Payment | null>(null),
    [deleteReason, setDeleteReason] = useState("");
  const refreshBusy = useRef(false);
  const submitBusy = useRef(false);
  const claimBusy = useRef(false);
  const submissionKey = useRef("");
  const addErrorRef = useRef<HTMLParagraphElement>(null);
  const refresh = useCallback(async () => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    try {
      const r = await fetch("/api/payments", { cache: "no-store" }),
        j = await r.json();
      if (r.ok) setPayments(sortPayments(j.data.payments));
    } finally {
      refreshBusy.current = false;
    }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60000);
    const focus = () => void refresh();
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  useEffect(() => {
    const add = () => startAdd();
    window.addEventListener("payment:add", add);
    return () => window.removeEventListener("payment:add", add);
  });
  useEffect(() => {
    const jump = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (!id) return;
      setTab("all");
      setSearch("");
      setHighlight(id);
      setPayments((current) => {
        setSelected(current.find((p) => p.id === id) || null);
        return current;
      });
      setTimeout(
        () =>
          document
            .querySelector(`[data-payment-id="${CSS.escape(id)}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        100,
      );
      setTimeout(() => setHighlight(null), 2600);
    };
    window.addEventListener("payment:open", jump);
    return () => window.removeEventListener("payment:open", jump);
  }, []);
  useEffect(() => {
    const id = sessionStorage.getItem("openPaymentId");
    if (id) {
      sessionStorage.removeItem("openPaymentId");
      window.dispatchEvent(new CustomEvent("payment:open", { detail: id }));
    }
  }, []);
  const selectTab = useCallback((next: Tab, history: "push" | "replace" | "none" = "push", statusFilter?: string) => {
    setTab(next);
    setFilters((current) => ({ ...current, status: statusFilter ?? (next === "all" ? current.status : "") }));
    if (history !== "none") {
      const url = new URL(window.location.href);
      if (next === "all") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      if (statusFilter) url.searchParams.set("status", statusFilter);
      else if (next !== "all" || statusFilter === "") url.searchParams.delete("status");
      window.history[history === "push" ? "pushState" : "replaceState"]({ paymentTab: next, status: statusFilter || "" }, "", url);
    }
    window.dispatchEvent(new CustomEvent("payment:tab-changed", { detail: next }));
    requestAnimationFrame(() => document.querySelector(".payments-page")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);
  useEffect(() => {
    const fromUrl = (): Tab => {
      const value = new URL(window.location.href).searchParams.get("view");
      if (value === "pending") return "pending";
      if (value === "unauthorised" && userRole !== "Viewer") return "unauthorised";
      return "all";
    };
    const restore = (history: "replace" | "none") => {
      const status = new URL(window.location.href).searchParams.get("status");
      selectTab(fromUrl(), history, status === "Pending" || status === "Payment Received" ? status : "");
    };
    restore("replace");
    const selected = (event: Event) => selectTab((event as CustomEvent<Tab>).detail, "push", "");
    const popped = () => restore("none");
    window.addEventListener("payment:select-tab", selected);
    window.addEventListener("popstate", popped);
    return () => { window.removeEventListener("payment:select-tab", selected); window.removeEventListener("popstate", popped); };
  }, [selectTab, userRole]);
  const pending = useMemo(() => pendingOrderSummaries(payments), [payments]);
  const summaries = useMemo(
    () =>
      new Map(
        payments
          .filter((p) => p.salesOrderNumber)
          .map((p) => [
            p.salesOrderNumber!,
            orderSummary(payments, p.salesOrderNumber!),
          ]),
      ),
    [payments],
  );
  const rowOutstanding = useMemo(() => paymentOutstandingById(payments), [payments]);
  const people = useMemo(
    () => Array.from(new Set(payments.map(salesperson).filter((name) => name !== "—"))).sort(),
    [payments],
  );
  const filtered = useMemo(
    () =>
      sortPayments(
        payments.filter((p) => {
          const s = p.salesOrderNumber
              ? summaries.get(p.salesOrderNumber)
              : undefined,
            q = search.trim().toLowerCase();
          if (q && !paymentMatchesSearch(p, q, payments)) return false;
          if (tab === "unauthorised" && p.status !== "Unauthorised")
            return false;
          if (
            tab === "all" &&
            userRole === "Salesperson" &&
            p.status === "Unauthorised"
          )
            return false;
          if (filters.status && p.status !== filters.status) return false;
          if (filters.mode && p.paymentMode !== filters.mode) return false;
          if (
            filters.salesperson &&
            salesperson(p) !== filters.salesperson
          )
            return false;

          if (
            (filters.from && p.paymentDate < filters.from) ||
            (filters.to && p.paymentDate > filters.to)
          )
            return false;
          return true;
        }),
      ),
    [payments, search, tab, filters, summaries, userRole],
  );
  const counts = {
    all:
      userRole === "Salesperson"
        ? payments.filter((p) => p.status !== "Unauthorised").length
        : payments.length,
    unauthorised: payments.filter((p) => p.status === "Unauthorised").length,
    pending: pending.length,
  };
  const metrics = useMemo(() => viewerPaymentMetrics(payments), [payments]);
  const managementMetrics = useMemo(() => managementPaymentMetrics(payments), [payments]);
  const activeFilters = Object.values(filters).filter(Boolean).length;
  function selectOrder(order: Order, target: "add" | "claim") {
    const outstanding = order.settlement.pendingPayment;
    const value = {
      salesOrderId: order.id,
      salesOrderNumber: order.salesOrderNumber,
      customerName: order.customerName,
      orderTotal: String(order.orderTotal),
      confirmedReceived: String(order.settlement.confirmedReceived),
      submittedAmount: String(order.settlement.advanceReceived),
      provisionalOutstanding: String(outstanding),
    };
    if (target === "add")
      setForm((f) => ({ ...f, ...value, paymentAmount: String(outstanding) }));
    else setForm((f) => ({ ...f, ...value }));
  }
  function startAdd(so?: string) {
    const existing = so
      ? payments.find((p) => p.salesOrderNumber === so)
      : undefined;
    setPaymentType(userRole === "Admin" && !so ? "unauthorised" : "regular");
    setForm(
      existing
        ? {
            ...emptyForm(),
            salesOrderId: existing.salesOrderId || "",
            salesOrderNumber: so!,
            customerName: existing.customerName,
            orderTotal: String(existing.orderTotal || ""),
            paymentAmount: String(
              orderSummary(payments, so!).provisionalOutstanding,
            ),
          }
        : emptyForm(),
    );
    setProofs([]);
    setError("");
    submissionKey.current = crypto.randomUUID();
    setOpen(true);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBusy.current) return;
    submitBusy.current = true;
    setError("");
    if (proofs.length > 5) { submitBusy.current=false; return setError("Attach up to 5 images or PDFs."); }
    if (proofs.some((f) => !f.size || f.size > 10 * 1024 * 1024)) { submitBusy.current=false; return setError("Each proof must be non-empty and no larger than 10 MB."); }
    setSaving(true);
    const body = new FormData();
    body.set("paymentType", userRole === "Accounts" ? "unauthorised" : paymentType);
    Object.entries(form).forEach(([k, v]) => {
      if (k !== "ownerUserId" || userRole === "Admin") body.append(k, v);
    });
    body.set("idempotencyKey", submissionKey.current || (submissionKey.current=crypto.randomUUID()));
    proofs.forEach((f) => body.append("proofs", f));
    let r: Response, j: any;
    try { r=await fetch("/api/payments",{method:"POST",body});j=await r.json().catch(()=>({error:"Could not save payment"})); }
    catch { setSaving(false);submitBusy.current=false;setError("Could not save payment");return; }
    setSaving(false);submitBusy.current=false;
    if(!r.ok){setError(j.error || (r.status===401 ? "Your session has expired. Please log in again." : "Could not save payment. Please try again."));requestAnimationFrame(()=>{addErrorRef.current?.scrollIntoView({block:"nearest"});addErrorRef.current?.focus()});return}
    setPayments((p) => sortPayments([j.data.payment, ...p.filter(x=>x.id!==j.data.payment.id)]));
    setError("");setForm(emptyForm());setProofs([]);submissionKey.current="";setOpen(false);
  }
  async function patch(body: object) {
    const r = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j.error || "Update failed");
      return false;
    }
    setPayments((p) =>
      sortPayments(
        p.map((x) => (x.id === j.data.payment.id ? j.data.payment : x)),
      ),
    );
    return true;
  }
  async function status(
    p: Payment,
    next: "Pending" | "Payment Received" | "Void",
  ) {
    setUpdating(p.id);
    await patch({ id: p.id, status: next });
    setUpdating(null);
  }
  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!claiming || claimBusy.current) return;
    if (!form.salesOrderId) return setClaimError("Select a sales order before claiming this receipt.");
    claimBusy.current = true;
    setClaimError("");
    setSaving(true);
    try {
      const r = await fetch("/api/payments", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "claim",
          id: claiming.id,
          salesOrderId: form.salesOrderId,
          salesOrderNumber: form.salesOrderNumber,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setClaimError(j.error || "Could not claim this receipt. Please try again.");
        return;
      }
      setPayments((current) => sortPayments(current.map((p) => p.id === j.data.payment.id ? j.data.payment : p)));
      setClaiming(null);
      setForm(emptyForm());
    } catch {
      setClaimError("Could not claim this receipt. Check your connection and try again.");
    } finally {
      claimBusy.current = false;
      setSaving(false);
    }
  }
  async function editPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || submitBusy.current) return;
    setError("");
    if (proofs.length > 5) return setError("Attach up to 5 images or PDFs.");
    if (proofs.some((file) => !file.size || file.size > 10 * 1024 * 1024)) return setError("Each proof must be non-empty and no larger than 10 MB.");
    submitBusy.current = true;
    setSaving(true);
    const body = new FormData();
    body.set("id", editing.id);
    body.set("paymentAmount", form.paymentAmount);
    body.set("paymentMode", form.paymentMode);
    body.set("remarks", form.remarks);
    body.set("replaceProofs", String(proofs.length > 0));
    proofs.forEach((f) => body.append("proofs", f));
    try {
      const r = await fetch("/api/payments", { method: "PATCH", body });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error || "Could not edit payment. Please try again.");
        requestAnimationFrame(() => addErrorRef.current?.focus());
        return;
      }
      setPayments((current) => sortPayments(current.map((payment) => payment.id === editing.id ? j.data.payment : payment)));
      setEditing(null);
      setProofs([]);
    } catch {
      setError("Could not edit payment. Check your connection and try again.");
      requestAnimationFrame(() => addErrorRef.current?.focus());
    } finally {
      setSaving(false);
      submitBusy.current = false;
    }
  }
  async function deletePayment() {
    if (!deleting) return;
    setSaving(true);
    const r = await fetch("/api/payments", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: deleting.id, reason: deleteReason }),
      }),
      j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) return setError(j.error || "Could not delete payment");
    setPayments((p) => p.filter((x) => x.id !== deleting.id));
    setDeleting(null);
    setDeleteReason("");
  }
  function beginEdit(p: Payment) {
    setEditing(p);
    setProofs([]);
    setError("");
    setForm({
      ...emptyForm(),
      salesOrderId: p.salesOrderId || "",
      salesOrderNumber: p.salesOrderNumber || "",
      customerName: p.customerName,
      orderTotal: String(p.orderTotal || ""),
      paymentAmount: String(p.paymentAmount),
      paymentMode: p.paymentMode || "Bank Transfer",
      remarks: p.remarks || "",
    });
  }
  const openProof = (p: Payment) => setViewer(proofsFor(p));
  return (
    <section className="payments-page ledger-page">
      <header className="payments-header">
        <div>
          <h1><span className="mobile-heading-copy">Payments</span><span className="sr-only mobile-semantic-heading">Payments</span></h1>
        </div>
        {userRole !== "Viewer" && (
          <div className="payments-toolbar">
            <button
              className="btn red payments-add-button"
              onClick={() => startAdd()}
            >
              {userRole === "Accounts"
                ? "Add unauthorised payment"
                : "Add payment"}
            </button>
            <NotificationCenter />
          </div>
        )}
      </header>
      {userRole === "Viewer" && (
        <div className="viewer-metrics" aria-label="Payment summary">
          {metrics.map((m) => (
            <article className="viewer-metric" key={m.label}>
              <span>{m.label}</span>
              <strong>{money(m.amount)}</strong>
              <small>
                {m.count} {m.count === 1 ? "receipt" : "receipts"}
              </small>
            </article>
          ))}
        </div>
      )}
      {userRole !== "Viewer" && (
        <div className="management-metrics" aria-label="Payment management summary">
          {managementMetrics.map((metric) => {
            const active = metric.key === "received" ? tab === "all" && filters.status === "Payment Received"
              : metric.key === "pending-receipts" ? tab === "all" && filters.status === "Pending"
              : metric.key === "unauthorised" ? tab === "unauthorised"
              : tab === "pending";
            return <button key={metric.key} type="button" className={`management-metric ${active ? "active" : ""}`} aria-pressed={active}
              onClick={() => {
                setSearch("");
                if (metric.key === "received") selectTab("all", "push", "Payment Received");
                else if (metric.key === "pending-receipts") selectTab("all", "push", "Pending");
                else if (metric.key === "unauthorised") selectTab("unauthorised", "push", "");
                else selectTab("pending", "push", "");
              }}>
              <span>{metric.label}</span><strong>{money(metric.amount)}</strong>
            </button>;
          })}
        </div>
      )}
      {userRole !== "Viewer" && (
        <div className="payment-command">
          <label className="payment-search">
            <span className="sr-only">Search payments</span>
            <span className="payment-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <circle cx="11" cy="11" r="6.75" />
                <path d="m16 16 4 4" />
              </svg>
            </span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search SO, company, amount, mode, remarks or added by"
            />
          </label>
          <button
            className={`filter-toggle ${activeFilters ? "active" : ""}`}
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
          >
            Filters {activeFilters > 0 && <b>{activeFilters}</b>}
          </button>
        </div>
      )}
      {userRole !== "Viewer" && filtersOpen && (
        <div className="payment-filters" aria-label="Payment filters">
          <Filter
            label="Status"
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            entries={[
              ["Unauthorised", "Unauthorised"],
              ["Pending", "Payment Pending"],
              ["Payment Received", "Payment Received"],
              ["Void", "Payment Void"],
            ]}
          />
          {userRole !== "Salesperson" && (
            <>
              <Filter
                label="Mode"
                value={filters.mode}
                onChange={(v) => setFilters((f) => ({ ...f, mode: v }))}
                options={[...PAYMENT_MODES]}
              />
              <Filter
                label="Added By"
                value={filters.salesperson}
                onChange={(v) => setFilters((f) => ({ ...f, salesperson: v }))}
                options={people}
              />
            </>
          )}
          <label>
            From
            <input
              type="date"
              value={filters.from}
              onChange={(e) =>
                setFilters((f) => ({ ...f, from: e.target.value }))
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to}
              onChange={(e) =>
                setFilters((f) => ({ ...f, to: e.target.value }))
              }
            />
          </label>
          <button
            className="clear-filters"
            type="button"
            onClick={() => setFilters(emptyFilters)}
          >
            Clear filters
          </button>
        </div>
      )}
      <div className="payment-tabs ledger-tabs" role="tablist">
        {(userRole === "Viewer"
          ? ([
              ["all", "Regular Payments"],
              ["pending", "Pending Payments"],
            ] as const)
          : ([
              ["all", "Regular Payments"],
              ["unauthorised", "Unauthorised Payments"],
              ["pending", "Pending Payments"],
            ] as const)
        ).map(([k, l]) => (
          <button
            id={`tab-${k}`}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "active" : ""}
            onClick={() => selectTab(k)}
            key={k}
          >
            {l}
            <span>{counts[k]}</span>
          </button>
        ))}
      </div>
      {error && !open && !editing && (
        <div className="form-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <div className="results-bar">
        <strong>
          {tab === "pending" ? pending.length : filtered.length} results
        </strong>
        {activeFilters > 0 && <span>{activeFilters} filters applied</span>}
      </div>
      <div className="card payments-card ledger-card">
        {tab === "pending" ? (
          <PendingList orders={pending} role={userRole} onAdd={startAdd} />
        ) : filtered.length ? (
          <>
            <div className="payments-table-wrap">
              <table className="payments-table ledger-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Company / Sales Order</th>
                    <th>Order Total</th>
                    <th>Receipt</th>
                    <th>Outstanding</th>
                    <th>Salesperson</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <DesktopRow
                      key={p.id}
                      p={p}
                      outstanding={rowOutstanding.get(p.id)}
                      summary={
                        p.salesOrderNumber
                          ? summaries.get(p.salesOrderNumber)
                          : undefined
                      }
                      role={userRole}
                      userId={userId}
                      highlight={highlight === p.id}
                      busy={updating === p.id}
                      onOpen={() => setSelected(p)}
                      onStatus={status}
                      onClaim={() => {
                        setClaiming(p);
                        setForm(emptyForm());
                        setClaimError("");
                      }}
                      onProof={() => openProof(p)}
                      onEdit={() => beginEdit(p)}
                      onDelete={() => setDeleting(p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ledger-mobile-list mobile-payment-feed">
              {filtered.map((p) => (
                <MobileCard
                  key={p.id}
                  p={p}
                  outstanding={rowOutstanding.get(p.id)}
                  summary={
                    p.salesOrderNumber
                      ? summaries.get(p.salesOrderNumber)
                      : undefined
                  }
                  role={userRole}
                  userId={userId}
                  highlight={highlight === p.id}
                  busy={updating === p.id}
                  onOpen={() => setSelected(p)}
                  onStatus={status}
                  onClaim={() => {
                    setClaiming(p);
                    setForm(emptyForm());
                    setClaimError("");
                  }}
                  onProof={() => openProof(p)}
                  onEdit={() => beginEdit(p)}
                  onDelete={() => setDeleting(p)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="ledger-empty">
            <strong>No matching payments</strong>
            <span>Adjust the search or filters.</span>
          </div>
        )}
      </div>
      {open && userRole !== "Viewer" && (
        <Sheet
          title="Add payment"
          eyebrow="New receipt"
          close={() => { if(!saving){setOpen(false);setError("");submitBusy.current=false} }}
        >
          <form
            className="payment-form add-payment-form"
            onSubmit={submit}
          >
            <div className="add-payment-form-body add-payment-scroll-body">
            {userRole === "Admin" && (
              <div
                className="payment-type-toggle"
                role="radiogroup"
                aria-label="Payment type"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentType === "unauthorised"}
                  className={paymentType === "unauthorised" ? "active" : ""}
                  onClick={() => {
                    setPaymentType("unauthorised");
                    setForm(emptyForm());
                    setError(""); submissionKey.current=crypto.randomUUID();
                  }}
                >
                  Unauthorised Payment
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={paymentType === "regular"}
                  className={paymentType === "regular" ? "active" : ""}
                  onClick={() => {
                    setPaymentType("regular");
                    setForm(emptyForm());
                    setError(""); submissionKey.current=crypto.randomUUID();
                  }}
                >
                  Regular Payment
                </button>
              </div>
            )}
            {userRole === "Accounts" || paymentType === "unauthorised" ? (
              <>
                <label>
                  UTR / Reference Number
                  <input
                    required
                    maxLength={120}
                    value={form.utrReference}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, utrReference: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Payment Amount
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]+(?:[.][0-9]{1,2})?"
                    autoComplete="off"
                    value={form.paymentAmount}
                    onChange={(e) => {
                      setError("");
                      setForm((f) => ({ ...f, paymentAmount: normalizePaymentAmountInput(e.target.value) }))
                    }}
                  />
                </label>
                <label>
                  Customer Name <small>Optional</small>
                  <input
                    maxLength={120}
                    value={form.customerName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customerName: e.target.value }))
                    }
                  />
                </label>
                <ProofUpload
                  files={proofs}
                  setFiles={setProofs}
                  setError={setError}
                />
              </>
            ) : (
              <>
                <OrderCombobox
                  selected={form.salesOrderId}
                  selectedLabel={
                    form.salesOrderId
                      ? `${form.salesOrderNumber} · ${form.customerName}`
                      : ""
                  }
                  required
                  onSelect={(o) => { setError(""); selectOrder(o, "add"); }}
                  onClear={() => { setError(""); setForm(emptyForm()); }}
                />
                {form.salesOrderId && (
                  <OrderSnapshot form={form} payments={payments} />
                )}
                {userRole === "Admin" && (
                  <label>
                    Salesperson
                    <select
                      required
                      disabled={salespeople.length === 0}
                      value={form.ownerUserId}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, ownerUserId: e.target.value }))
                      }
                    >
                      <option value="">{salespeople.length ? "Select salesperson" : "No active Salespeople available"}</option>
                      {salespeople.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name || u.username}{u.name && u.username ? ` (${u.username})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Payment Received Amount
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    pattern="[0-9]+(?:[.][0-9]{1,2})?"
                    autoComplete="off"
                    max={
                      form.salesOrderNumber
                        ? orderSummary(
                            payments,
                            form.salesOrderNumber,
                            Number(form.orderTotal),
                          ).provisionalOutstanding
                        : undefined
                    }
                    value={form.paymentAmount}
                    onChange={(e) => {
                      setError("");
                      setForm((f) => ({ ...f, paymentAmount: normalizePaymentAmountInput(e.target.value) }))
                    }}
                  />
                </label>
                <label>
                  Payment mode
                  <select
                    required
                    value={form.paymentMode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, paymentMode: e.target.value }))
                    }
                  >
                    {PAYMENT_MODES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <ProofUpload
                  files={proofs}
                  setFiles={setProofs}
                  setError={setError}
                />
                <label>
                  Remarks <small>{form.remarks.length}/500</small>
                  <textarea
                    maxLength={500}
                    rows={3}
                    value={form.remarks}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, remarks: e.target.value }))
                    }
                    placeholder="Optional reconciliation note"
                  />
                </label>
              </>
            )}
            {error && <p ref={addErrorRef} className="add-payment-error" role="alert" tabIndex={-1}>{error}</p>}
            </div>
            <Actions
              busy={saving}
              close={() => { if(!saving){setOpen(false);setError("");submitBusy.current=false} }}
              label={paymentType === "unauthorised" || userRole === "Accounts" ? "Add unauthorised payment" : "Add payment"}
              disabled={userRole === "Admin" && paymentType === "regular" && salespeople.length === 0}
            />
          </form>
        </Sheet>
      )}
      {claiming && (
        <Sheet
          title="Claim receipt"
          eyebrow="Unauthorised receipt"
          close={() => { if (!saving) { setClaiming(null); setClaimError(""); } }}
          variant="claim"
        >
          <form className="payment-form add-payment-form" onSubmit={claim}>
            <div className="add-payment-form-body claim-form-body">
              <div className="claim-receipt-context" aria-label="Receipt to claim">
                <div><span>Receipt amount</span><strong>{money(claiming.paymentAmount)}</strong></div>
                <div><span>UTR / Reference</span><strong>{claiming.utrReference || "Not provided"}</strong></div>
                <div><span>Customer reported</span><strong>{claiming.customerName || "Unidentified customer"}</strong></div>
              </div>
              <p className="claim-help">Choose the sales order this bank receipt settles. Its available balance is checked again when you claim.</p>
              <OrderCombobox
                selected={form.salesOrderId}
                selectedLabel={form.salesOrderId ? `${form.salesOrderNumber} · ${form.customerName}` : ""}
                required
                onSelect={(o) => { setClaimError(""); selectOrder(o, "claim"); }}
                onClear={() => { setForm(emptyForm()); setClaimError(""); }}
              />
              {form.salesOrderId && <OrderSnapshot form={form} />}
              {claimError && <p className="claim-validation" role="alert" tabIndex={-1}>{claimError}</p>}
            </div>
            <Actions
              busy={saving}
              close={() => { setClaiming(null); setClaimError(""); }}
              label="Claim payment"
            />
          </form>
        </Sheet>
      )}
      {selected && (
        <Sheet
          title="Payment details"
          eyebrow={
            selected.salesOrderNumber || selected.utrReference || "Unassigned"
          }
          close={() => setSelected(null)}
        >
          <PaymentDetails
            p={selected}
            summary={
              selected.salesOrderNumber
                ? summaries.get(selected.salesOrderNumber)
                : undefined
            }
            role={userRole}
            busy={updating === selected.id}
            onStatus={status}
            onProof={() => openProof(selected)}
          />
        </Sheet>
      )}
      {editing && (
        <Sheet
          title="Edit payment"
          eyebrow={editing.salesOrderNumber}
          close={() => { if (!saving) { setEditing(null); setError(""); } }}
        >
          <form
            className="payment-form add-payment-form edit-payment-form"
            onSubmit={editPayment}
          >
            <div className="add-payment-form-body add-payment-scroll-body edit-payment-form-body">
            <div className="order-snapshot" aria-label="Immutable payment identity">
              <div>
                <span>Sales order</span>
                <strong>{editing.salesOrderNumber}</strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>{editing.customerName}</strong>
              </div>
              <div>
                <span>Order total</span>
                <strong>{money(editing.orderTotal || 0)}</strong>
              </div>
              <div>
                <span>Owner</span>
                <strong>{salesperson(editing)}</strong>
              </div>
            </div>
            <label>
              Payment amount
              <input
                required
                type="text"
                inputMode="decimal"
                pattern="[0-9]+(?:[.][0-9]{1,2})?"
                autoComplete="off"
                value={form.paymentAmount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, paymentAmount: normalizePaymentAmountInput(e.target.value) }))
                }
              />
            </label>
            <label>
              Payment mode
              <select
                required
                value={form.paymentMode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, paymentMode: e.target.value }))
                }
              >
                {PAYMENT_MODES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Remarks <small>{form.remarks.length}/500</small>
              <textarea
                maxLength={500}
                rows={3}
                value={form.remarks}
                onChange={(e) =>
                  setForm((f) => ({ ...f, remarks: e.target.value }))
                }
              />
            </label>
            <ProofUpload
              files={proofs}
              setFiles={setProofs}
              setError={setError}
            />
            {error && <p ref={addErrorRef} className="add-payment-error" role="alert" tabIndex={-1}>{error}</p>}
            </div>
            <Actions
              busy={saving}
              close={() => { if (!saving) { setEditing(null); setError(""); } }}
              label="Save changes"
            />
          </form>
        </Sheet>
      )}
      {deleting && (
        <Sheet
          title="Delete payment?"
          eyebrow="This cannot be undone"
          close={() => setDeleting(null)}
        >
          <div className="void-confirm">
            <p>
              The receipt, proofs and related notifications will be removed. A
              permanent audit tombstone will remain.
            </p>
            <dl>
              <div>
                <dt>Sales order</dt>
                <dd>{deleting.salesOrderNumber}</dd>
              </div>
              <div>
                <dt>Company</dt>
                <dd>{deleting.customerName}</dd>
              </div>
              <div>
                <dt>Receipt</dt>
                <dd>{money(deleting.paymentAmount)}</dd>
              </div>
            </dl>
            <label>
              Reason (optional)
              <textarea
                maxLength={500}
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                className="btn red"
                disabled={saving}
                onClick={() => void deletePayment()}
              >
                {saving ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {viewer && (
        <PaymentProofViewer proofs={viewer} onClose={() => setViewer(null)} />
      )}
    </section>
  );
}

function Filter({
  label,
  value,
  onChange,
  options = [],
  entries,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options?: string[];
  entries?: [string, string][];
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {entries
          ? entries.map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))
          : options.map((x) => <option key={x}>{x}</option>)}
      </select>
    </label>
  );
}
function OrderCombobox({
  selected,
  selectedLabel,
  required,
  onSelect,
  onClear,
}: {
  selected: string;
  selectedLabel?: string;
  required?: boolean;
  onSelect: (o: Order) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(selectedLabel || ""),
    [orders, setOrders] = useState<Order[]>([]),
    [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [active, setActive] = useState(0),
    [failed, setFailed] = useState(""),
    [feed, setFeed] = useState<{ source: string; updatedAt: string } | null>(null);
  const request = useRef(0),
    root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [geometry, setGeometry] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 240,
  });
  const position = useCallback(() => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const gap = 6,
      below = innerHeight - r.bottom - gap,
      above = r.top - gap,
      maxHeight = Math.max(120, Math.min(280, Math.max(below, above) - 8));
    setGeometry({
      top:
        below >= Math.min(220, above)
          ? r.bottom + gap
          : Math.max(8, r.top - gap - maxHeight),
      left: Math.max(8, Math.min(r.left, innerWidth - r.width - 8)),
      width: Math.min(r.width, innerWidth - 16),
      maxHeight,
    });
  }, []);
  const load = useCallback(async (q: string, refresh = false) => {
    const id = ++request.current;
    setLoading(true);
    setFailed("");
    try {
      const r = await fetch(
          `/api/payments/open-sales-orders?q=${encodeURIComponent(q)}&limit=25${refresh ? "&refresh=1" : ""}`,
          { cache: "no-store" },
        ),
        j = await r.json();
      if (id !== request.current) return;
      if (!r.ok) throw new Error(j.error || "Could not load orders");
      setOrders(j.data.orders);
      setFeed({ source: j.data.source, updatedAt: j.data.updatedAt });
      setActive(0);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : "Could not load orders");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!open || selected) return;
    const t = setTimeout(() => void load(query), query ? 220 : 0);
    return () => clearTimeout(t);
  }, [query, load, open, selected]);
  useEffect(() => {
    if (!open) return;
    position();
    const outside = (e: PointerEvent) => {
      const list = document.getElementById(listId);
      if (
        !root.current?.contains(e.target as Node) &&
        !list?.contains(e.target as Node)
      )
        setOpen(false);
    };
    addEventListener("resize", position);
    addEventListener("scroll", position, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      removeEventListener("resize", position);
      removeEventListener("scroll", position, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open, listId, position]);
  const choose = (o: Order) => {
    ++request.current;
    onSelect(o);
    setQuery(`${o.salesOrderNumber} · ${o.customerName}`);
    setFailed("");
    setOpen(false);
  };
  const reveal = () => {
    if (selected) return;
    setFailed("");
    setOpen(true);
    requestAnimationFrame(position);
  };
  return (
    <div className="order-combobox" ref={root}>
      <label className="combo-label">
        <span className="field-label">
          Sales order {required && <b aria-hidden="true">*</b>}
        </span>
        <div className="combo-input">
          <input
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            required={required}
            value={query}
            placeholder="Search SO number or company"
            onFocus={reveal}
            onClick={reveal}
            onChange={(e) => {
              setQuery(e.target.value);
              if (selected) onClear();
              setFailed("");
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                reveal();
                setActive((a) => Math.min(a + 1, orders.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              }
              if (e.key === "Enter" && open && orders[active]) {
                e.preventDefault();
                choose(orders[active]);
              }
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <button
            type="button"
            aria-label="Clear selected order"
            onClick={() => {
              ++request.current;
              setQuery("");
              onClear();
              setOpen(false);
              setOrders([]);
              setFailed("");
              requestAnimationFrame(() => input.current?.focus());
            }}
            hidden={!selected && !query}
          >
            ×
          </button>
          <button
            type="button"
            aria-label="Refresh sales orders"
            onClick={() => void load(query, true)}
          >
            ↻
          </button>
        </div>
      </label>
      {open &&
        createPortal(
          <div
            id={listId}
            className="combo-options combo-options-portal"
            role="listbox"
            style={{
              position: "fixed",
              top: geometry.top,
              left: geometry.left,
              width: geometry.width,
              maxHeight: geometry.maxHeight,
            }}
          >
            {loading ? (
              <p className="combo-state">Searching orders…</p>
            ) : failed ? (
              <p className="combo-error">{failed}</p>
            ) : orders.length ? (
              <>
              <div className={`combo-feed ${feed?.source === "zoho_live" ? "live" : "fallback"}`} role="status">
                {feed?.source === "zoho_live" ? "Live Zoho Sales Orders" : "Local fallback — not live"}
                {feed?.updatedAt && <time dateTime={feed.updatedAt}> · {date(feed.updatedAt)}</time>}
              </div>
              {orders.map((o, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === o.id}
                  className={i === active ? "active" : ""}
                  key={o.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    choose(o);
                  }}
                >
                  <div className="combo-order-head"><strong>{o.salesOrderNumber}</strong><em className={`order-status-chip ${o.status === "Closed" ? "closed" : o.status === "Open" ? "open" : "unknown"}`}>{o.rawStatus.replace(/[_-]+/g, " ")}</em></div>
                  <span>{o.customerName}</span>
                  <small>
                    {date(o.orderDate)} · {money(o.orderTotal)}
                  </small>
                </button>
              ))}
              </>
            ) : query.trim() ? (
              <p>No matching orders.</p>
            ) : null}
          </div>,
          document.body,
        )}
    </div>
  );
}
function OrderSnapshot({
  form,
  payments,
}: {
  form: Form;
  payments?: Payment[];
}) {
  const local = orderSummary(payments || [], form.salesOrderNumber, Number(form.orderTotal), form.salesOrderId);
  const authoritative = form.provisionalOutstanding !== "";
  const advanceReceived = authoritative ? Number(form.submittedAmount) : local.advanceReceived;
  const pendingPayment = authoritative ? Number(form.provisionalOutstanding) : local.pendingPayment;
  return (
    <div className="order-snapshot">
      <div>
        <span>Customer Name</span>
        <strong>{form.customerName}</strong>
      </div>
      <div>
        <span>Total Amount</span>
        <strong>{money(Number(form.orderTotal))}</strong>
      </div>
      <div>
        <span>Advance Received</span>
        <strong>{money(advanceReceived)}</strong>
      </div>
      <div>
        <span>Pending Payment</span>
        <strong>{money(pendingPayment || 0)}</strong>
      </div>
    </div>
  );
}
function ProofUpload({
  files,
  setFiles,
  setError,
}: {
  files: File[];
  setFiles: (x: File[]) => void;
  setError: (x: string) => void;
}) {
  return (
    <label className="proof-upload">
      <span className="field-label">Proof (optional, up to 5)</span>
      <input
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,application/pdf"
        onChange={(e) => {
          const x = Array.from(e.target.files || []);
          if (
            x.length > 5 ||
            x.some((f) => !f.size || f.size > 10 * 1024 * 1024)
          ) {
            setError("Up to 5 non-empty files, 10 MB each.");
            e.target.value = "";
            setFiles([]);
          } else {
            setError("");
            setFiles(x);
          }
        }}
      />
      <small>Images or PDFs · up to 5 · 10 MB each</small>
      {files.length > 0 && (
        <ul className="proof-file-list">
          {files.map((f, i) => (
            <li key={f.name + i}>
              {f.name}
              <span>{(f.size / 1048576).toFixed(1)} MB</span>
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}
function Actions({
  busy,
  close,
  label,
  disabled = false,
}: {
  busy: boolean;
  close: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="modal-actions">
      <button type="button" className="btn" onClick={close}>
        Cancel
      </button>
      <button type="submit" className="btn red" disabled={busy || disabled} aria-busy={busy}>
        {busy ? "Saving…" : label}
      </button>
    </div>
  );
}
function PaymentDetails({
  p,
  summary: s,
  onProof,
  role,
  busy,
  onStatus,
}: {
  p: Payment;
  summary: any;
  onProof: () => void;
  role: AppRole;
  busy: boolean;
  onStatus: (p: Payment, s: "Pending" | "Payment Received" | "Void") => void;
}) {
  const total = s?.orderTotal ?? p.orderTotal;
  return (
    <div className="payment-details payment-details-modal">
      {role === "Admin" && p.status !== "Unauthorised" && (
        <label className="detail-status">
          Status
          <select
            value={p.status}
            disabled={busy}
            onChange={(e) =>
              onStatus(
                p,
                e.target.value as "Pending" | "Payment Received" | "Void",
              )
            }
          >
            <option value="Pending">Payment Pending</option>
            <option value="Payment Received">Payment Received</option>
            <option value="Void">Payment Void</option>
          </select>
        </label>
      )}
      <section>
        <h3>Order Details</h3>
        <dl>
          <div>
            <dt>Payment Date</dt>
            <dd>{date(p.paymentDate || p.createdAt)}</dd>
          </div>
          <div>
            <dt>Order Date</dt>
            <dd>{date(p.salesOrderDate || s?.salesOrderDate)}</dd>
          </div>
          <div>
            <dt>Sales Order</dt>
            <dd>{p.salesOrderNumber || "Unassigned"}</dd>
          </div>
          <div>
            <dt>Company</dt>
            <dd>{p.customerName}</dd>
          </div>
          <div>
            <dt>Salesperson</dt>
            <dd>{salesperson(p)}</dd>
          </div>
          {p.utrReference && (
            <div>
              <dt>UTR / Reference Number</dt>
              <dd>{p.utrReference}</dd>
            </div>
          )}
        </dl>
      </section>
      <section>
        <h3>Payment Summary</h3>
        <div className="detail-summary">
          <div>
            <span>Order Total</span>
            <strong>{total === undefined ? "—" : money(total)}</strong>
          </div>
          <div>
            <span>Receipt</span>
            <strong>{money(p.paymentAmount)}</strong>
          </div>
          <div>
            <span>Outstanding</span>
            <strong>
              {s?.outstanding === undefined ? "—" : money(s.outstanding)}
            </strong>
          </div>
        </div>
      </section>
      <section>
        <h3>Proofs &amp; Remarks</h3>
        <div className="proof-remarks">
          <div>
            {p.attachments?.length ? (
              <button className="ledger-action" onClick={onProof}>
                View proofs ({p.attachments.length})
              </button>
            ) : (
              <span>No proofs</span>
            )}
          </div>
          <p>{p.remarks || "No remarks"}</p>
        </div>
      </section>
    </div>
  );
}
function StatusControl({
  p,
  role,
  busy,
  onStatus,
  onClaim,
}: {
  p: Payment;
  role: AppRole;
  busy: boolean;
  onStatus: (p: Payment, s: "Pending" | "Payment Received" | "Void") => void;
  onClaim: () => void;
}) {
  const can =
    p.status !== "Unauthorised" && (role === "Accounts" || role === "Admin");
  return can ? (
    <select
      className={`ledger-status-select ${p.status === "Payment Received" ? "received" : ""}`}
      aria-label={`Status for ${p.salesOrderNumber || p.customerName}`}
      value={p.status}
      disabled={busy}
      onChange={(e) => onStatus(p, e.target.value as any)}
    >
      <option value="Pending">Payment Pending</option>
      <option value="Payment Received">Payment Received</option>
      {role === "Admin" && <option value="Void">Payment Void</option>}
    </select>
  ) : p.status === "Unauthorised" && role === "Salesperson" ? (
    <button className="ledger-action" onClick={onClaim}>
      Claim receipt
    </button>
  ) : (
    <span
      className={`ledger-status ${p.status === "Payment Received" ? "received" : p.status === "Void" ? "void" : ""}`}
    >
      {paymentStatusLabel(p.status)}
    </span>
  );
}
function DesktopRow({
  p,
  outstanding,
  summary: s,
  role,
  userId,
  highlight,
  busy,
  onOpen,
  onStatus,
  onClaim,
  onEdit,
  onDelete,
}: any) {
  const activate = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <tr
      data-payment-id={p.id}
      tabIndex={0}
      aria-label={`View payment details for ${p.salesOrderNumber || p.customerName}`}
      className={`payment-data-row ${p.status === "Payment Received" ? "ledger-received-row" : ""} ${highlight ? "payment-highlight" : ""}`}
      onClick={onOpen}
      onKeyDown={activate}
    >
      <td>{date(p.paymentDate || p.createdAt)}</td>
      <td>
        <strong className="payment-company">{p.customerName}</strong>
        <button className="payment-so-link" onClick={onOpen}>
          {p.salesOrderNumber || p.utrReference || "Unassigned"}
        </button>
      </td>
      <td className="money-cell">
        {s?.orderTotal === undefined
          ? p.orderTotal
            ? money(p.orderTotal)
            : "—"
          : money(s.orderTotal)}
      </td>
      <td className="money-cell received-cell">
        <strong>{money(p.paymentAmount)}</strong>
      </td>
      <td className="money-cell">
        {outstanding === undefined ? "—" : money(outstanding)}
      </td>
      <td>{salesperson(p)}</td>
      <td
        className="status-cell"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <StatusControl
          p={p}
          role={role}
          busy={busy}
          onStatus={onStatus}
          onClaim={onClaim}
        />
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <Overflow
          p={p}
          role={role}
          userId={userId}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
}
function MobileCard({
  p,
  outstanding,
  summary: s,
  role,
  userId,
  highlight,
  busy,
  onOpen,
  onStatus,
  onClaim,
  onProof,
  onEdit,
  onDelete,
}: any) {
  const activate = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <article
      data-payment-id={p.id}
      tabIndex={0}
      aria-label={`View payment details for ${p.salesOrderNumber || p.customerName}`}
      className={`ledger-mobile-card payment-data-row ${p.status === "Payment Received" ? "ledger-received-row" : ""} ${highlight ? "payment-highlight" : ""}`}
      onClick={onOpen}
      onKeyDown={activate}
    >
      <header>
        <div>
          <strong className="viewer-card-company">{p.customerName}</strong>
          <span className="mobile-reference">{p.salesOrderNumber ? `SO ${p.salesOrderNumber}` : p.utrReference ? `UTR ${p.utrReference}` : "Unlinked receipt"}</span>
        </div>
        <Overflow
          p={p}
          role={role}
          userId={userId}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </header>
      <div className="viewer-card-meta">
        <span>{date(p.paymentDate || p.createdAt)}</span>
        <span>{p.paymentMode || (p.utrReference ? `UTR ${p.utrReference}` : "Payment")}</span>
      </div>
      <dl>
        <div>
          <dt>{s ? "Order total" : "Reference"}</dt>
          <dd>
            {s?.orderTotal === undefined
              ? p.orderTotal
                ? money(p.orderTotal)
                : p.utrReference || "Not linked"
              : money(s.orderTotal)}
          </dd>
        </div>
        <div>
          <dt>Receipt</dt>
          <dd>{money(p.paymentAmount)}</dd>
        </div>
        <div>
          <dt>Outstanding</dt>
          <dd>
            {outstanding === undefined ? "—" : money(outstanding)}
          </dd>
        </div>
      </dl>
      <div
        className="payment-mobile-controls"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {p.attachments?.length ? (
          <button className="payment-proof-button" onClick={onProof}>
            View proof
            {p.attachments.length > 1 ? ` (${p.attachments.length})` : ""}
          </button>
        ) : (
          <span className="payment-no-proof">—</span>
        )}
        <StatusControl
          p={p}
          role={role}
          busy={busy}
          onStatus={onStatus}
          onClaim={onClaim}
        />
      </div>
    </article>
  );
}
function Overflow({
  p,
  role,
  userId,
  onEdit,
  onDelete,
}: {
  p: Payment;
  role: AppRole;
  userId: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ top: 0, left: 0 });
  const position = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const width = 144,
      height = 98,
      gap = 5;
    setGeometry({
      left: Math.max(8, Math.min(innerWidth - width - 8, r.right - width)),
      top:
        r.bottom + gap + height <= innerHeight - 8
          ? r.bottom + gap
          : Math.max(8, r.top - gap - height),
    });
  }, []);
  const allowed =
    (role === "Admin" && !p.ownerUserId && p.createdBy === userId) ||
    (role === "Salesperson" &&
      p.status === "Pending" &&
      (p.ownerUserId === userId ||
        p.claimedBy === userId ||
        p.createdBy === userId));
  useEffect(() => {
    if (!open) return;
    position();
    const close = (e: PointerEvent) => {
        if (
          !ref.current?.contains(e.target as Node) &&
          !menu.current?.contains(e.target as Node)
        ) {
          setOpen(false);
          trigger.current?.focus();
        }
      },
      key = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    addEventListener("resize", position);
    addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
      removeEventListener("resize", position);
      removeEventListener("scroll", position, true);
    };
  }, [open, position]);
  if (!allowed) return null;
  return (
    <div
      className="payment-overflow"
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={trigger}
        className="payment-overflow-trigger"
        aria-label={`Actions for ${p.salesOrderNumber || p.customerName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            className="payment-overflow-menu payment-overflow-menu-portal"
            role="menu"
            style={{
              position: "fixed",
              top: geometry.top,
              left: geometry.left,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              Edit
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
function PendingList({
  orders,
  role,
  onAdd,
}: {
  orders: any[];
  role: AppRole;
  onAdd: (s: string) => void;
}) {
  if (!orders.length)
    return (
      <div className="ledger-empty">
        <strong>No outstanding orders</strong>
        <span>Fully settled orders leave this view automatically.</span>
      </div>
    );
  return (
    <div className="pending-grid">
      {orders.map((s) => (
        <article className="pending-card" key={s.salesOrderNumber}>
          <header>
            <strong>{s.salesOrderNumber}</strong>
            <span>{s.outstandingPercent}% outstanding</span>
          </header>
          <h2>{s.customerName}</h2>
          <Progress value={s.receivedPercent} />
          <dl>
            <div>
              <dt>Received</dt>
              <dd>{money(s.received)}</dd>
            </div>
            <div>
              <dt>Order total</dt>
              <dd>{money(s.orderTotal)}</dd>
            </div>
            <div>
              <dt>Outstanding</dt>
              <dd>{money(s.outstanding)}</dd>
            </div>
          </dl>
          {role !== "Accounts" && role !== "Viewer" && (
            <button
              className="ledger-action"
              onClick={() => onAdd(s.salesOrderNumber)}
            >
              Add payment
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <div className="ledger-progress-wrap">
      <div
        className="ledger-progress"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${value}%` }} />
      </div>
      <span>{value}% received</span>
    </div>
  );
}
function Sheet({
  title,
  eyebrow,
  close,
  children,
  variant,
}: {
  title: string;
  eyebrow?: string;
  close: () => void;
  children: React.ReactNode;
  variant?: "claim";
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const prior = document.body.style.overflow,
      previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab" && ref.current) {
        const a = Array.from(
          ref.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
          ),
        );
        if (!a.length) return;
        const first = a[0],
          last = a[a.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = prior;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="modal-backdrop add-payment-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        className={`card payment-modal ledger-modal add-payment-modal ${variant === "claim" ? "claim-payment-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2>{title}</h2>
          </div>
          <button onClick={close} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
