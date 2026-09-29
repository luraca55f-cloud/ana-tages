import { BriefcaseBusiness, CalendarClock, CheckCircle2, CircleDollarSign, Pencil, Plus, ReceiptText, Search, Trash2, TrendingDown, TrendingUp, WalletCards, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { createServiceWorkEntry, deleteServiceWorkEntry, listServiceWorkEntries, markServiceWorkPaid, updateServiceWorkEntry } from "./repository";
import type { ServiceWorkEntry, ServiceWorkEntryInput, ServiceWorkKind, ServiceWorkPaymentMethod, ServiceWorkStatus } from "./types";

const paymentLabels: Record<ServiceWorkPaymentMethod, string> = {
  pix: "Pix",
  bank_transfer: "Transferência",
  cash: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  other: "Outro",
};

function isoDateLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function monthBounds(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const now = new Date();
  const year = Number(match?.[1] ?? now.getFullYear());
  const monthNumber = Number(match?.[2] ?? (now.getMonth() + 1));
  const start = `${year}-${String(monthNumber).padStart(2, "0")}-01`;
  const next = new Date(year, monthNumber, 1);
  const end = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(`${value}T12:00:00`));
}

function ServiceMetric({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <div className="dashboard-card rounded-2xl p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 font-display text-xl">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{note}</p></div><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary">{icon}</span></div></div>;
}

function EntryModal({ entry, onClose, onSaved }: { entry: ServiceWorkEntry | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<ServiceWorkKind>(entry?.kind ?? "income");
  const [clientName, setClientName] = useState(entry?.client_name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(String(entry?.amount ?? ""));
  const [dueDate, setDueDate] = useState(entry?.due_date ?? isoDateLocal());
  const [status, setStatus] = useState<ServiceWorkStatus>(entry?.status ?? "pending");
  const [paidAt, setPaidAt] = useState(entry?.paid_at ?? isoDateLocal());
  const [paymentMethod, setPaymentMethod] = useState<ServiceWorkPaymentMethod | "">(entry?.payment_method ?? "pix");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const numericAmount = Number(amount.replace(",", "."));
    if (!description.trim()) { setError("Informe a descrição do lançamento."); return; }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setError("Informe um valor válido."); return; }
    if (!dueDate) { setError("Informe a data/vencimento."); return; }
    setSaving(true); setError("");
    const payload: ServiceWorkEntryInput = {
      kind,
      client_name: kind === "income" ? clientName.trim() || null : null,
      description: description.trim(),
      amount: numericAmount,
      due_date: dueDate,
      status,
      paid_at: status === "paid" ? paidAt : null,
      payment_method: status === "paid" && paymentMethod ? paymentMethod : null,
      notes: notes.trim() || null,
    };
    try {
      if (entry) await updateServiceWorkEntry(entry.id, payload);
      else await createServiceWorkEntry(payload);
      await onSaved();
      onClose();
    } catch (cause) {
      console.error(cause);
      setError("Não foi possível salvar o lançamento de prestação de serviço.");
    } finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[70] grid place-items-center bg-foreground/25 p-4 backdrop-blur-sm"><section className="dashboard-card max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl p-6 sm:p-7"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-2xl">{entry ? "Editar lançamento" : "Novo lançamento"}</h2><p className="mt-1 text-xs text-muted-foreground">Exclusivo do módulo Prestação de Serviço.</p></div><Button variant="ghost" size="icon" onClick={onClose}><X /></Button></div>
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Tipo</span><select value={kind} onChange={(e) => setKind(e.target.value as ServiceWorkKind)} className="input-finance"><option value="income">Receita</option><option value="expense">Despesa</option></select></label>
      {kind === "income" && <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Cliente</span><input value={clientName} onChange={(e) => setClientName(e.target.value)} className="input-finance" placeholder="Nome do cliente" /></label>}
      <label className={kind === "expense" ? "sm:col-span-2" : "sm:col-span-2"}><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Descrição</span><input value={description} onChange={(e) => setDescription(e.target.value)} className="input-finance" placeholder="Ex.: consultoria, projeto, deslocamento" /></label>
      <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Valor</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-finance" placeholder="0,00" /></label>
      <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Data / vencimento</span><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-finance" /></label>
      <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Situação</span><select value={status} onChange={(e) => setStatus(e.target.value as ServiceWorkStatus)} className="input-finance"><option value="pending">Pendente</option><option value="paid">{kind === "income" ? "Recebida" : "Paga"}</option><option value="cancelled">Cancelada</option></select></label>
      {status === "paid" && <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Data do pagamento</span><input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="input-finance" /></label>}
      {status === "paid" && <label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Forma de pagamento</span><select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as ServiceWorkPaymentMethod)} className="input-finance"><option value="pix">Pix</option><option value="bank_transfer">Transferência</option><option value="cash">Dinheiro</option><option value="credit_card">Cartão de crédito</option><option value="debit_card">Cartão de débito</option><option value="other">Outro</option></select></label>}
      <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Observação</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-24 w-full rounded-xl border border-border bg-background/70 p-3 text-sm outline-none" /></label>
    </div>
    {error && <p className="mt-4 text-xs text-destructive">{error}</p>}
    <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" disabled={saving} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar"}</Button></div>
  </section></div>;
}

