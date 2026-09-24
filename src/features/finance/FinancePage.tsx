import {
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Plus,
  Pencil,
  ReceiptText,
  RefreshCw,
  Stethoscope,
  Trash2,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { isSupabaseConfigured } from "../../lib/supabase";
import { createExpense, createRevenue, deleteExpense, generatePackageBillingsForMonth, loadFinanceBundle, markExpensePaid, markRevenuePaid, updateExpense, updatePatientBilling } from "./repository";
import type { BillingEntry, ExpenseEntry, FinanceBundle, PatientBilling, RevenueSource } from "./types";

const sourceLabels: Record<RevenueSource, string> = {
  session: "Atendimento",
  package: "Pacote de sessões",
  company: "Empresa",
  psychological_test: "Teste psicológico",
  neuropsychology: "Neuropsicologia",
  other: "Outro faturamento",
};

const expenseLabels: Record<string, string> = {
  transporte: "Transporte",
  contador_inss: "Contador / INSS",
  aluguel: "Aluguel",
  condominio: "Condomínio",
  faxina: "Faxina",
  internet: "Internet",
  outros_fixos: "Outros fixos",
  outros: "Outros gastos",
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function isoToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function currentMonth() {
  return isoToday().slice(0, 7);
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function outstanding(entry: BillingEntry) {
  return Math.max(0, Number(entry.amount) - Number(entry.received_amount || 0));
}

function emptyBundle(): FinanceBundle {
  return { billed: [], receivedInPeriod: [], receivables: [], expenses: [], patients: [] };
}

export function FinanceDashboardMetrics() {
  const [data, setData] = useState<FinanceBundle>(emptyBundle);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    generatePackageBillingsForMonth(currentMonth()).then(() => loadFinanceBundle(currentMonth())).then(setData).catch((error) => console.error(error));
  }, []);

  const billed = data.billed.reduce((sum, item) => sum + Number(item.amount), 0);
  const received = data.receivedInPeriod.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
  const receivable = data.receivables.reduce((sum, item) => sum + outstanding(item), 0);
  const expenses = data.expenses.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <section aria-label="Indicadores financeiros" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Faturado no mês" value={money(billed)} note="atendimentos + outros serviços" icon={<CircleDollarSign />} />
      <Metric label="Recebido no mês" value={money(received)} note="entradas efetivamente recebidas" icon={<TrendingUp />} />
      <Metric label="Carteira a receber" value={money(receivable)} note={`${data.receivables.length} cobrança(s) em aberto`} icon={<Clock3 />} />
      <Metric label="Despesas no mês" value={money(expenses)} note={`resultado de caixa: ${money(received - expenses)}`} icon={<TrendingDown />} />
    </section>
  );
}

