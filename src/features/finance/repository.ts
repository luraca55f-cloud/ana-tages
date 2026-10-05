import { supabase } from "../../lib/supabase";
import { isTestMode } from "../../lib/test-mode";
import {
  testCreateExpense,
  testCreateRevenue,
  testDeleteExpense,
  testDeleteRevenueReceipt,
  testLoadFinanceBundle,
  testMarkExpensePaid,
  testMarkRevenuePaid,
  testUpdateExpense,
  testUpdatePatientBilling,
  testUpdateRevenueReceipt,
} from "../../lib/test-data";
import type { BillingEntry, ExpenseEntry, FinanceBundle, PatientBilling, PaymentMethod, RevenueSource } from "./types";

const MAX_ROWS = 1_000;

type PackagePlanSummary = {
  id: string;
  patient_id: string;
  payment_mode: "single" | "installments";
  installment_count: number;
  first_due_date: string;
};

function monthBounds(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Mês inválido");
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("Mês inválido");
  const start = `${month}-01`;
  const next = new Date(Date.UTC(year, monthNumber, 1));
  const endExclusive = next.toISOString().slice(0, 10);
  return { start, endExclusive };
}

function cleanText(value: string, max: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error("Campo obrigatório vazio");
  return normalized.slice(0, max);
}

function cleanMoney(value: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error("Valor inválido");
  return Math.round(amount * 100) / 100;
}

