import { supabase } from "../../lib/supabase";
import type { BillingEntry, ExpenseEntry, FinanceBundle, PatientBilling, RevenueSource } from "./types";

const MAX_ROWS = 1_000;

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

export async function loadFinanceBundle(month: string): Promise<FinanceBundle> {
  if (!supabase) throw new Error("Supabase não configurado");
  const ensure = await supabase.rpc("ensure_appointment_billings");
  if (ensure.error) throw ensure.error;
  const { start, endExclusive } = monthBounds(month);
  const ensureFixed = await supabase.rpc("ensure_fixed_expenses", { p_month: start });
  if (ensureFixed.error) throw ensureFixed.error;

  const [billedResult, receivedResult, receivablesResult, expensesResult, patientsResult] = await Promise.all([
    supabase.from("billing_entries").select("id,source_type,client_name,description,competence_date,issued_at,due_date,amount,status,received_amount,received_at").gte("competence_date", start).lt("competence_date", endExclusive).neq("status", "cancelled").order("competence_date", { ascending: false }).limit(MAX_ROWS),
    supabase.from("billing_entries").select("id,source_type,client_name,description,competence_date,issued_at,due_date,amount,status,received_amount,received_at").gte("received_at", start).lt("received_at", endExclusive).gt("received_amount", 0).order("received_at", { ascending: false }).limit(MAX_ROWS),
    supabase.from("billing_entries").select("id,source_type,client_name,description,competence_date,issued_at,due_date,amount,status,received_amount,received_at").in("status", ["pending", "partial"]).order("due_date", { ascending: true }).limit(MAX_ROWS),
    supabase.from("expenses").select("id,category,description,competence_date,due_date,amount,recurrence,status,paid_at,fixed_rule_id").gte("competence_date", start).lt("competence_date", endExclusive).order("competence_date", { ascending: false }).limit(MAX_ROWS),
    supabase.from("patients").select("id,full_name,billing_model,session_amount,package_amount,package_timing,billing_day").eq("active", true).is("archived_at", null).order("full_name", { ascending: true }).limit(MAX_ROWS),
  ]);

  const firstError = billedResult.error ?? receivedResult.error ?? receivablesResult.error ?? expensesResult.error ?? patientsResult.error;
  if (firstError) throw firstError;

  return {
    billed: (billedResult.data ?? []) as BillingEntry[],
    receivedInPeriod: (receivedResult.data ?? []) as BillingEntry[],
    receivables: (receivablesResult.data ?? []) as BillingEntry[],
    expenses: (expensesResult.data ?? []) as ExpenseEntry[],
    patients: (patientsResult.data ?? []) as PatientBilling[],
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
  client_request_id?: string;
}) {
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
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("delete_expense", { p_id: id });
  if (error) throw error;
}

export async function markRevenuePaid(id: string, _amount?: number) {
  if (!supabase) throw new Error("Supabase não configurado");
  const { error } = await supabase.rpc("mark_billing_paid", { p_id: id });
  if (error) throw error;
}

export async function updatePatientBilling(input: PatientBilling) {
  if (!supabase) throw new Error("Supabase não configurado");
  const model = input.billing_model === "package" ? "package" : "session";
  const { error } = await supabase.from("patients").update({
    billing_model: model,
    session_amount: model === "session" && input.session_amount != null ? cleanMoney(input.session_amount) : null,
    package_amount: model === "package" && input.package_amount != null ? cleanMoney(input.package_amount) : null,
    package_timing: model === "package" ? (input.package_timing ?? "current_month") : null,
    billing_day: model === "package" ? Math.max(1, Math.min(28, Number(input.billing_day ?? 5))) : null,
  }).eq("id", input.id).is("archived_at", null);
  if (error) throw error;
}

export async function generatePackageBillingsForMonth(month: string) {
  if (!supabase) throw new Error("Supabase não configurado");
  const { start } = monthBounds(month);
  const { data, error } = await supabase.rpc("generate_package_billings", { p_month: start });
  if (error) throw error;
  return Number(data ?? 0);
}