export function FinancePage() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<FinanceBundle>(emptyBundle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"revenue" | "expense" | null>(null);
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null);
  const [editingPatient, setEditingPatient] = useState<PatientBilling | null>(null);
  const [tab, setTab] = useState<"overview" | "receivables" | "expenses" | "billing">("overview");

  const reload = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError("");
    try {
      await generatePackageBillingsForMonth(month);
      setData(await loadFinanceBundle(month));
    } catch (loadError) {
      console.error(loadError);
      setError("Não foi possível carregar os dados financeiros.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isSupabaseConfigured) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const summary = useMemo(() => {
    const billed = data.billed.reduce((sum, item) => sum + Number(item.amount), 0);
    const appointments = data.billed.filter((item) => item.source_type === "session" || item.source_type === "package").reduce((sum, item) => sum + Number(item.amount), 0);
    const otherBilling = billed - appointments;
    const received = data.receivedInPeriod.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
    const receivable = data.receivables.reduce((sum, item) => sum + outstanding(item), 0);
    const expenses = data.expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const result = received - expenses;
    const expenseVsBilled = billed > 0 ? (expenses / billed) * 100 : 0;
    return { billed, appointments, otherBilling, received, receivable, expenses, result, expenseVsBilled };
  }, [data]);

  const sourceBreakdown = useMemo(() => {
    return (Object.keys(sourceLabels) as RevenueSource[]).map((source) => ({
      source,
      value: data.billed.filter((item) => item.source_type === source).reduce((sum, item) => sum + Number(item.amount), 0),
    })).filter((item) => item.value > 0);
  }, [data.billed]);

  const expenseBreakdown = useMemo(() => {
    const grouped = new Map<string, number>();
    data.expenses.forEach((item) => grouped.set(item.category, (grouped.get(item.category) ?? 0) + Number(item.amount)));
    return Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
  }, [data.expenses]);

  const saveRevenue = async (entry: Omit<BillingEntry, "id" | "received_amount" | "received_at">, clientRequestId: string) => {
    if (!isSupabaseConfigured) throw new Error("Supabase não configurado");
    await createRevenue({
      source_type: entry.source_type,
      client_name: entry.client_name,
      description: entry.description,
      competence_date: entry.competence_date,
      issued_at: entry.issued_at,
      due_date: entry.due_date,
      amount: entry.amount,
      status: entry.status === "paid" ? "paid" : "pending",
      client_request_id: clientRequestId,
    });
    await reload();
  };

  const saveExpense = async (entry: Omit<ExpenseEntry, "id" | "paid_at">, clientRequestId: string) => {
    if (!isSupabaseConfigured) throw new Error("Supabase não configurado");
    if (editingExpense) {
      await updateExpense({
        id: editingExpense.id,
        category: entry.category,
        description: entry.description,
        competence_date: entry.competence_date,
        due_date: entry.due_date,
        amount: entry.amount,
        recurrence: entry.recurrence,
        status: entry.status,
      });
      setEditingExpense(null);
    } else {
      await createExpense({ ...entry, client_request_id: clientRequestId });
    }
    await reload();
  };

  const receive = async (entry: BillingEntry) => {
    const amount = outstanding(entry);
    if (amount <= 0 || !isSupabaseConfigured) return;
    setError("");
    try {
      await markRevenuePaid(entry.id, entry.amount);
      await reload();
    } catch {
      setError("Não foi possível baixar este recebimento.");
    }
  };

  const payExpense = async (entry: ExpenseEntry) => {
    if (entry.status === "paid" || !isSupabaseConfigured) return;
    setError("");
    try {
      await markExpensePaid(entry.id);
      await reload();
    } catch {
      setError("Não foi possível marcar a despesa como paga.");
    }
  };

  const startExpenseEdit = (entry: ExpenseEntry) => {
    setEditingExpense(entry);
    setModal("expense");
  };

  const removeExpense = async (entry: ExpenseEntry) => {
    if (!isSupabaseConfigured) return;
    const confirmed = window.confirm(`Excluir a despesa "${entry.description}"?`);
    if (!confirmed) return;
    setError("");
    try {
      await deleteExpense(entry.id);
      await reload();
    } catch {
      setError("Não foi possível excluir a despesa.");
    }
  };

  const savePatientBilling = async (patient: PatientBilling) => {
    if (!isSupabaseConfigured) throw new Error("Supabase não configurado");
    await updatePatientBilling(patient);
    await reload();
    setEditingPatient(null);
  };

  return (
    <>
      <section className="animate-rise flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="font-display text-3xl leading-tight">Financeiro</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Controle o que foi faturado com atendimentos, o que já entrou, a carteira a receber, outros serviços e todos os gastos do período.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 rounded-xl border border-border bg-card/70 px-3 text-xs outline-none" />
          {isSupabaseConfigured && <Button variant="quiet" size="icon" onClick={() => void reload()} disabled={loading} aria-label="Atualizar"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>}
          <Button variant="quiet" onClick={() => { setEditingExpense(null); setModal("expense"); }}><TrendingDown /> Nova despesa</Button>
          <Button variant="dashboard" className="rounded-xl" onClick={() => setModal("revenue")}><TrendingUp /> Novo faturamento</Button>
        </div>
      </section>

      {error && <div className="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Faturado no período" value={money(summary.billed)} note={`${money(summary.appointments)} em atendimentos`} icon={<CircleDollarSign />} />
        <Metric label="Recebido no período" value={money(summary.received)} note="entradas efetivamente recebidas" icon={<TrendingUp />} />
        <Metric label="Carteira a receber" value={money(summary.receivable)} note={`${data.receivables.length} cobrança(s) em aberto`} icon={<Clock3 />} />
        <Metric label="Despesas do período" value={money(summary.expenses)} note={`${summary.expenseVsBilled.toFixed(1).replace(".", ",")}% do faturamento • caixa ${money(summary.result)}`} icon={<TrendingDown />} />
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Tab active={tab === "overview"} onClick={() => setTab("overview")}>Visão geral</Tab>
        <Tab active={tab === "receivables"} onClick={() => setTab("receivables")}>A receber</Tab>
        <Tab active={tab === "expenses"} onClick={() => setTab("expenses")}>Despesas</Tab>
        <Tab active={tab === "billing"} onClick={() => setTab("billing")}>Pacotes e cobrança</Tab>
      </div>

      {tab === "overview" && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <section className="dashboard-card rounded-2xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="font-display text-lg">Composição do faturamento</h2><p className="mt-1 text-[11px] text-muted-foreground">Atendimentos, empresas, testes e demais serviços no período.</p></div>
              <span className="rounded-full bg-accent px-3 py-1 text-[10px] font-medium">Total {money(summary.billed)}</span>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {sourceBreakdown.map(({ source, value }) => (
                <article key={source} className="rounded-2xl border border-border bg-background/45 p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-xl bg-accent text-primary">{source === "company" ? <Building2 className="size-4" /> : source === "psychological_test" || source === "neuropsychology" ? <FileText className="size-4" /> : <Stethoscope className="size-4" />}</span>
                    <div className="min-w-0"><p className="text-xs font-medium">{sourceLabels[source]}</p><p className="mt-1 font-display text-lg">{money(value)}</p></div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-2xl bg-primary p-5 text-primary-foreground">
            <p className="text-xs text-primary-foreground/70">Resultado financeiro do período</p>
            <p className="mt-3 font-display text-3xl">{money(summary.result)}</p>
            <p className="mt-3 text-[11px] leading-5 text-primary-foreground/70">Cálculo: recebido no período menos todas as despesas lançadas no período selecionado.</p>
            <div className="mt-5 border-t border-primary-foreground/15 pt-4 text-[11px]">
              <div className="flex justify-between"><span>Recebido</span><strong>{money(summary.received)}</strong></div>
              <div className="mt-2 flex justify-between"><span>Despesas</span><strong>- {money(summary.expenses)}</strong></div>
            </div>
          </section>

          <section className="dashboard-card rounded-2xl p-5 xl:col-span-2">
            <div><h2 className="font-display text-lg">Últimos lançamentos faturados</h2><p className="mt-1 text-[11px] text-muted-foreground">Competência, cliente, origem, situação e valor.</p></div>
            <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Competência</th><th className="px-3 py-3 font-medium">Cliente</th><th className="px-3 py-3 font-medium">Origem</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 text-right font-medium">Valor</th></tr></thead><tbody>{data.billed.slice(0, 10).map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.competence_date)}</td><td className="px-3 py-4"><p className="text-[13px] font-medium">{entry.client_name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{entry.description}</p></td><td className="px-3 py-4 text-xs">{sourceLabels[entry.source_type]}</td><td className="px-3 py-4"><Status status={entry.status} /></td><td className="px-3 py-4 text-right text-xs font-semibold">{money(entry.amount)}</td></tr>)}</tbody></table></div>
          </section>
        </div>
      )}

      {tab === "receivables" && (
        <section className="dashboard-card mt-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg">Carteira a receber</h2><p className="mt-1 text-[11px] text-muted-foreground">Tudo que já foi faturado e ainda não foi totalmente recebido.</p></div><strong className="font-display text-xl">{money(summary.receivable)}</strong></div>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Cliente</th><th className="px-3 py-3 font-medium">Origem</th><th className="px-3 py-3 font-medium">Vencimento</th><th className="px-3 py-3 font-medium">Faturado</th><th className="px-3 py-3 font-medium">Em aberto</th><th className="px-3 py-3 text-right font-medium">Ação</th></tr></thead><tbody>{data.receivables.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4"><p className="text-[13px] font-medium">{entry.client_name}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{entry.description}</p></td><td className="px-3 py-4 text-xs">{sourceLabels[entry.source_type]}</td><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.due_date)}</td><td className="px-3 py-4 text-xs">{money(entry.amount)}</td><td className="px-3 py-4 text-xs font-semibold">{money(outstanding(entry))}</td><td className="px-3 py-4 text-right"><Button size="sm" variant="quiet" onClick={() => void receive(entry)}><Check /> Baixar</Button></td></tr>)}</tbody></table>{data.receivables.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Nenhuma cobrança em aberto.</p>}</div>
        </section>
      )}

      {tab === "expenses" && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_330px]">
          <section className="dashboard-card rounded-2xl p-5">
            <div><h2 className="font-display text-lg">Despesas do período</h2><p className="mt-1 text-[11px] text-muted-foreground">Fixas e variáveis, incluindo transporte, contador/INSS, aluguel, condomínio, faxina e internet.</p></div>
            <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[940px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Data</th><th className="px-3 py-3 font-medium">Descrição</th><th className="px-3 py-3 font-medium">Categoria</th><th className="px-3 py-3 font-medium">Tipo</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 text-right font-medium">Valor</th><th className="px-3 py-3 text-right font-medium">Ações</th></tr></thead><tbody>{data.expenses.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.competence_date)}</td><td className="px-3 py-4 text-[13px] font-medium">{entry.description}</td><td className="px-3 py-4 text-xs">{expenseLabels[entry.category] ?? entry.category}</td><td className="px-3 py-4 text-xs">{entry.recurrence === "fixed" ? "Fixa" : "Variável"}</td><td className="px-3 py-4 text-xs">{entry.status === "paid" ? "Paga" : "Pendente"}</td><td className="px-3 py-4 text-right text-xs font-semibold">{money(entry.amount)}</td><td className="px-3 py-4"><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="quiet" onClick={() => startExpenseEdit(entry)}><Pencil /> Editar</Button>{entry.status === "pending" && <Button size="sm" variant="quiet" onClick={() => void payExpense(entry)}><Check /> Marcar paga</Button>}<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void removeExpense(entry)}><Trash2 /> Excluir</Button></div></td></tr>)}</tbody></table>{data.expenses.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Nenhuma despesa lançada neste período.</p>}</div>
          </section>
          <section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-base">Despesas sobre o faturamento</h2><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Percentual de cada categoria em relação ao faturamento do mês, como solicitado.</p><div className="mt-4 space-y-4">{expenseBreakdown.map(([category, value]) => { const percent = summary.billed > 0 ? (value / summary.billed) * 100 : 0; return <div key={category}><div className="flex justify-between gap-3 text-xs"><span>{expenseLabels[category] ?? category}</span><strong>{money(value)} • {percent.toFixed(1).replace(".", ",")}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} /></div></div>; })}</div><div className="mt-6 border-t border-border pt-4"><p className="text-[10px] text-muted-foreground">Despesas / faturamento</p><p className="mt-1 font-display text-2xl">{summary.expenseVsBilled.toFixed(1).replace(".", ",")}%</p><p className="mt-1 text-[10px] text-muted-foreground">{money(summary.expenses)} de {money(summary.billed)} faturados</p></div></section>
        </div>
      )}

      {tab === "billing" && (
        <section className="dashboard-card mt-4 rounded-2xl p-5">
          <div><h2 className="font-display text-lg">Pacotes e regra de cobrança</h2><p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">Defina por paciente se a cobrança é por sessão ou por pacote e, no pacote, se o pagamento ocorre no início do próprio mês ou no início do mês seguinte.</p></div>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Paciente</th><th className="px-3 py-3 font-medium">Modelo</th><th className="px-3 py-3 font-medium">Momento da cobrança</th><th className="px-3 py-3 font-medium">Dia</th><th className="px-3 py-3 font-medium">Valor do pacote</th><th className="px-3 py-3 text-right font-medium">Ação</th></tr></thead><tbody>{data.patients.map((patient) => <tr key={patient.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-[13px] font-medium">{patient.full_name}</td><td className="px-3 py-4 text-xs">{patient.billing_model === "package" ? "Pacote" : "Por sessão"}</td><td className="px-3 py-4 text-xs">{patient.billing_model === "package" ? patient.package_timing === "next_month" ? "Início do mês seguinte" : "Início do próprio mês" : "Após cada atendimento"}</td><td className="px-3 py-4 text-xs">{patient.billing_day ?? "—"}</td><td className="px-3 py-4 text-xs font-semibold">{patient.package_amount ? money(patient.package_amount) : "—"}</td><td className="px-3 py-4 text-right"><Button variant="quiet" size="sm" onClick={() => setEditingPatient(patient)}>Editar <ChevronRight /></Button></td></tr>)}</tbody></table>{data.patients.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Cadastre pacientes para configurar os ciclos de cobrança.</p>}</div>
        </section>
      )}

      {modal === "revenue" && <RevenueModal onClose={() => setModal(null)} onSave={async (entry, requestId) => { await saveRevenue(entry, requestId); setModal(null); }} />}
      {modal === "expense" && <ExpenseModal initialExpense={editingExpense} onClose={() => { setEditingExpense(null); setModal(null); }} onSave={async (entry, requestId) => { await saveExpense(entry, requestId); setEditingExpense(null); setModal(null); }} />}
      {editingPatient && <PatientBillingModal patient={editingPatient} onClose={() => setEditingPatient(null)} onSave={savePatientBilling} />}
    </>
  );
}

