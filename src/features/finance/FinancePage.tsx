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
  Printer,
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
import { getAppSettings } from "../clinic/repository";
import type { AppSettingsRow } from "../clinic/types";
import { isSupabaseConfigured } from "../../lib/supabase";
import { paymentMethodLabels, printCollectionNotice, printFinancialSummary, printPaymentReceipt } from "./documents";
import { createExpense, createRevenue, deleteExpense, deleteRevenueReceipt, loadFinanceBundle, markExpensePaid, updateExpense, updatePatientBilling, updateRevenueReceipt } from "./repository";
import type { BillingEntry, ExpenseEntry, FinanceBundle, PatientBilling, PatientIdentity, PaymentMethod, RevenueSource } from "./types";

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

function previousMonth(month: string) {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function changeLabel(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? "movimento iniciado neste mês" : "sem movimento no mês anterior";
  const percent = ((current - previous) / previous) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(0).replace(".", ",")}% em relação ao mês anterior`;
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatCpf(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "—";
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3}\.\d{3})(\d{1,2})$/, "$1-$2");
}

function addMonthsClamped(dateText: string, monthOffset: number) {
  // `noUncheckedIndexedAccess` considera itens de `split()` potencialmente ausentes.
  // Os valores padrão mantêm a função tipada sem alterar a regra de vencimento mensal.
  const [yearText = "1970", monthText = "01", dayText = "01"] = dateText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const targetMonth = month - 1 + monthOffset;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const result = new Date(targetYear, normalizedMonth, Math.min(day, lastDay));
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
}

function packageInstallmentPreview(total: number, count: number, firstDueDate: string) {
  if (!Number.isFinite(total) || total <= 0 || !firstDueDate || count < 1) return [];
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    dueDate: addMonthsClamped(firstDueDate, index),
    amount: (index === count - 1 ? totalCents - baseCents * (count - 1) : baseCents) / 100,
  }));
}

function outstanding(entry: BillingEntry) {
  return Math.max(0, Number(entry.amount) - Number(entry.received_amount || 0));
}

function receivableEntryState(entry: BillingEntry) {
  if (outstanding(entry) <= 0) return { label: "Paga", className: "bg-emerald-500/10 text-emerald-700" };
  if (entry.due_date && entry.due_date < isoToday()) return { label: "Vencida", className: "bg-destructive/10 text-destructive" };
  if (entry.status === "partial") return { label: "Parcial", className: "bg-amber-500/10 text-amber-700" };
  return { label: "Pendente", className: "bg-secondary/15 text-secondary" };
}

function emptyBundle(): FinanceBundle {
  return { billed: [], receivedInPeriod: [], receivables: [], packageBillings: [], expenses: [], patients: [], patientDirectory: [] };
}

function resultLabel(value: number) {
  if (value > 0) return "Lucro no mês";
  if (value < 0) return "Prejuízo no mês";
  return "Resultado do mês";
}

function MonthPicker({ value, onChange, className = "" }: { value: string; onChange: (value: string) => void; className?: string }) {
  // Regra de UX: o seletor nativo deve abrir ao clicar em qualquer ponto do campo,
  // não apenas no pequeno ícone de calendário exibido pelo navegador.
  const openPicker = (input: HTMLInputElement) => {
    try {
      input.showPicker?.();
    } catch {
      // Navegadores sem suporte continuam permitindo digitação/uso do ícone nativo.
    }
  };

  return (
    <input
      type="month"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onClick={(event) => openPicker(event.currentTarget)}
      aria-label="Selecionar mês"
      className={`h-10 cursor-pointer rounded-xl border border-border bg-card/70 px-3 text-xs outline-none ${className}`}
    />
  );
}

export function FinanceDashboardMetrics({
  onOpenBilled,
  onOpenReceived,
  onOpenReceivables,
  onOpenExpenses,
}: {
  onOpenBilled?: () => void;
  onOpenReceived?: () => void;
  onOpenReceivables?: () => void;
  onOpenExpenses?: () => void;
} = {}) {
  const [data, setData] = useState<FinanceBundle>(emptyBundle);
  const [previous, setPrevious] = useState<FinanceBundle>(emptyBundle);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;
    const loadDashboardFinance = async () => {
      setLoading(true);
      setLoadError(false);
      const month = currentMonth();
      const prev = previousMonth(month);
      try {
        const [currentData, previousData] = await Promise.all([loadFinanceBundle(month), loadFinanceBundle(prev)]);
        if (!active) return;
        setData(currentData);
        setPrevious(previousData);
      } catch (error) {
        console.error(error);
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    // Importante: após F5 os estados React começam vazios. Enquanto o Supabase responde,
    // o Dashboard deve mostrar carregamento (e não R$ 0,00), evitando comunicar um saldo falso.
    void loadDashboardFinance();
    return () => { active = false; };
  }, []);

  const billed = data.billed.reduce((sum, item) => sum + Number(item.amount), 0);
  const received = data.receivedInPeriod.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
  const receivable = data.receivables.reduce((sum, item) => sum + outstanding(item), 0);
  const expenses = data.expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const previousBilled = previous.billed.reduce((sum, item) => sum + Number(item.amount), 0);
  const previousReceived = previous.receivedInPeriod.reduce((sum, item) => sum + Number(item.received_amount || 0), 0);
  const previousExpenses = previous.expenses.reduce((sum, item) => sum + Number(item.amount), 0);

  // Os quatro cards representam fontes diferentes de informação. Cada clique abre a
  // visão financeira que explica exatamente a composição do número exibido no Dashboard.
  return (
    <section aria-label="Indicadores financeiros" aria-busy={loading} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Faturado no mês" value={money(billed)} note={`${data.billed.length} cobrança(s) faturada(s) • clique para ver a origem`} icon={<CircleDollarSign />} tone={billed > previousBilled ? "positive" : "default"} loading={loading} error={loadError} onClick={onOpenBilled} />
      <Metric label="Recebido no mês" value={money(received)} note={`${data.receivedInPeriod.length} pagamento(s) recebido(s) • clique para detalhar`} icon={<TrendingUp />} tone={received > previousReceived ? "positive" : "default"} loading={loading} error={loadError} onClick={onOpenReceived} />
      <Metric label="A receber" value={money(receivable)} note={`${data.receivables.length} cobrança(s) pendente(s) • clique para detalhar`} icon={<Clock3 />} loading={loading} error={loadError} onClick={onOpenReceivables} />
      <Metric label="Despesas do mês" value={money(expenses)} note={`${data.expenses.length} lançamento(s) • clique para detalhar`} icon={<TrendingDown />} tone={expenses > previousExpenses ? "negative" : "default"} loading={loading} error={loadError} onClick={onOpenExpenses} />
    </section>
  );
}

export type FinanceTab = "overview" | "billed" | "received" | "receivables" | "expenses" | "billing";

type ReceivableGroup = {
  key: string;
  patientId: string | null;
  patientName: string;
  cpf: string | null;
  openEntries: BillingEntry[];
  detailEntries: BillingEntry[];
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  installmentCount: number | null;
  paidInstallments: number;
  overdueInstallments: number;
  partialInstallments: number;
  nextDueDate: string | null;
};

export function FinancePage({
  initialModal = null,
  onInitialModalHandled,
  initialTab = null,
  onInitialTabHandled,
}: {
  initialModal?: "revenue" | "expense" | null;
  onInitialModalHandled?: () => void;
  initialTab?: FinanceTab | null;
  onInitialTabHandled?: () => void;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<FinanceBundle>(emptyBundle);
  const [documentProfile, setDocumentProfile] = useState<AppSettingsRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<"revenue" | "expense" | null>(null);
  const [editingExpense, setEditingExpense] = useState<ExpenseEntry | null>(null);
  const [editingReceipt, setEditingReceipt] = useState<BillingEntry | null>(null);
  const [editingPatient, setEditingPatient] = useState<PatientBilling | null>(null);
  const [tab, setTab] = useState<FinanceTab>("overview");
  const [movementFilter, setMovementFilter] = useState<"all" | "revenue" | "expense">("all");
  const [receivablePatientFilter, setReceivablePatientFilter] = useState("all");
  const [receivableStatusFilter, setReceivableStatusFilter] = useState<"all" | "pending" | "partial" | "overdue">("all");
  const [receivableStartDate, setReceivableStartDate] = useState("");
  const [receivableEndDate, setReceivableEndDate] = useState("");

  useEffect(() => {
    if (!initialModal) return;
    setEditingExpense(null);
    setModal(initialModal);
    onInitialModalHandled?.();
  }, [initialModal, onInitialModalHandled]);

  useEffect(() => {
    if (!initialTab) return;
    setTab(initialTab);
    onInitialTabHandled?.();
  }, [initialTab, onInitialTabHandled]);

  const reload = async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError("");
    try {
      const [bundle, profile] = await Promise.all([loadFinanceBundle(month, true), getAppSettings()]);
      setData(bundle);
      setDocumentProfile(profile);
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

  const receivableGroups = useMemo<ReceivableGroup[]>(() => {
    const today = isoToday();
    const patientById = new Map<string, PatientIdentity>(data.patientDirectory.map((patient) => [patient.id, patient]));
    const grouped = new Map<string, BillingEntry[]>();

    for (const entry of data.receivables) {
      const key = entry.patient_id ? `patient:${entry.patient_id}` : `client:${entry.client_name.trim().toLocaleLowerCase("pt-BR")}`;
      const current = grouped.get(key) ?? [];
      current.push(entry);
      grouped.set(key, current);
    }

    return Array.from(grouped.entries()).map(([key, openEntries]) => {
      const patientId = openEntries.find((entry) => entry.patient_id)?.patient_id ?? null;
      const patient = patientId ? patientById.get(patientId) : undefined;
      const packagePlanIds = new Set(
        openEntries
          .map((entry) => entry.package_plan_id)
          .filter((value): value is string => Boolean(value)),
      );
      const appointmentPlanIds = new Set(
        openEntries
          .filter((entry) => Number(entry.installment_count || 0) > 0)
          .map((entry) => entry.appointment_id)
          .filter((value): value is string => Boolean(value)),
      );
      const installmentHistory = data.packageBillings.filter((entry) =>
        Boolean(entry.package_plan_id && packagePlanIds.has(entry.package_plan_id))
        || Boolean(entry.appointment_id && appointmentPlanIds.has(entry.appointment_id)),
      );
      const installmentHistoryIds = new Set(installmentHistory.map((entry) => entry.id));
      const standaloneOpen = openEntries.filter((entry) => !installmentHistoryIds.has(entry.id));
      const detailById = new Map<string, BillingEntry>();
      [...installmentHistory, ...standaloneOpen].forEach((entry) => detailById.set(entry.id, entry));
      const detailEntries = Array.from(detailById.values()).sort((a, b) => (a.due_date ?? a.competence_date).localeCompare(b.due_date ?? b.competence_date));

      const totalAmount = detailEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const paidAmount = detailEntries.reduce((sum, entry) => sum + Number(entry.received_amount || 0), 0);
      const outstandingAmount = openEntries.reduce((sum, entry) => sum + outstanding(entry), 0);
      const installmentPlanKeys = new Set<string>();
      installmentHistory.forEach((entry) => {
        if (entry.package_plan_id) installmentPlanKeys.add(`package:${entry.package_plan_id}`);
        else if (entry.appointment_id) installmentPlanKeys.add(`appointment:${entry.appointment_id}`);
      });
      const installmentCount = installmentPlanKeys.size
        ? Array.from(installmentPlanKeys).reduce((sum, key) => {
            const [kind, id] = key.split(":");
            const planEntries = installmentHistory.filter((entry) => kind === "package" ? entry.package_plan_id === id : entry.appointment_id === id);
            return sum + planEntries.reduce((max, entry) => Math.max(max, Number(entry.installment_count || 0)), 0);
          }, 0)
        : null;
      const paidInstallments = installmentHistory.filter((entry) => outstanding(entry) <= 0 && Number(entry.amount) > 0).length;
      const overdueInstallments = openEntries.filter((entry) => Boolean(entry.due_date && entry.due_date < today) && outstanding(entry) > 0).length;
      const partialInstallments = openEntries.filter((entry) => entry.status === "partial").length;
      const nextDueDate = openEntries
        .map((entry) => entry.due_date)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null;

      return {
        key,
        patientId: patientId ?? null,
        patientName: patient?.full_name ?? openEntries[0]?.client_name ?? "Cliente",
        cpf: patient?.cpf ?? null,
        openEntries,
        detailEntries,
        totalAmount,
        paidAmount,
        outstandingAmount,
        installmentCount,
        paidInstallments,
        overdueInstallments,
        partialInstallments,
        nextDueDate,
      };
    }).sort((a, b) => {
      if (a.overdueInstallments !== b.overdueInstallments) return b.overdueInstallments - a.overdueInstallments;
      return (a.nextDueDate ?? "9999-12-31").localeCompare(b.nextDueDate ?? "9999-12-31");
    });
  }, [data.receivables, data.packageBillings, data.patientDirectory]);

  const filteredReceivableGroups = useMemo(() => {
    return receivableGroups.filter((group) => {
      if (receivablePatientFilter !== "all" && group.key !== receivablePatientFilter) return false;
      if (receivableStatusFilter === "overdue" && group.overdueInstallments === 0) return false;
      if (receivableStatusFilter === "partial" && group.partialInstallments === 0) return false;
      if (receivableStatusFilter === "pending" && !group.openEntries.some((entry) => entry.status === "pending")) return false;
      if (receivableStartDate || receivableEndDate) {
        const hasEntryInPeriod = group.openEntries.some((entry) => {
          const due = entry.due_date ?? entry.competence_date;
          if (receivableStartDate && due < receivableStartDate) return false;
          if (receivableEndDate && due > receivableEndDate) return false;
          return true;
        });
        if (!hasEntryInPeriod) return false;
      }
      return true;
    });
  }, [receivableGroups, receivablePatientFilter, receivableStatusFilter, receivableStartDate, receivableEndDate]);

  const filteredReceivableSummary = useMemo(() => ({
    outstanding: filteredReceivableGroups.reduce((sum, group) => sum + group.outstandingAmount, 0),
    debtors: filteredReceivableGroups.length,
    overdue: filteredReceivableGroups.filter((group) => group.overdueInstallments > 0).length,
  }), [filteredReceivableGroups]);

  const latestMovements = useMemo(() => {
    // "Movimentações" deve refletir caixa: entradas vêm das baixas efetivamente recebidas
    // no período, não de todo o faturamento. Isso também garante que um recebimento cuja
    // data seja corrigida passe a aparecer no mês correto.
    const revenues = data.receivedInPeriod.map((entry) => ({
      key: `revenue-${entry.id}`,
      type: "revenue" as const,
      title: entry.client_name,
      description: entry.description,
      origin: sourceLabels[entry.source_type],
      status: entry.status === "paid" ? "Recebido" : entry.status === "partial" ? "Parcial" : entry.status === "cancelled" ? "Cancelado" : "A receber",
      date: entry.received_at ?? entry.competence_date,
      amount: Number(entry.received_amount),
      billingEntry: entry,
      expenseEntry: null,
    }));
    const expenses = data.expenses.map((entry) => ({
      key: `expense-${entry.id}`,
      date: entry.competence_date,
      type: "expense" as const,
      title: entry.description,
      description: expenseLabels[entry.category] ?? entry.category,
      origin: entry.recurrence === "fixed" ? "Despesa fixa" : "Despesa variável",
      status: entry.status === "paid" ? "Paga" : "Pendente",
      amount: Number(entry.amount),
      billingEntry: null,
      expenseEntry: entry,
    }));

    // Mantém todas as movimentações ordenadas antes do filtro para que "Entradas" e
    // "Saídas" possam trazer as 12 mais recentes do próprio tipo, inclusive as mais antigas
    // que ficariam ocultas se o corte fosse feito antes da filtragem.
    return [...revenues, ...expenses].sort((a, b) => b.date.localeCompare(a.date));
  }, [data.receivedInPeriod, data.expenses]);

  const visibleMovements = useMemo(
    () => latestMovements.filter((entry) => movementFilter === "all" || entry.type === movementFilter).slice(0, 12),
    [latestMovements, movementFilter],
  );

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
      payment_method: entry.payment_method,
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

  const receive = (entry: BillingEntry) => {
    if (outstanding(entry) <= 0 || !isSupabaseConfigured) return;
    setEditingReceipt(entry);
  };

  // Recebimento e cobrança são conceitos diferentes: editar/excluir uma baixa não deve
  // apagar o faturamento que originou a cobrança (sessão, pacote ou receita manual).
  const saveReceipt = async (input: { id: string; received_amount: number; received_at: string; payment_method: PaymentMethod }) => {
    if (!isSupabaseConfigured) throw new Error("Supabase não configurado");
    await updateRevenueReceipt(input);
    await reload();
    setEditingReceipt(null);
  };

  const removeReceipt = async (entry: BillingEntry) => {
    if (!isSupabaseConfigured || Number(entry.received_amount || 0) <= 0) return;
    const confirmed = window.confirm(
      `Excluir o recebimento de ${money(Number(entry.received_amount))} de ${entry.client_name}? A cobrança continuará registrada e voltará para A receber.`,
    );
    if (!confirmed) return;
    setError("");
    try {
      await deleteRevenueReceipt(entry.id);
      await reload();
    } catch {
      setError("Não foi possível excluir este recebimento.");
    }
  };

  const resolvePatientForDocument = (entry: BillingEntry): PatientIdentity | null => {
    if (entry.patient_id) {
      const byId = data.patientDirectory.find((patient) => patient.id === entry.patient_id);
      if (byId) return byId;
    }
    const normalized = entry.client_name.trim().toLocaleLowerCase("pt-BR");
    return data.patientDirectory.find((patient) => patient.full_name.trim().toLocaleLowerCase("pt-BR") === normalized) ?? null;
  };

  const issueReceipt = (entry: BillingEntry) => {
    setError("");
    try {
      if (!documentProfile) throw new Error("Não foi possível carregar os dados profissionais das Configurações.");
      const patient = resolvePatientForDocument(entry);
      if (!patient) throw new Error("Vincule esta cobrança a um paciente cadastrado antes de emitir o recibo.");
      printPaymentReceipt({ entry, patient, profile: documentProfile });
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "Não foi possível gerar o recibo.");
    }
  };

  const issueFinancialSummary = (group: ReceivableGroup, focusEntryId?: string) => {
    setError("");
    try {
      if (!documentProfile) throw new Error("Não foi possível carregar os dados profissionais das Configurações.");
      const patient = group.patientId
        ? data.patientDirectory.find((item) => item.id === group.patientId) ?? null
        : data.patientDirectory.find((item) => item.full_name.trim().toLocaleLowerCase("pt-BR") === group.patientName.trim().toLocaleLowerCase("pt-BR")) ?? null;
      if (!patient) throw new Error("Vincule esta cobrança a um paciente cadastrado antes de emitir o documento.");
      printFinancialSummary({ entries: group.detailEntries, patient, profile: documentProfile, ...(focusEntryId ? { focusEntryId } : {}) });
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "Não foi possível gerar o documento financeiro.");
    }
  };

  const issueCollectionNotice = (entry: BillingEntry) => {
    setError("");
    try {
      if (!documentProfile) throw new Error("Não foi possível carregar os dados profissionais das Configurações.");
      const patient = resolvePatientForDocument(entry);
      if (!patient) throw new Error("Vincule esta cobrança a um paciente cadastrado antes de emitir a nota de cobrança.");
      printCollectionNotice({ entry, patient, profile: documentProfile });
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "Não foi possível gerar a nota de cobrança.");
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
    const confirmed = window.confirm(entry.recurrence === "fixed" ? `Excluir a despesa "${entry.description}" e encerrar a recorrência mensal?` : `Excluir a despesa "${entry.description}"?`);
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
          <MonthPicker value={month} onChange={setMonth} />
          {isSupabaseConfigured && <Button variant="quiet" size="icon" onClick={() => void reload()} disabled={loading} aria-label="Atualizar"><RefreshCw className={loading ? "animate-spin" : ""} /></Button>}
          <Button variant="quiet" onClick={() => { setEditingExpense(null); setModal("expense"); }}><TrendingDown /> Nova despesa</Button>
          <Button variant="dashboard" className="rounded-xl" onClick={() => setModal("revenue")}><TrendingUp /> Nova receita</Button>
        </div>
      </section>

      {error && <div className="mb-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Faturado no período" value={money(summary.billed)} note={`${data.billed.length} cobrança(s) • clique para ver a origem`} icon={<CircleDollarSign />} onClick={() => setTab("billed")} />
        <Metric label="Recebido no período" value={money(summary.received)} note={`${data.receivedInPeriod.length} pagamento(s) • clique para detalhar`} icon={<TrendingUp />} onClick={() => setTab("received")} />
        <Metric label="Carteira a receber" value={money(summary.receivable)} note={`${data.receivables.length} cobrança(s) em aberto • clique para detalhar`} icon={<Clock3 />} onClick={() => setTab("receivables")} />
        <Metric label="Despesas do período" value={money(summary.expenses)} note={`${data.expenses.length} lançamento(s) • clique para detalhar`} icon={<TrendingDown />} onClick={() => setTab("expenses")} />
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        <Tab active={tab === "overview"} onClick={() => setTab("overview")}>Visão geral</Tab>
        <Tab active={tab === "billed"} onClick={() => setTab("billed")}>Faturado</Tab>
        <Tab active={tab === "received"} onClick={() => setTab("received")}>Recebido</Tab>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="font-display text-lg">Movimentações recentes</h2><p className="mt-1 text-[11px] text-muted-foreground">Entradas e saídas do período em uma única visão.</p></div>
              <div className="flex rounded-xl border border-border bg-background/45 p-1" aria-label="Filtrar movimentações recentes">
                <MovementFilterButton active={movementFilter === "all"} onClick={() => setMovementFilter("all")}>Todas</MovementFilterButton>
                <MovementFilterButton active={movementFilter === "revenue"} onClick={() => setMovementFilter("revenue")}>Entradas</MovementFilterButton>
                <MovementFilterButton active={movementFilter === "expense"} onClick={() => setMovementFilter("expense")}>Saídas</MovementFilterButton>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase text-muted-foreground">
                    <th className="px-3 py-3 font-medium">Data</th>
                    <th className="px-3 py-3 font-medium">Tipo</th>
                    <th className="px-3 py-3 font-medium">Lançamento</th>
                    <th className="px-3 py-3 font-medium">Origem</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 text-right font-medium">Valor</th>
                    <th className="px-3 py-3 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMovements.map((entry) => (
                    <tr key={entry.key} className="border-b border-border/70 last:border-0">
                      <td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.date)}</td>
                      <td className="px-3 py-4">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${entry.type === "expense" ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700"}`}>
                          {entry.type === "expense" ? "Saída" : "Entrada"}
                        </span>
                      </td>
                      <td className="px-3 py-4"><p className="text-[13px] font-medium">{entry.title}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{entry.description}</p></td>
                      <td className="px-3 py-4 text-xs">{entry.origin}</td>
                      <td className="px-3 py-4 text-xs">{entry.status}</td>
                      <td className={`px-3 py-4 text-right text-xs font-semibold ${entry.type === "expense" ? "text-red-700" : "text-emerald-700"}`}>{entry.type === "expense" ? `- ${money(entry.amount)}` : money(entry.amount)}</td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-1.5">
                          {entry.type === "revenue" && entry.billingEntry && Number(entry.billingEntry.received_amount || 0) > 0 ? (
                            <>
                              <Button size="sm" variant="quiet" onClick={() => issueReceipt(entry.billingEntry!)}><ReceiptText /> Recibo</Button>
                              <Button size="sm" variant="quiet" onClick={() => setEditingReceipt(entry.billingEntry!)}><Pencil /> Editar recebimento</Button>
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void removeReceipt(entry.billingEntry!)}><Trash2 /> Excluir recebimento</Button>
                            </>
                          ) : entry.type === "expense" && entry.expenseEntry ? (
                            <>
                              {/* Ações também ficam disponíveis na visão geral para corrigir uma saída sem obrigar o usuário a trocar de aba.
                                  A lógica reutiliza os mesmos fluxos seguros da aba Despesas; não concede UPDATE/DELETE direto no frontend. */}
                              <Button size="sm" variant="quiet" onClick={() => startExpenseEdit(entry.expenseEntry!)}><Pencil /> Editar despesa</Button>
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void removeExpense(entry.expenseEntry!)}><Trash2 /> Excluir despesa</Button>
                            </>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleMovements.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Nenhuma movimentação encontrada neste filtro.</p>}
            </div>
          </section>
        </div>
      )}

      {tab === "billed" && (
        <section className="dashboard-card mt-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-display text-lg">Origem do faturamento</h2><p className="mt-1 text-[11px] text-muted-foreground">Cada cobrança que compõe o valor faturado no período selecionado.</p></div>
            <span className="rounded-full bg-accent px-3 py-1 text-[10px] font-medium">Total {money(summary.billed)}</span>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Competência</th><th className="px-3 py-3 font-medium">Paciente / cliente</th><th className="px-3 py-3 font-medium">Origem</th><th className="px-3 py-3 font-medium">Descrição</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 text-right font-medium">Faturado</th></tr></thead>
              <tbody>{data.billed.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.competence_date)}</td><td className="px-3 py-4 text-[13px] font-medium">{entry.client_name}</td><td className="px-3 py-4 text-xs">{sourceLabels[entry.source_type]}</td><td className="px-3 py-4 text-xs text-muted-foreground">{entry.description}</td><td className="px-3 py-4"><Status status={entry.status} /></td><td className="px-3 py-4 text-right text-xs font-semibold">{money(Number(entry.amount))}</td></tr>)}</tbody>
            </table>
            {data.billed.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Nenhum faturamento neste período.</p>}
          </div>
        </section>
      )}

      {tab === "received" && (
        <section className="dashboard-card mt-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-display text-lg">Pagamentos recebidos</h2><p className="mt-1 text-[11px] text-muted-foreground">Baixas efetivamente recebidas no período selecionado, independentemente do mês em que a cobrança foi faturada.</p></div>
            <span className="rounded-full bg-accent px-3 py-1 text-[10px] font-medium">Total {money(summary.received)}</span>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Recebimento</th><th className="px-3 py-3 font-medium">Paciente / cliente</th><th className="px-3 py-3 font-medium">Origem</th><th className="px-3 py-3 font-medium">Descrição</th><th className="px-3 py-3 font-medium">Forma</th><th className="px-3 py-3 text-right font-medium">Faturado</th><th className="px-3 py-3 text-right font-medium">Recebido</th><th className="px-3 py-3 text-right font-medium">Ações</th></tr></thead>
              <tbody>{data.receivedInPeriod.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.received_at)}</td><td className="px-3 py-4 text-[13px] font-medium">{entry.client_name}</td><td className="px-3 py-4 text-xs">{sourceLabels[entry.source_type]}</td><td className="px-3 py-4 text-xs text-muted-foreground">{entry.description}</td><td className="px-3 py-4 text-xs">{entry.payment_method ? paymentMethodLabels[entry.payment_method] : "Não informado"}</td><td className="px-3 py-4 text-right text-xs">{money(Number(entry.amount))}</td><td className="px-3 py-4 text-right text-xs font-semibold text-emerald-700">{money(Number(entry.received_amount || 0))}</td><td className="px-3 py-4"><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="quiet" onClick={() => issueReceipt(entry)}><ReceiptText /> Recibo</Button><Button size="sm" variant="quiet" onClick={() => setEditingReceipt(entry)}><Pencil /> Editar recebimento</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void removeReceipt(entry)}><Trash2 /> Excluir recebimento</Button></div></td></tr>)}</tbody>
            </table>
            {data.receivedInPeriod.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Nenhum pagamento recebido neste período.</p>}
          </div>
        </section>
      )}

      {tab === "receivables" && (
        <section className="dashboard-card mt-4 rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg">A receber por paciente</h2>
              <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">Veja quem está devendo, CPF, valor total, o que já foi pago, saldo restante e o andamento das parcelas. O período filtra pelo vencimento das cobranças ainda em aberto.</p>
            </div>
            <strong className="font-display text-xl">{money(filteredReceivableSummary.outstanding)}</strong>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="space-y-1.5 text-[10px] font-medium text-muted-foreground">
              <span>Paciente / cliente</span>
              <select value={receivablePatientFilter} onChange={(event) => setReceivablePatientFilter(event.target.value)} className="input-finance">
                <option value="all">Todos</option>
                {receivableGroups.map((group) => <option key={group.key} value={group.key}>{group.patientName}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-[10px] font-medium text-muted-foreground">
              <span>Status</span>
              <select value={receivableStatusFilter} onChange={(event) => setReceivableStatusFilter(event.target.value as "all" | "pending" | "partial" | "overdue")} className="input-finance">
                <option value="all">Todos</option>
                <option value="pending">Pendentes</option>
                <option value="partial">Parciais</option>
                <option value="overdue">Vencidas</option>
              </select>
            </label>
            <label className="space-y-1.5 text-[10px] font-medium text-muted-foreground">
              <span>Vencimento de</span>
              <input type="date" value={receivableStartDate} onChange={(event) => setReceivableStartDate(event.target.value)} className="input-finance" />
            </label>
            <label className="space-y-1.5 text-[10px] font-medium text-muted-foreground">
              <span>Vencimento até</span>
              <input type="date" value={receivableEndDate} onChange={(event) => setReceivableEndDate(event.target.value)} className="input-finance" />
            </label>
            <div className="flex items-end">
              <Button variant="quiet" className="w-full" onClick={() => { setReceivablePatientFilter("all"); setReceivableStatusFilter("all"); setReceivableStartDate(""); setReceivableEndDate(""); }}>Limpar filtros</Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background/45 p-4"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Falta receber</p><p className="mt-2 font-display text-xl">{money(filteredReceivableSummary.outstanding)}</p></div>
            <div className="rounded-2xl border border-border bg-background/45 p-4"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pessoas devendo</p><p className="mt-2 font-display text-xl">{filteredReceivableSummary.debtors}</p></div>
            <div className="rounded-2xl border border-border bg-background/45 p-4"><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Com parcela vencida</p><p className={`mt-2 font-display text-xl ${filteredReceivableSummary.overdue > 0 ? "text-destructive" : ""}`}>{filteredReceivableSummary.overdue}</p></div>
          </div>

          <div className="mt-5 space-y-4">
            {filteredReceivableGroups.map((group) => (
              <article key={group.key} className="overflow-hidden rounded-2xl border border-border bg-background/40">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{group.patientName}</h3>
                      {group.overdueInstallments > 0 && <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-[10px] font-medium text-destructive">{group.overdueInstallments} vencida(s)</span>}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">CPF: {formatCpf(group.cpf)}</p>
                  </div>
                  <div className="flex flex-wrap items-start justify-end gap-3"><Button size="sm" variant="quiet" onClick={() => issueFinancialSummary(group)}><Printer /> Resumo financeiro</Button><div className="text-right"><p className="text-[10px] text-muted-foreground">Falta receber</p><p className="mt-1 font-display text-xl">{money(group.outstandingAmount)}</p></div></div>
                </div>

                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-xl bg-card/70 p-3"><p className="text-[10px] text-muted-foreground">Valor total</p><p className="mt-1 text-sm font-semibold">{money(group.totalAmount)}</p></div>
                  <div className="rounded-xl bg-card/70 p-3"><p className="text-[10px] text-muted-foreground">Já pago</p><p className="mt-1 text-sm font-semibold text-emerald-700">{money(group.paidAmount)}</p></div>
                  <div className="rounded-xl bg-card/70 p-3"><p className="text-[10px] text-muted-foreground">Ainda falta</p><p className="mt-1 text-sm font-semibold">{money(group.outstandingAmount)}</p></div>
                  <div className="rounded-xl bg-card/70 p-3"><p className="text-[10px] text-muted-foreground">Parcelamento</p>{group.installmentCount && group.installmentCount > 1 ? <><p className="mt-1 text-sm font-semibold">{group.installmentCount}x</p><p className="mt-1 text-[10px] text-muted-foreground">{group.paidInstallments} parcela(s) paga(s)</p></> : <p className="mt-1 text-sm font-semibold">Não parcelado</p>}</div>
                  <div className="rounded-xl bg-card/70 p-3"><p className="text-[10px] text-muted-foreground">Próximo vencimento</p><p className="mt-1 text-sm font-semibold">{dateLabel(group.nextDueDate)}</p><p className="mt-1 text-[10px] text-muted-foreground">{group.partialInstallments} parcial(is)</p></div>
                </div>

                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full min-w-[980px] text-left">
                    <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-4 py-3 font-medium">Cobrança</th><th className="px-3 py-3 font-medium">Vencimento</th><th className="px-3 py-3 font-medium">Valor</th><th className="px-3 py-3 font-medium">Pago</th><th className="px-3 py-3 font-medium">Em aberto</th><th className="px-3 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Ação</th></tr></thead>
                    <tbody>
                      {group.detailEntries.map((entry) => {
                        const state = receivableEntryState(entry);
                        const isOpen = outstanding(entry) > 0;
                        return <tr key={entry.id} className="border-b border-border/60 last:border-0">
                          <td className="px-4 py-3"><p className="text-xs font-medium">{entry.installment_number && entry.installment_count ? `Parcela ${entry.installment_number}/${entry.installment_count}` : sourceLabels[entry.source_type]}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{entry.description}</p></td>
                          <td className="px-3 py-3 text-xs text-muted-foreground">{dateLabel(entry.due_date)}</td>
                          <td className="px-3 py-3 text-xs">{money(Number(entry.amount))}</td>
                          <td className="px-3 py-3 text-xs text-emerald-700">{money(Number(entry.received_amount || 0))}</td>
                          <td className="px-3 py-3 text-xs font-semibold">{money(outstanding(entry))}</td>
                          <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${state.className}`}>{state.label}</span></td>
                          <td className="px-4 py-3"><div className="flex flex-wrap justify-end gap-2">{Number(entry.received_amount || 0) > 0 && <Button size="sm" variant="quiet" onClick={() => issueReceipt(entry)}><ReceiptText /> Recibo</Button>}{isOpen && <Button size="sm" variant="quiet" onClick={() => issueCollectionNotice(entry)}><FileText /> Nota de cobrança</Button>}{isOpen && <Button size="sm" variant="quiet" onClick={() => receive(entry)}><Check /> Baixar</Button>}{!isOpen && Number(entry.received_amount || 0) <= 0 && <span className="text-[10px] text-muted-foreground">Concluída</span>}</div></td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
            {filteredReceivableGroups.length === 0 && <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center text-xs text-muted-foreground">Nenhuma cobrança em aberto encontrada com esses filtros.</div>}
          </div>
        </section>
      )}

      {tab === "expenses" && (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_330px]">
          <section className="dashboard-card rounded-2xl p-5">
            <div><h2 className="font-display text-lg">Despesas do período</h2><p className="mt-1 text-[11px] text-muted-foreground">Fixas e variáveis, incluindo transporte, contador/INSS, aluguel, condomínio, faxina e internet.</p></div>
            <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[940px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Data</th><th className="px-3 py-3 font-medium">Descrição</th><th className="px-3 py-3 font-medium">Categoria</th><th className="px-3 py-3 font-medium">Tipo</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 text-right font-medium">Valor</th><th className="px-3 py-3 text-right font-medium">Ações</th></tr></thead><tbody>{data.expenses.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs text-muted-foreground">{dateLabel(entry.competence_date)}</td><td className="px-3 py-4 text-[13px] font-medium">{entry.description}</td><td className="px-3 py-4 text-xs">{expenseLabels[entry.category] ?? entry.category}</td><td className="px-3 py-4 text-xs">{entry.recurrence === "fixed" ? `Fixa • dia ${Number((entry.due_date ?? entry.competence_date).slice(8, 10))}` : "Variável"}</td><td className="px-3 py-4 text-xs">{entry.status === "paid" ? "Paga" : "Pendente"}</td><td className="px-3 py-4 text-right text-xs font-semibold">{money(entry.amount)}</td><td className="px-3 py-4"><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="quiet" onClick={() => startExpenseEdit(entry)}><Pencil /> Editar</Button>{entry.status === "pending" && <Button size="sm" variant="quiet" onClick={() => void payExpense(entry)}><Check /> Marcar paga</Button>}<Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void removeExpense(entry)}><Trash2 /> Excluir</Button></div></td></tr>)}</tbody></table>{data.expenses.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Nenhuma despesa lançada neste período.</p>}</div>
          </section>
          <section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-base">Despesas sobre o faturamento</h2><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Participação percentual de cada categoria de despesa em relação ao faturamento do período selecionado.</p><div className="mt-4 space-y-4">{expenseBreakdown.map(([category, value]) => { const percent = summary.billed > 0 ? (value / summary.billed) * 100 : 0; return <div key={category}><div className="flex justify-between gap-3 text-xs"><span>{expenseLabels[category] ?? category}</span><strong>{money(value)} • {percent.toFixed(1).replace(".", ",")}%</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, percent)}%` }} /></div></div>; })}</div><div className="mt-6 border-t border-border pt-4"><p className="text-[10px] text-muted-foreground">Despesas / faturamento</p><p className="mt-1 font-display text-2xl">{summary.expenseVsBilled.toFixed(1).replace(".", ",")}%</p><p className="mt-1 text-[10px] text-muted-foreground">{money(summary.expenses)} de {money(summary.billed)} faturados</p></div></section>
        </div>
      )}

      {tab === "billing" && (
        <section className="dashboard-card mt-4 rounded-2xl p-5">
          <div><h2 className="font-display text-lg">Pacotes e regra de cobrança</h2><p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">A cobrança por pacote/plano pode ser à vista ou parcelada. As parcelas são criadas automaticamente em A receber e permanecem vinculadas ao paciente e ao plano.</p></div>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3 font-medium">Paciente</th><th className="px-3 py-3 font-medium">Modelo</th><th className="px-3 py-3 font-medium">Pagamento</th><th className="px-3 py-3 font-medium">1º vencimento</th><th className="px-3 py-3 font-medium">Valor total</th><th className="px-3 py-3 text-right font-medium">Ação</th></tr></thead><tbody>{data.patients.map((patient) => <tr key={patient.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-[13px] font-medium">{patient.full_name}</td><td className="px-3 py-4 text-xs">{patient.billing_model === "package" ? "Pacote / plano" : "Por sessão"}</td><td className="px-3 py-4 text-xs">{patient.billing_model === "package" ? patient.package_payment_mode === "installments" ? `${patient.package_installments ?? 2} parcelas` : "À vista" : "Após cada atendimento"}</td><td className="px-3 py-4 text-xs">{patient.billing_model === "package" ? dateLabel(patient.package_first_due_date) : "—"}</td><td className="px-3 py-4 text-xs font-semibold">{patient.billing_model === "package" && patient.package_amount ? money(patient.package_amount) : patient.session_amount ? `${money(patient.session_amount)} / sessão` : "—"}</td><td className="px-3 py-4 text-right"><Button variant="quiet" size="sm" onClick={() => setEditingPatient(patient)}>Editar <ChevronRight /></Button></td></tr>)}</tbody></table>{data.patients.length === 0 && <p className="py-10 text-center text-xs text-muted-foreground">Cadastre pacientes para configurar os ciclos de cobrança.</p>}</div>
        </section>
      )}

      {modal === "revenue" && <RevenueModal onClose={() => setModal(null)} onSave={async (entry, requestId) => { await saveRevenue(entry, requestId); setModal(null); }} />}
      {modal === "expense" && <ExpenseModal initialExpense={editingExpense} onClose={() => { setEditingExpense(null); setModal(null); }} onSave={async (entry, requestId) => { await saveExpense(entry, requestId); setEditingExpense(null); setModal(null); }} />}
      {editingReceipt && <ReceiptModal entry={editingReceipt} onClose={() => setEditingReceipt(null)} onSave={saveReceipt} />}
      {editingPatient && <PatientBillingModal patient={editingPatient} onClose={() => setEditingPatient(null)} onSave={savePatientBilling} />}
    </>
  );
}

function Metric({ label, value, note, icon, tone = "default", loading = false, error = false, onClick }: { label: string; value: string; note: string; icon: ReactNode; tone?: "default" | "positive" | "negative"; loading?: boolean; error?: boolean; onClick?: (() => void) | undefined }) {
  const valueTone = tone === "negative" ? "text-destructive" : tone === "positive" ? "text-primary" : "text-foreground";
  const content = <><div className="flex items-start justify-between gap-3"><p className="text-xs font-medium text-muted-foreground">{label}</p><span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-primary [&_svg]:size-5">{icon}</span></div>{loading ? <><div className="mt-4 h-8 w-36 animate-pulse rounded-lg bg-muted/70" /><div className="mt-4 h-3 w-44 animate-pulse rounded bg-muted/60" /></> : <><p className={`mt-3 min-h-[2.6rem] font-display text-[28px] leading-[1.15] tabular-nums sm:text-[30px] ${error ? "text-muted-foreground" : valueTone}`}>{error ? "—" : value}</p><p className={`mt-3 min-h-4 text-[11px] leading-4 ${error ? "text-destructive" : "text-muted-foreground"}`}>{error ? "Não foi possível carregar os dados financeiros." : note}</p></>}</>;
  if (onClick) return <button type="button" onClick={onClick} className="dashboard-card rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{content}</button>;
  return <article className="dashboard-card rounded-2xl p-5">{content}</article>;
}

function MovementFilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{children}</button>;
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const numeric = Number(amount.replace(",", "."));
    if (!client.trim() || !Number.isFinite(numeric) || numeric <= 0) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ source_type: source, client_name: client.trim(), description: description.trim() || sourceLabels[source], competence_date: competence, issued_at: isoToday(), due_date: dueDate || null, amount: numeric, status: paid ? "paid" : "pending", payment_method: paid ? paymentMethod : null }, requestId);
    } catch {
      setError("Não foi possível salvar a receita. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return <Modal title="Nova receita" subtitle="Registre entradas de atendimentos, pacotes, empresas, testes e outros serviços." onClose={onClose}><div className="grid gap-4 p-5 sm:grid-cols-2"><div className="rounded-xl border border-primary/15 bg-primary/5 p-3 text-xs sm:col-span-2"><span className="font-medium">Tipo de movimentação:</span> Receita / entrada</div><FieldLabel label="Origem"><select value={source} onChange={(event) => setSource(event.target.value as RevenueSource)} className="input-finance">{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FieldLabel><FieldLabel label="Cliente / paciente / empresa"><input value={client} onChange={(event) => setClient(event.target.value)} className="input-finance" placeholder="Ex.: Mariana Souza" /></FieldLabel><FieldLabel label="Descrição"><input value={description} onChange={(event) => setDescription(event.target.value)} className="input-finance" placeholder="Descrição do serviço" /></FieldLabel><FieldLabel label="Valor"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input-finance" placeholder="0,00" /></FieldLabel><FieldLabel label="Competência"><input type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} className="input-finance" /></FieldLabel><FieldLabel label="Vencimento"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="input-finance" /></FieldLabel><label className="flex items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-xs sm:col-span-2"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> Já foi recebido</label>{paid && <FieldLabel label="Forma de pagamento"><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className="input-finance">{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FieldLabel>}{error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 pt-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" onClick={() => void submit()} disabled={saving || !client.trim() || !amount}>{saving ? "Salvando..." : "Salvar receita"}</Button></div></div></Modal>;
}

function ReceiptModal({ entry, onClose, onSave }: { entry: BillingEntry; onClose: () => void; onSave: (input: { id: string; received_amount: number; received_at: string; payment_method: PaymentMethod }) => Promise<void> }) {
  const isExistingReceipt = Number(entry.received_amount || 0) > 0;
  const [amount, setAmount] = useState(String(entry.received_amount || entry.amount).replace(".", ","));
  const [receivedAt, setReceivedAt] = useState(entry.received_at ?? isoToday());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(entry.payment_method ?? "pix");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    const numeric = Number(amount.replace(",", "."));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Informe um valor recebido válido.");
      return;
    }
    if (numeric > Number(entry.amount)) {
      setError(`O recebimento não pode ser maior que o valor faturado (${money(Number(entry.amount))}).`);
      return;
    }
    if (!receivedAt) {
      setError("Informe a data do recebimento.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({ id: entry.id, received_amount: numeric, received_at: receivedAt, payment_method: paymentMethod });
    } catch {
      setError("Não foi possível atualizar o recebimento. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isExistingReceipt ? "Editar recebimento" : "Registrar recebimento"} subtitle={isExistingReceipt ? "Corrija a baixa financeira sem alterar a cobrança que a originou." : "Informe valor, data e forma de pagamento para registrar a baixa."} onClose={onClose}>
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/50 p-3 text-xs sm:col-span-2">
          <p className="font-medium">{entry.client_name}</p>
          <p className="mt-1 text-muted-foreground">Faturado: {money(Number(entry.amount))} • {sourceLabels[entry.source_type]}</p>
        </div>
        <FieldLabel label="Valor recebido">
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input-finance" />
        </FieldLabel>
        <FieldLabel label="Data do recebimento">
          <input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} className="input-finance" />
        </FieldLabel>
        <FieldLabel label="Forma de pagamento">
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className="input-finance">{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </FieldLabel>
        <p className="text-[10px] leading-4 text-muted-foreground sm:col-span-2">
          Esta edição altera somente o recebimento. O valor faturado e o vínculo com sessão, pacote ou serviço permanecem preservados.
        </p>
        {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="dashboard" onClick={() => void submit()} disabled={saving}>{saving ? "Salvando..." : isExistingReceipt ? "Salvar alteração" : "Registrar recebimento"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function ExpenseModal({ initialExpense, onClose, onSave }: { initialExpense?: ExpenseEntry | null; onClose: () => void; onSave: (entry: Omit<ExpenseEntry, "id" | "paid_at">, requestId: string) => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const [category, setCategory] = useState(initialExpense?.category ?? "transporte");
  const [description, setDescription] = useState(initialExpense?.description ?? "");
  const [amount, setAmount] = useState(initialExpense ? String(initialExpense.amount).replace(".", ",") : "");
  const [competence, setCompetence] = useState(initialExpense?.competence_date ?? isoToday());
  const [recurrence, setRecurrence] = useState<"fixed" | "variable">(initialExpense?.recurrence ?? "variable");
  const [fixedDay, setFixedDay] = useState(() => Number((initialExpense?.due_date ?? initialExpense?.competence_date ?? isoToday()).slice(8, 10)) || 5);
  const [paid, setPaid] = useState(initialExpense ? initialExpense.status === "paid" : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEditing = Boolean(initialExpense);

  const submit = async () => {
    const numeric = Number(amount.replace(",", "."));
    if (!description.trim() || !Number.isFinite(numeric) || numeric <= 0) return;
    if (recurrence === "fixed" && (!Number.isInteger(fixedDay) || fixedDay < 1 || fixedDay > 28)) {
      setError("Informe um dia fixo entre 1 e 28.");
      return;
    }
    const dueDate = recurrence === "fixed" ? `${competence.slice(0, 7)}-${String(fixedDay).padStart(2, "0")}` : competence;
    setSaving(true);
    setError("");
    try {
      await onSave({ category, description: description.trim(), competence_date: competence, due_date: dueDate, amount: numeric, recurrence, status: paid ? "paid" : "pending", fixed_rule_id: initialExpense?.fixed_rule_id ?? null }, requestId);
    } catch {
      setError(isEditing ? "Não foi possível atualizar a despesa. Tente novamente." : "Não foi possível salvar a despesa. Tente novamente.");
    } finally {
      setSaving(false);
    }
  };

  return <Modal title={isEditing ? "Editar despesa" : "Nova despesa"} subtitle={isEditing ? "Atualize os dados da despesa selecionada." : "Registre custos variáveis ou uma despesa fixa mensal."} onClose={onClose}><div className="grid gap-4 p-5 sm:grid-cols-2"><div className="rounded-xl border border-destructive/15 bg-destructive/5 p-3 text-xs sm:col-span-2"><span className="font-medium">Tipo de movimentação:</span> Despesa / saída</div><FieldLabel label="Categoria"><select value={category} onChange={(event) => setCategory(event.target.value)} className="input-finance">{Object.entries(expenseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FieldLabel><FieldLabel label="Descrição"><input value={description} onChange={(event) => setDescription(event.target.value)} className="input-finance" placeholder="Ex.: Aluguel do consultório" /></FieldLabel><FieldLabel label="Valor"><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="input-finance" placeholder="0,00" /></FieldLabel><FieldLabel label={recurrence === "fixed" ? "Mês inicial" : "Competência"}><input type="date" value={competence} onChange={(event) => setCompetence(event.target.value)} className="input-finance" /></FieldLabel><FieldLabel label="Tipo"><select value={recurrence} onChange={(event) => setRecurrence(event.target.value as "fixed" | "variable")} className="input-finance"><option value="variable">Variável / avulsa</option><option value="fixed">Fixa mensal</option></select></FieldLabel>{recurrence === "fixed" && <FieldLabel label="Dia fixo todo mês"><input type="number" min={1} max={28} value={fixedDay} onChange={(event) => setFixedDay(Number(event.target.value))} className="input-finance" /></FieldLabel>} {recurrence === "fixed" && <div className="rounded-xl border border-border bg-background/45 p-3 text-[10px] leading-4 text-muted-foreground sm:col-span-2">O sistema criará esta despesa automaticamente nos próximos meses com o mesmo valor e vencimento no dia {fixedDay || "—"}.</div>}<label className="flex items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-xs sm:col-span-2"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /> {recurrence === "fixed" ? "A despesa deste primeiro mês já foi paga" : "Já foi paga"}</label>{error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 pt-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" onClick={() => void submit()} disabled={saving || !description.trim() || !amount}>{saving ? (isEditing ? "Salvando alterações..." : "Salvando...") : (isEditing ? "Salvar alterações" : "Salvar despesa")}</Button></div></div></Modal>;
}

function PatientBillingModal({ patient, onClose, onSave }: { patient: PatientBilling; onClose: () => void; onSave: (patient: PatientBilling) => Promise<void> }) {
  const [draft, setDraft] = useState<PatientBilling>({
    ...patient,
    package_payment_mode: patient.package_payment_mode ?? "single",
    package_installments: patient.package_installments ?? 2,
    package_first_due_date: patient.package_first_due_date ?? isoToday(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const paymentMode = draft.package_payment_mode === "installments" ? "installments" : "single";
  const installmentCount = paymentMode === "single" ? 1 : Math.max(1, Math.min(60, Math.trunc(Number(draft.package_installments ?? 1))));
  const preview = packageInstallmentPreview(Number(draft.package_amount ?? 0), installmentCount, draft.package_first_due_date ?? "");
  const save = async () => {
    if (draft.billing_model === "package") {
      if (!draft.package_amount || draft.package_amount <= 0) { setError("Informe o valor total do pacote/plano."); return; }
      if (!draft.package_first_due_date) { setError("Informe o primeiro vencimento."); return; }
    }
    setSaving(true);
    setError("");
    try { await onSave({ ...draft, package_payment_mode: paymentMode, package_installments: installmentCount }); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a regra de cobrança."); } finally { setSaving(false); }
  };
  return <Modal title="Regra de cobrança" subtitle={patient.full_name} onClose={onClose}><div className="grid gap-4 p-5 sm:grid-cols-2"><FieldLabel label="Modelo de cobrança"><select value={draft.billing_model} onChange={(event) => setDraft((current) => ({ ...current, billing_model: event.target.value as "session" | "package" }))} className="input-finance"><option value="session">Por sessão</option><option value="package">Pacote / plano</option></select></FieldLabel>{draft.billing_model === "session" && <FieldLabel label="Valor padrão da sessão"><input inputMode="decimal" value={draft.session_amount ?? ""} onChange={(event) => setDraft((current) => ({ ...current, session_amount: Number(event.target.value.replace(",", ".")) || null }))} className="input-finance" placeholder="0,00" /></FieldLabel>}{draft.billing_model === "package" && <><FieldLabel label="Valor total do pacote / plano"><input inputMode="decimal" value={draft.package_amount ?? ""} onChange={(event) => setDraft((current) => ({ ...current, package_amount: Number(event.target.value.replace(",", ".")) || null }))} className="input-finance" /></FieldLabel><FieldLabel label="Forma de pagamento"><select value={paymentMode} onChange={(event) => setDraft((current) => ({ ...current, package_payment_mode: event.target.value as "single" | "installments" }))} className="input-finance"><option value="single">À vista</option><option value="installments">Parcelado</option></select></FieldLabel>{paymentMode === "installments" && <FieldLabel label="Número de parcelas"><input type="number" min={1} max={60} value={draft.package_installments ?? 1} onChange={(event) => setDraft((current) => ({ ...current, package_installments: Number(event.target.value) }))} className="input-finance" /></FieldLabel>}<FieldLabel label={paymentMode === "single" ? "Data prevista de pagamento" : "Vencimento da 1ª parcela"}><input type="date" value={draft.package_first_due_date ?? ""} onChange={(event) => setDraft((current) => ({ ...current, package_first_due_date: event.target.value }))} className="input-finance" /></FieldLabel><div className="rounded-2xl border border-border bg-background/45 p-4 sm:col-span-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Prévia das cobranças em A receber</p><div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">{preview.map((item)=><div key={item.number} className="flex items-center justify-between gap-3 rounded-xl bg-card/70 px-3 py-2 text-xs"><span>{paymentMode === "single" ? "Pagamento único" : `Parcela ${item.number}/${preview.length}`} • {dateLabel(item.dueDate)}</span><strong>{money(item.amount)}</strong></div>)}</div></div></>}{error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 pt-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" onClick={() => void save()} disabled={saving}>{saving ? "Salvando..." : "Salvar regra"}</Button></div></div></Modal>;
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">{label}</span>{children}</label>;
}
