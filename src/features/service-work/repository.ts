import { supabase } from "../../lib/supabase";
import type { ServiceWorkEntry, ServiceWorkEntryInput } from "./types";

const FIELDS = "id,kind,client_name,description,amount,due_date,status,paid_at,payment_method,notes,created_at,updated_at";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase não configurado.");
  return supabase;
}

export async function listServiceWorkEntries(startDate: string, endExclusive: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("service_work_entries")
    .select(FIELDS)
    .gte("due_date", startDate)
    .lt("due_date", endExclusive)
    .order("due_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ServiceWorkEntry[];
}

export async function createServiceWorkEntry(input: ServiceWorkEntryInput) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_service_work_entry", {
    p_kind: input.kind,
    p_client_name: input.client_name ?? null,
    p_description: input.description,
    p_amount: input.amount,
    p_due_date: input.due_date,
    p_status: input.status,
    p_paid_at: input.paid_at ?? null,
    p_payment_method: input.payment_method ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateServiceWorkEntry(id: string, input: ServiceWorkEntryInput) {
  const client = requireSupabase();
  const { error } = await client.rpc("update_service_work_entry", {
    p_id: id,
    p_kind: input.kind,
    p_client_name: input.client_name ?? null,
    p_description: input.description,
    p_amount: input.amount,
    p_due_date: input.due_date,
    p_status: input.status,
    p_paid_at: input.paid_at ?? null,
    p_payment_method: input.payment_method ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
}

export async function deleteServiceWorkEntry(id: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("delete_service_work_entry", { p_id: id });
  if (error) throw error;
}

export async function markServiceWorkPaid(id: string, paidAt: string, paymentMethod: string | null) {
  const client = requireSupabase();
  const { error } = await client.rpc("mark_service_work_paid", {
    p_id: id,
    p_paid_at: paidAt,
    p_payment_method: paymentMethod,
  });
  if (error) throw error;
}
