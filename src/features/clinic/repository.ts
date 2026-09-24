import { supabase } from "../../lib/supabase";
import type {
  AppSettingsRow,
  AppointmentRow,
  ClinicalNoteRow,
  MaterialRow,
  PatientRow,
  ReportsBundle,
} from "./types";

const MAX_ROWS = 1_000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_UPLOADS = new Map<string, string>([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

function requireSupabase() {
  if (!supabase) throw new Error("Supabase não configurado");
  return supabase;
}

function cleanText(value: string | null | undefined, max: number) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, max) : null;
}

function safeMoney(value: number | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw new Error("Valor inválido");
  }
  return Math.round(number * 100) / 100;
}

async function detectSafeMime(file: File) {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("O arquivo deve ter no máximo 10 MB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = new TextDecoder().decode(bytes);
  let detected: string | null = null;
  if (ascii.startsWith("%PDF-")) detected = "application/pdf";
  else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) detected = "image/png";
  else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) detected = "image/jpeg";
  else if (ascii.slice(0, 4) === "RIFF" && ascii.slice(8, 12) === "WEBP") detected = "image/webp";
  if (!detected || !ALLOWED_UPLOADS.has(detected)) throw new Error("Tipo de arquivo não permitido. Use PDF, PNG, JPG ou WEBP.");
  if (file.type && file.type !== detected && !(file.type === "image/jpg" && detected === "image/jpeg")) {
    throw new Error("O conteúdo do arquivo não corresponde ao tipo informado.");
  }
  return detected;
}

export async function listPatients() {
  const client = requireSupabase();
  const { data, error } = await client
    .from("patients")
    .select("id,full_name,phone,email,active,billing_model,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at")
    .is("archived_at", null)
    .order("full_name")
    .limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []) as PatientRow[];
}

export async function createPatient(input: Partial<PatientRow> & Pick<PatientRow, "full_name">, clientRequestId = crypto.randomUUID()) {
  const client = requireSupabase();
  const fullName = cleanText(input.full_name, 160);
  if (!fullName || fullName.length < 2) throw new Error("Nome do paciente inválido");
  const billingModel = input.billing_model === "package" ? "package" : "session";
  const { data, error } = await client.from("patients").insert({
    client_request_id: clientRequestId,
    full_name: fullName,
    phone: cleanText(input.phone, 40),
    email: cleanText(input.email, 254),
    active: input.active ?? true,
    billing_model: billingModel,
    package_amount: billingModel === "package" ? safeMoney(input.package_amount) : null,
    package_timing: billingModel === "package" ? (input.package_timing ?? "current_month") : null,
    billing_day: billingModel === "package" ? Math.max(1, Math.min(28, Number(input.billing_day ?? 5))) : null,
    notes_admin: cleanText(input.notes_admin, 4000),
  }).select("id,full_name,phone,email,active,billing_model,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await client.from("patients").select("id,full_name,phone,email,active,billing_model,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at").eq("client_request_id", clientRequestId).maybeSingle();
      if (!existing.error && existing.data) return existing.data as PatientRow;
    }
    throw error;
  }
  return data as PatientRow;
}

export async function updatePatient(id: string, patch: Partial<PatientRow>) {
  const client = requireSupabase();
  const allowed: Record<string, unknown> = {};
  if (patch.full_name !== undefined) allowed.full_name = cleanText(patch.full_name, 160);
  if (patch.phone !== undefined) allowed.phone = cleanText(patch.phone, 40);
  if (patch.email !== undefined) allowed.email = cleanText(patch.email, 254);
  if (patch.active !== undefined) allowed.active = Boolean(patch.active);
  if (patch.billing_model !== undefined) allowed.billing_model = patch.billing_model === "package" ? "package" : "session";
  if (patch.package_amount !== undefined) allowed.package_amount = patch.package_amount == null ? null : safeMoney(patch.package_amount);
  if (patch.package_timing !== undefined) allowed.package_timing = patch.package_timing;
  if (patch.billing_day !== undefined) allowed.billing_day = patch.billing_day == null ? null : Math.max(1, Math.min(28, Number(patch.billing_day)));
  if (patch.notes_admin !== undefined) allowed.notes_admin = cleanText(patch.notes_admin, 4000);
  const { data, error } = await client.from("patients").update(allowed).eq("id", id).is("archived_at", null).select("id,full_name,phone,email,active,billing_model,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at").single();
  if (error) throw error;
  return data as PatientRow;
}