export function ServiceWorkPage() {
  const [month, setMonth] = useState(isoDateLocal().slice(0, 7));
  const [entries, setEntries] = useState<ServiceWorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ServiceWorkStatus>("all");
  const [editing, setEditing] = useState<ServiceWorkEntry | "new" | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(false);
    const { start, end } = monthBounds(month);
    try { setEntries(await listServiceWorkEntries(start, end)); }
    catch (cause) { console.error(cause); setError(true); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { void reload(); }, [reload]);

  const active = entries.filter((entry) => entry.status !== "cancelled");
  const billed = active.filter((entry) => entry.kind === "income").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const received = active.filter((entry) => entry.kind === "income" && entry.status === "paid").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const receivable = active.filter((entry) => entry.kind === "income" && entry.status === "pending").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expenses = active.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const paidExpenses = active.filter((entry) => entry.kind === "expense" && entry.status === "paid").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const cashProfit = received - paidExpenses;
  const projectedProfit = billed - expenses;

  const filtered = useMemo(() => entries.filter((entry) => {
    const search = query.trim().toLocaleLowerCase("pt-BR");
    const matchesQuery = !search || `${entry.client_name ?? ""} ${entry.description}`.toLocaleLowerCase("pt-BR").includes(search);
    const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
    return matchesQuery && matchesStatus;
  }), [entries, query, statusFilter]);

  const markPaid = async (entry: ServiceWorkEntry) => {
    try { await markServiceWorkPaid(entry.id, isoDateLocal(), entry.payment_method ?? "pix"); await reload(); }
    catch (cause) { console.error(cause); alert("Não foi possível registrar o pagamento."); }
  };

  return <>
    <section className="animate-rise flex flex-wrap items-end justify-between gap-4 pb-5"><div><div className="flex items-center gap-2"><span className="grid size-10 place-items-center rounded-2xl bg-primary text-primary-foreground"><BriefcaseBusiness className="size-5" /></span><div><h1 className="font-display text-3xl leading-tight">Prestação de Serviço</h1><p className="mt-1 text-sm text-muted-foreground">Controle financeiro separado do consultório. Nada lançado aqui interfere nos demais módulos.</p></div></div></div><div className="flex flex-wrap gap-2"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs" /><Button variant="dashboard" onClick={() => setEditing("new")}><Plus /> Novo lançamento</Button></div></section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <ServiceMetric label="Faturado" value={money(billed)} note="receitas do período" icon={<CircleDollarSign className="size-4" />} />
      <ServiceMetric label="Recebido" value={money(received)} note="entradas confirmadas" icon={<TrendingUp className="size-4" />} />
      <ServiceMetric label="A receber" value={money(receivable)} note="receitas pendentes" icon={<CalendarClock className="size-4" />} />
      <ServiceMetric label="Despesas" value={money(expenses)} note="saídas do período" icon={<TrendingDown className="size-4" />} />
      <ServiceMetric label="Lucro de caixa" value={money(cashProfit)} note="recebido − despesas pagas" icon={<WalletCards className="size-4" />} />
      <ServiceMetric label="Resultado previsto" value={money(projectedProfit)} note="faturado − despesas" icon={<ReceiptText className="size-4" />} />
    </section>

    <section className="dashboard-card mt-4 rounded-3xl p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg">Lançamentos</h2><p className="mt-1 text-[11px] text-muted-foreground">Receitas e despesas exclusivas desta atividade.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cliente ou descrição" className="h-10 w-56 rounded-xl border border-border bg-background/60 pl-9 pr-3 text-xs outline-none" /></label><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | ServiceWorkStatus)} className="h-10 rounded-xl border border-border bg-background/60 px-3 text-xs"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="paid">Pagos/recebidos</option><option value="cancelled">Cancelados</option></select></div></div>
      {error && <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">Não foi possível carregar a Prestação de Serviço. Confira se o SQL desta versão foi executado.</div>}
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3">Data</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3">Cliente / descrição</th><th className="px-3 py-3">Situação</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3 text-right">Ações</th></tr></thead><tbody>{filtered.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs">{dateLabel(entry.due_date)}</td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${entry.kind === "income" ? "bg-primary/8 text-primary" : "bg-destructive/8 text-destructive"}`}>{entry.kind === "income" ? "Receita" : "Despesa"}</span></td><td className="px-3 py-4"><p className="text-xs font-medium">{entry.client_name || entry.description}</p>{entry.client_name && <p className="mt-1 text-[10px] text-muted-foreground">{entry.description}</p>}</td><td className="px-3 py-4 text-xs">{entry.status === "paid" ? (entry.kind === "income" ? "Recebida" : "Paga") : entry.status === "pending" ? "Pendente" : "Cancelada"}{entry.status === "paid" && entry.payment_method ? <span className="ml-1 text-[10px] text-muted-foreground">• {paymentLabels[entry.payment_method]}</span> : null}</td><td className={`px-3 py-4 text-xs font-semibold ${entry.kind === "income" ? "text-primary" : "text-destructive"}`}>{money(entry.amount)}</td><td className="px-3 py-4"><div className="flex justify-end gap-1">{entry.status === "pending" && <Button variant="quiet" size="sm" onClick={() => void markPaid(entry)}><CheckCircle2 /> {entry.kind === "income" ? "Receber" : "Pagar"}</Button>}<Button variant="ghost" size="icon" onClick={() => setEditing(entry)}><Pencil /></Button><Button variant="ghost" size="icon" onClick={async () => { if (confirm("Excluir este lançamento de Prestação de Serviço?")) { await deleteServiceWorkEntry(entry.id); await reload(); } }}><Trash2 /></Button></div></td></tr>)}</tbody></table>{!loading && filtered.length === 0 && <div className="py-12 text-center text-xs text-muted-foreground">Nenhum lançamento neste período.</div>}{loading && <div className="py-12 text-center text-xs text-muted-foreground">Carregando...</div>}</div>
    </section>

    {editing && <EntryModal entry={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />}
  </>;
}