function Metric({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return <article className="dashboard-card rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><p className="text-xs font-medium text-muted-foreground">{label}</p><span className="grid size-11 place-items-center rounded-full bg-accent text-primary [&_svg]:size-5">{icon}</span></div><p className="mt-3 min-h-[2.6rem] font-display text-[28px] leading-[1.15] tabular-nums sm:text-[30px]">{value}</p><p className="mt-3 text-[11px] text-muted-foreground">{note}</p></article>;
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button onClick={onClick} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "border border-border bg-card/60 text-muted-foreground hover:bg-accent"}`}>{children}</button>;
}

function Status({ status }: { status: BillingEntry["status"] }) {
  const label = status === "paid" ? "Recebido" : status === "partial" ? "Parcial" : status === "cancelled" ? "Cancelado" : "A receber";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${status === "paid" ? "bg-primary/8 text-primary" : status === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-secondary/15 text-secondary"}`}>{label}</span>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-foreground/25 p-4 backdrop-blur-sm" onMouseDown={onClose}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-border p-5"><div><h2 className="font-display text-xl">{title}</h2><p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X /></Button></div>{children}</div></div>;
}

function RevenueModal({ onClose, onSave }: { onClose: () => void; onSave: (entry: Omit<BillingEntry, "id" | "received_amount" | "received_at">, requestId: string) => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const [source, setSource] = useState<RevenueSource>("session");
  const [client, setClient] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [competence, setCompetence] = useState(isoToday());
  const [dueDate, setDueDate] = useState(isoToday());
  const [paid, setPaid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const numeric = Number(amount.replace(",", "."));
    if (!client.trim() || !Number.isFinite(numeric) || numeric <= 0) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ source_type: source, client_name: client.trim(), description: description.trim() || sourceLabels[source], competence_date: competence, issued_at: isoToday(), due_date: dueDate || null, amount: numeric, status: paid ? "paid" : "pending" }, requestId);
    } catch {
      setError("Não foi possível salvar o faturamento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return <Modal title="Novo faturamento" subtitle="Registre atendimentos, pacotes, empresas, testes e outros serviços." onClose={onClose}><div className="grid gap-4 p-5 sm:grid-cols-2"><FieldLabel label="Origem"><select value={source} onChange={(event) => setSource(event.target.value as RevenueSource)} className="input-finance">{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FieldLabel><FieldLabel label="Cliente / paciente / empresa"><input value={client} onChange={(event) => setClient(event.target.value)} className="input-finance" placeholder="Ex.: Mariana Souza" /></FieldLabel><FieldLabel label="Descrição"><input value={description} onChange={(event) => setDescription(event.target.value)} className="input-finance" placeholder="Descrição do serviço" /></FieldLabel><FieldLabel label="Valor"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input-finance" placeholder="0,00" /></FieldLabel><FieldLabel label="Competência"><input type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} className="input-finance" /></FieldLabel><FieldLabel label="Vencimento"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="input-finance" /></FieldLabel><label className="flex items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-xs sm:col-span-2"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Já foi recebido</label>{error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 pt-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" onClick={() => void submit()} disabled={saving || !client.trim() || !amount}>{saving ? "Salvando..." : "Salvar faturamento"}</Button></div></div></Modal>;
}

function ExpenseModal({ initialExpense, onClose, onSave }: { initialExpense?: ExpenseEntry | null; onClose: () => void; onSave: (entry: Omit<ExpenseEntry, "id" | "paid_at">, requestId: string) => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const [category, setCategory] = useState(initialExpense?.category ?? "transporte");
  const [description, setDescription] = useState(initialExpense?.description ?? "");
  const [amount, setAmount] = useState(initialExpense ? String(initialExpense.amount).replace(".", ",") : "");
  const [competence, setCompetence] = useState(initialExpense?.competence_date ?? isoToday());
  const [recurrence, setRecurrence] = useState<"fixed" | "variable">(initialExpense?.recurrence ?? "variable");
  const [paid, setPaid] = useState(initialExpense ? initialExpense.status === "paid" : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(initialExpense);

  const submit = async () => {
    const numeric = Number(amount.replace(",", "."));
    if (!description.trim() || !Number.isFinite(numeric) || numeric <= 0) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ category, description: description.trim(), competence_date: competence, due_date: competence, amount: numeric, recurrence, status: paid ? "paid" : "pending" }, requestId);
    } catch {
      setError(isEditing ? "Não foi possível atualizar a despesa. Tente novamente." : "Não foi possível salvar a despesa. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return <Modal title={isEditing ? "Editar despesa" : "Nova despesa"} subtitle={isEditing ? "Atualize os dados da despesa selecionada." : "Registre os custos fixos e variáveis do consultório."} onClose={onClose}><div className="grid gap-4 p-5 sm:grid-cols-2"><FieldLabel label="Categoria"><select value={category} onChange={(event) => setCategory(event.target.value)} className="input-finance">{Object.entries(expenseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FieldLabel><FieldLabel label="Descrição"><input value={description} onChange={(event) => setDescription(event.target.value)} className="input-finance" placeholder="Ex.: Uber para atendimento" /></FieldLabel><FieldLabel label="Valor"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input-finance" placeholder="0,00" /></FieldLabel><FieldLabel label="Competência"><input type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} className="input-finance" /></FieldLabel><FieldLabel label="Tipo"><select value={recurrence} onChange={(event) => setRecurrence(event.target.value as "fixed" | "variable")} className="input-finance"><option value="fixed">Fixa</option><option value="variable">Variável</option></select></FieldLabel><label className="flex items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-xs"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Já foi paga</label>{error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 pt-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" onClick={() => void submit()} disabled={saving || !description.trim() || !amount}>{saving ? (isEditing ? "Salvando alterações..." : "Salvando...") : (isEditing ? "Salvar alterações" : "Salvar despesa")}</Button></div></div></Modal>;
}

function PatientBillingModal({ patient, onClose, onSave }: { patient: PatientBilling; onClose: () => void; onSave: (patient: PatientBilling) => Promise<void> }) {
  const [draft, setDraft] = useState(patient);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try { await onSave(draft); } catch { setError("Não foi possível salvar a regra de cobrança."); } finally { setSaving(false); }
  };
  return <Modal title="Regra de cobrança" subtitle={patient.full_name} onClose={onClose}><div className="grid gap-4 p-5 sm:grid-cols-2"><FieldLabel label="Modelo de cobrança"><select value={draft.billing_model} onChange={(event) => setDraft((current) => ({ ...current, billing_model: event.target.value as "session" | "package" }))} className="input-finance"><option value="session">Por sessão</option><option value="package">Pacote mensal</option></select></FieldLabel>{draft.billing_model === "package" && <><FieldLabel label="Quando cobrar"><select value={draft.package_timing ?? "current_month"} onChange={(event) => setDraft((current) => ({ ...current, package_timing: event.target.value as "current_month" | "next_month" }))} className="input-finance"><option value="current_month">Início do próprio mês</option><option value="next_month">Início do mês seguinte</option></select></FieldLabel><FieldLabel label="Dia da cobrança"><input type="number" min={1} max={28} value={draft.billing_day ?? 5} onChange={(event) => setDraft((current) => ({ ...current, billing_day: Number(event.target.value) }))} className="input-finance" /></FieldLabel><FieldLabel label="Valor do pacote"><input inputMode="decimal" value={draft.package_amount ?? ""} onChange={(event) => setDraft((current) => ({ ...current, package_amount: Number(event.target.value.replace(",", ".")) || null }))} className="input-finance" /></FieldLabel></>}{error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 pt-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" onClick={() => void save()} disabled={saving}>{saving ? "Salvando..." : "Salvar regra"}</Button></div></div></Modal>;
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">{label}</span>{children}</label>;
}