export async function deletePatient(id: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("archive_patient", { p_id: id });
  if (error) throw error;
}

export async function listAppointments(startIso: string, endIso: string) {
  const client = requireSupabase();
  const { data, error } = await client.from("appointments")
    .select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,amount,notes_admin,created_at")
    .gte("scheduled_at", startIso).lt("scheduled_at", endIso).order("scheduled_at").limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []) as AppointmentRow[];
}

export async function createAppointment(input: Omit<AppointmentRow, "id" | "created_at">, clientRequestId = crypto.randomUUID()) {
  const client = requireSupabase();
  const payload = {
    client_request_id: clientRequestId,
    patient_id: input.patient_id || null,
    patient_name: cleanText(input.patient_name, 160),
    scheduled_at: input.scheduled_at,
    duration_minutes: Math.max(10, Math.min(240, Number(input.duration_minutes || 50))),
    modality: input.modality === "online" ? "online" : "presential",
    status: input.status,
    service_kind: input.service_kind,
    amount: safeMoney(input.amount),
    notes_admin: cleanText(input.notes_admin, 4000),
  };
  const { data, error } = await client.from("appointments").insert(payload).select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,amount,notes_admin,created_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await client.from("appointments").select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,amount,notes_admin,created_at").eq("client_request_id", clientRequestId).maybeSingle();
      if (!existing.error && existing.data) return existing.data as AppointmentRow;
    }
    throw error;
  }
  return data as AppointmentRow;
}

export async function updateAppointment(id: string, patch: Partial<AppointmentRow>) {
  const client = requireSupabase();
  const allowed: Record<string, unknown> = {};
  if (patch.patient_id !== undefined) allowed.patient_id = patch.patient_id || null;
  if (patch.patient_name !== undefined) allowed.patient_name = cleanText(patch.patient_name, 160);
  if (patch.scheduled_at !== undefined) allowed.scheduled_at = patch.scheduled_at;
  if (patch.duration_minutes !== undefined) allowed.duration_minutes = Math.max(10, Math.min(240, Number(patch.duration_minutes)));
  if (patch.modality !== undefined) allowed.modality = patch.modality;
  if (patch.status !== undefined) allowed.status = patch.status;
  if (patch.service_kind !== undefined) allowed.service_kind = patch.service_kind;
  if (patch.amount !== undefined) allowed.amount = safeMoney(patch.amount);
  if (patch.notes_admin !== undefined) allowed.notes_admin = cleanText(patch.notes_admin, 4000);
  const { data, error } = await client.from("appointments").update(allowed).eq("id", id).select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,amount,notes_admin,created_at").single();
  if (error) throw error;
  return data as AppointmentRow;
}

// Mantém histórico: "excluir" um atendimento apenas o cancela.
export async function deleteAppointment(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("appointments").update({ status: "cancelled" }).eq("id", id);
  if (error) throw error;
}

export async function listMaterials() {
  const client = requireSupabase();
  const { data, error } = await client.from("materials").select("id,title,category,file_path,file_type,notes,created_at").order("created_at", { ascending: false }).limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []) as MaterialRow[];
}