export async function loadFinanceBundle(month: string, includeReceivableDetails = false): Promise<FinanceBundle> {
  if (isTestMode()) return testLoadFinanceBundle(month, includeReceivableDetails);
  if (!supabase) throw new Error("Supabase não configurado");
  const ensure = await supabase.rpc("ensure_appointment_billings");
  if (ensure.error) throw ensure.error;
  const { start, endExclusive } = monthBounds(month);
  const ensureFixed = await supabase.rpc("ensure_fixed_expenses", { p_month: start });
  if (ensureFixed.error) throw ensureFixed.error;

  const billingFields = "id,patient_id,source_type,client_name,description,competence_date,issued_at,due_date,amount,status,received_amount,received_at,payment_method,package_plan_id,installment_number,installment_count";
  const [billedResult, receivedResult, receivablesResult, expensesResult, patientsResult, packagePlansResult] = await Promise.all([
    supabase.from("billing_entries").select(billingFields).gte("competence_date", start).lt("competence_date", endExclusive).neq("status", "cancelled").order("competence_date", { ascending: false }).limit(MAX_ROWS),
    supabase.from("billing_entries").select(billingFields).gte("received_at", start).lt("received_at", endExclusive).gt("received_amount", 0).order("received_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("billing_entries").select(billingFields).in("status", ["pending", "partial"]).order("due_date", { ascending: true }).limit(MAX_ROWS),
    supabase.from("expenses").select("id,category,description,competence_date,due_date,amount,recurrence,status,paid_at,fixed_rule_id").gte("competence_date", start).lt("competence_date", endExclusive).order("competence_date", { ascending: false }).limit(MAX_ROWS),
    supabase.from("patients").select("id,full_name,cpf,billing_model,session_amount,package_amount,package_timing,billing_day").eq("active", true).is("archived_at", null).order("full_name", { ascending: true }).limit(MAX_ROWS),
    supabase.from("package_plans").select("id,patient_id,total_amount,payment_mode,installment_count,first_due_date,status").eq("status", "active").limit(MAX_ROWS),
  ]);

  const firstError = billedResult.error ?? receivedResult.error ?? receivablesResult.error ?? expensesResult.error ?? patientsResult.error ?? packagePlansResult.error;
  if (firstError) throw firstError;

  const packagePlans = (packagePlansResult.data ?? []) as PackagePlanSummary[];
  const planByPatient = new Map<string, PackagePlanSummary>(packagePlans.map((plan) => [plan.patient_id, plan]));
  const patients = (patientsResult.data ?? []).map((patient) => {
    const plan = planByPatient.get(patient.id as string);
    return {
      ...patient,
      package_plan_id: plan?.id ?? null,
      package_payment_mode: plan?.payment_mode ?? null,
      package_installments: plan?.installment_count ?? null,
      package_first_due_date: plan?.first_due_date ?? null,
    } as PatientBilling;
  });

  // A visão completa de A receber precisa conhecer parcelas já pagas do mesmo pacote e o CPF
  // do paciente, mas o Dashboard não precisa carregar esse histórico em toda atualização.
  // Por isso estes dados adicionais só são buscados quando a tela Financeiro solicita detalhes.
  let packageBillings: BillingEntry[] = [];
  let patientDirectory: Array<{ id: string; full_name: string; cpf: string | null }> = [];
  if (includeReceivableDetails) {
    const [packageBillingsResult, patientDirectoryResult] = await Promise.all([
      supabase.from("billing_entries").select(billingFields).not("package_plan_id", "is", null).neq("status", "cancelled").order("due_date", { ascending: true }).limit(MAX_ROWS),
      supabase.from("patients").select("id,full_name,cpf").order("full_name", { ascending: true }).limit(MAX_ROWS),
    ]);
    const detailError = packageBillingsResult.error ?? patientDirectoryResult.error;
    if (detailError) throw detailError;
    packageBillings = (packageBillingsResult.data ?? []) as BillingEntry[];
    patientDirectory = (patientDirectoryResult.data ?? []) as Array<{ id: string; full_name: string; cpf: string | null }>;
  }

  return {
    billed: (billedResult.data ?? []) as BillingEntry[],
    receivedInPeriod: (receivedResult.data ?? []) as BillingEntry[],
    receivables: (receivablesResult.data ?? []) as BillingEntry[],
    packageBillings,
    expenses: (expensesResult.data ?? []) as ExpenseEntry[],
    patients,
    patientDirectory,
  };
}

export async function createRevenue(input: {
  source_type: RevenueSource;
  client_name: string;
  description: string;
  competence_date: string;
  issued_at: string;
  due_date: string | null;
  amount: number;
  status: "pending" | "paid";
  payment_method?: PaymentMethod | null;
  client_request_id?: string;
} ) {
  if (isTestMode()) return testCreateRevenue(input);
  if (!supabase) throw new Error("Supabase não configurado");
  const amount = cleanMoney(input.amount);
  const { error } = await supabase.rpc("create_manual_revenue", {
    p_source_type: input.source_type,
    p_client_name: cleanText(input.client_name, 160),
    p_description: cleanText(input.description, 500),
    p_competence_date: input.competence_date,
    p_issued_at: input.issued_at,
    p_due_date: input.due_date || null,
    p_amount: amount,
    p_paid: input.status === "paid",
    p_payment_method: input.status === "paid" ? input.payment_method ?? null : null,
    p_client_request_id: input.client_request_id ?? crypto.randomUUID(),
  });
  if (error) throw error;
}

export async function createExpense(input: {
  category: string;
  description: string;
  competence_date: string;
  due_date: string | null;
  amount: number;
  recurrence: "fixed" | "variable";
  status: "pending" | "paid";
  client_request_id?: string;
}) {
  if (isTestMode()) return testCreateExpense(input);
  if (!supabase) throw new Error("Supabase não configurado");
  const allowedCategories = new Set(["transporte","contador_inss","aluguel","condominio","faxina","internet","outros_fixos","outros"]);
  if (!allowedCategories.has(input.category)) throw new Error("Categoria inválida");
  const payload = {
    p_category: input.category,
    p_description: cleanText(input.description, 500),
    p_competence_date: input.competence_date,
    p_amount: cleanMoney(input.amount),
    p_paid: input.status === "paid",
    p_client_request_id: input.client_request_id ?? crypto.randomUUID(),
  };
  if (input.recurrence === "fixed") {
    const fixedDay = Number((input.due_date || input.competence_date).slice(8, 10));
    if (!Number.isInteger(fixedDay) || fixedDay < 1 || fixedDay > 28) throw new Error("Dia fixo inválido");
    const { error } = await supabase.rpc("create_fixed_expense", { ...payload, p_day_of_month: fixedDay });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.rpc("create_expense", {
    ...payload,
    p_due_date: input.due_date || null,
    p_recurrence: "variable",
  });
  if (error) throw error;
}

export async function markExpensePaid(id: string) {
  if (isTestMode()) return testMarkExpensePaid(id);
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("mark_expense_paid", { p_id: id });
  if (error) throw error;
}

export async function updateExpense(input: {
  id: string;
  category: string;
  description: string;
  competence_date: string;
  due_date: string | null;
  amount: number;
  recurrence: "fixed" | "variable";
  status: "pending" | "paid";
}) {
  if (isTestMode()) return testUpdateExpense({ ...input, paid_at: input.status === "paid" ? input.competence_date : null, fixed_rule_id: null });
  if (!supabase) throw new Error("Supabase não configurado");
  const allowedCategories = new Set(["transporte","contador_inss","aluguel","condominio","faxina","internet","outros_fixos","outros"]);
  if (!allowedCategories.has(input.category)) throw new Error("Categoria inválida");
  const { error } = await supabase.rpc("update_expense", {
    p_id: input.id,
    p_category: input.category,
    p_description: cleanText(input.description, 500),
    p_competence_date: input.competence_date,
    p_due_date: input.due_date || null,
    p_amount: cleanMoney(input.amount),
    p_recurrence: input.recurrence,
    p_paid: input.status === "paid",
  });
  if (error) throw error;
}

export async function deleteExpense(id: string) {
  if (isTestMode()) return testDeleteExpense(id);
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("delete_expense", { p_id: id });
  if (error) throw error;
}

export async function markRevenuePaid(id: string, _amount?: number) {
  if (isTestMode()) return testMarkRevenuePaid(id);
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("mark_billing_paid", { p_id: id });
  if (error) throw error;
}

// A baixa financeira é editável sem alterar ou excluir a cobrança original.
// Isso permite corrigir valor/data de um recebimento lançado incorretamente e preserva
// vínculos automáticos com sessão, pacote, paciente ou serviço.
export async function updateRevenueReceipt(input: { id: string; received_amount: number; received_at: string; payment_method: PaymentMethod }) {
  if (isTestMode()) return testUpdateRevenueReceipt(input);
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("update_billing_receipt", {
    p_id: input.id,
    p_received_amount: cleanMoney(input.received_amount),
    p_received_at: input.received_at,
    p_payment_method: input.payment_method,
  });
  if (error) throw error;
}

// "Excluir recebimento" significa desfazer a baixa e devolver a cobrança para A receber.
// Nunca remove a billing_entry, evitando perda de rastreabilidade financeira.
export async function deleteRevenueReceipt(id: string) {
  if (isTestMode()) return testDeleteRevenueReceipt(id);
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("delete_billing_receipt", { p_id: id });
  if (error) throw error;
}

export async function updatePatientBilling(input: PatientBilling): Promise<void> {
  if (isTestMode()) {
    testUpdatePatientBilling(input);
    return;
  }
  if (!supabase) throw new Error("Supabase não configurado");
  const model = input.billing_model === "package" ? "package" : "session";

  // Pacotes são configurados inteiramente na RPC para que plano + parcelas + resumo do paciente
  // sejam atualizados na mesma transação. Isso evita um paciente marcado como pacote sem cobranças.
  if (model === "package") {
    const total = input.package_amount == null ? 0 : cleanMoney(input.package_amount);
    if (total <= 0 || !input.package_first_due_date) throw new Error("Informe valor total e primeiro vencimento do pacote/plano.");
    const paymentMode = input.package_payment_mode === "installments" ? "installments" : "single";
    const count = paymentMode === "single" ? 1 : Math.max(1, Math.min(60, Math.trunc(Number(input.package_installments ?? 1))));
    const planResult = await supabase.rpc("save_patient_package_plan", {
      p_patient_id: input.id,
      p_total_amount: total,
      p_payment_mode: paymentMode,
      p_installment_count: count,
      p_first_due_date: input.package_first_due_date,
      p_client_request_id: crypto.randomUUID(),
    });
    if (planResult.error) throw planResult.error;
    return;
  }

  const cancelled = await supabase.rpc("cancel_patient_package_plan", { p_patient_id: input.id });
  if (cancelled.error) throw cancelled.error;
  const { error } = await supabase.from("patients").update({
    billing_model: "session",
    session_amount: input.session_amount != null ? cleanMoney(input.session_amount) : null,
    package_amount: null,
    package_timing: null,
    billing_day: null,
  }).eq("id", input.id).is("archived_at", null);
  if (error) throw error;
  return;
}