export async function uploadMaterial(file: File, title: string, category: string, notes: string, clientRequestId = crypto.randomUUID()) {
  const client = requireSupabase();
  const mime = await detectSafeMime(file);
  const extension = ALLOWED_UPLOADS.get(mime)!;
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Usuário não autenticado");
  const path = `${userData.user.id}/${clientRequestId}.${extension}`;
  const existing = await client.from("materials").select("id,title,category,file_path,file_type,notes,created_at").eq("client_request_id", clientRequestId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as MaterialRow;
  const { error: uploadError } = await client.storage.from("materials-private").upload(path, file, { contentType: mime, upsert: true, cacheControl: "0" });
  if (uploadError) throw uploadError;
  const { data, error } = await client.from("materials").insert({
    client_request_id: clientRequestId,
    title: cleanText(title, 180),
    category: cleanText(category, 100),
    file_path: path,
    file_type: mime,
    notes: cleanText(notes, 2000),
  }).select("id,title,category,file_path,file_type,notes,created_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const retry = await client.from("materials").select("id,title,category,file_path,file_type,notes,created_at").eq("client_request_id", clientRequestId).maybeSingle();
      if (!retry.error && retry.data) return retry.data as MaterialRow;
    }
    await client.storage.from("materials-private").remove([path]);
    throw error;
  }
  return data as MaterialRow;
}

export async function openMaterial(path: string) {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Usuário não autenticado");
  if (!path.startsWith(`${userData.user.id}/`)) throw new Error("Caminho de arquivo inválido");
  const { data, error } = await client.storage.from("materials-private").createSignedUrl(path, 60, { download: true });
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteMaterial(material: MaterialRow) {
  const client = requireSupabase();
  if (material.file_path) {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) throw userError ?? new Error("Usuário não autenticado");
    if (!material.file_path.startsWith(`${userData.user.id}/`)) throw new Error("Caminho de arquivo inválido");
    const { error: storageError } = await client.storage.from("materials-private").remove([material.file_path]);
    if (storageError) throw storageError;
  }
  const { error } = await client.from("materials").delete().eq("id", material.id);
  if (error) throw error;
}

export async function grantClinicalAccess(patientId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("grant_clinical_access", { p_patient_id: patientId });
  if (error) throw error;
  return data as string;
}

export async function revokeClinicalAccess(patientId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("revoke_clinical_access", { p_patient_id: patientId });
  if (error) throw error;
}

export async function listClinicalNotes(patientId: string) {
  const client = requireSupabase();
  const { data, error } = await client.from("clinical_notes")
    .select("id,patient_id,appointment_id,note_date,title,content_ciphertext,content_iv,archived_at,created_at")
    .eq("patient_id", patientId).is("archived_at", null)
    .order("note_date", { ascending: false }).order("created_at", { ascending: false }).limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []) as ClinicalNoteRow[];
}

export async function createClinicalNote(input: Omit<ClinicalNoteRow, "id" | "created_at" | "archived_at">, clientRequestId = crypto.randomUUID()) {
  const client = requireSupabase();
  const { data, error } = await client.from("clinical_notes").insert({
    client_request_id: clientRequestId,
    patient_id: input.patient_id,
    appointment_id: input.appointment_id || null,
    note_date: input.note_date,
    title: "Evolução",
    content_ciphertext: input.content_ciphertext,
    content_iv: input.content_iv,
  }).select("id,patient_id,appointment_id,note_date,title,content_ciphertext,content_iv,archived_at,created_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await client.from("clinical_notes").select("id,patient_id,appointment_id,note_date,title,content_ciphertext,content_iv,archived_at,created_at").eq("client_request_id", clientRequestId).maybeSingle();
      if (!existing.error && existing.data) return existing.data as ClinicalNoteRow;
    }
    throw error;
  }
  return data as ClinicalNoteRow;
}

export async function deleteClinicalNote(id: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("archive_clinical_note", { p_id: id });
  if (error) throw error;
}

export async function getAppSettings() {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Usuário não autenticado");
  const fields = "owner_id,professional_name,crp,phone,email,vault_salt,vault_verifier_ciphertext,vault_verifier_iv";
  const { data, error } = await client.from("app_settings").select(fields).eq("owner_id", userData.user.id).maybeSingle();
  if (error) throw error;
  if (data) return data as AppSettingsRow;
  const { data: created, error: createError } = await client.from("app_settings").insert({ owner_id: userData.user.id, email: userData.user.email ?? null }).select(fields).single();
  if (createError) throw createError;
  return created as AppSettingsRow;
}

export async function saveAppSettings(patch: Partial<AppSettingsRow>) {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Usuário não autenticado");
  const allowed: Record<string, unknown> = { owner_id: userData.user.id };
  if (patch.professional_name !== undefined) allowed.professional_name = cleanText(patch.professional_name, 160);
  if (patch.crp !== undefined) allowed.crp = cleanText(patch.crp, 40);
  if (patch.phone !== undefined) allowed.phone = cleanText(patch.phone, 40);
  if (patch.email !== undefined) allowed.email = cleanText(patch.email, 254);
  if (patch.vault_salt !== undefined) allowed.vault_salt = patch.vault_salt;
  if (patch.vault_verifier_ciphertext !== undefined) allowed.vault_verifier_ciphertext = patch.vault_verifier_ciphertext;
  if (patch.vault_verifier_iv !== undefined) allowed.vault_verifier_iv = patch.vault_verifier_iv;
  const fields = "owner_id,professional_name,crp,phone,email,vault_salt,vault_verifier_ciphertext,vault_verifier_iv";
  const { data, error } = await client.from("app_settings").upsert(allowed, { onConflict: "owner_id" }).select(fields).single();
  if (error) throw error;
  return data as AppSettingsRow;
}

export async function loadReports(startDate: string, endExclusive: string): Promise<ReportsBundle> {
  const client = requireSupabase();
  const startTs = `${startDate}T00:00:00`;
  const endTs = `${endExclusive}T00:00:00`;
  const [appointmentsResult, billingResult, receivedResult, receivablesResult, expensesResult] = await Promise.all([
    client.from("appointments").select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,amount,notes_admin,created_at").gte("scheduled_at", startTs).lt("scheduled_at", endTs).order("scheduled_at").limit(MAX_ROWS),
    client.from("billing_entries").select("id,source_type,amount,received_amount,status,competence_date,received_at").gte("competence_date", startDate).lt("competence_date", endExclusive).neq("status", "cancelled").limit(MAX_ROWS),
    client.from("billing_entries").select("id,received_amount,received_at").gte("received_at", startDate).lt("received_at", endExclusive).gt("received_amount", 0).limit(MAX_ROWS),
    client.from("billing_entries").select("id,amount,received_amount,status").in("status", ["pending", "partial"]).limit(MAX_ROWS),
    client.from("expenses").select("id,amount,competence_date").gte("competence_date", startDate).lt("competence_date", endExclusive).limit(MAX_ROWS),
  ]);
  const error = appointmentsResult.error ?? billingResult.error ?? receivedResult.error ?? receivablesResult.error ?? expensesResult.error;
  if (error) throw error;
  return {
    appointments: (appointmentsResult.data ?? []) as AppointmentRow[],
    billings: (billingResult.data ?? []) as ReportsBundle["billings"],
    received: (receivedResult.data ?? []) as ReportsBundle["received"],
    receivables: (receivablesResult.data ?? []) as ReportsBundle["receivables"],
    expenses: (expensesResult.data ?? []) as ReportsBundle["expenses"],
  };
}

export async function loadFinanceHistory(startDate: string, endExclusive: string) {
  const client = requireSupabase();
  const [billingResult, expenseResult] = await Promise.all([
    client.from("billing_entries").select("competence_date,amount,status").gte("competence_date", startDate).lt("competence_date", endExclusive).neq("status", "cancelled").limit(MAX_ROWS),
    client.from("expenses").select("competence_date,amount").gte("competence_date", startDate).lt("competence_date", endExclusive).limit(MAX_ROWS),
  ]);
  const error = billingResult.error ?? expenseResult.error;
  if (error) throw error;
  return { billings: billingResult.data ?? [], expenses: expenseResult.data ?? [] };
}
