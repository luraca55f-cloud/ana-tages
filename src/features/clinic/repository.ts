import { supabase } from "../../lib/supabase";
import type {
  AppSettingsRow,
  AppointmentPaymentRow,
  AppointmentRow,
  ClinicalNoteRow,
  MaterialRow,
  PackagePlanRow,
  PatientRow,
  ReportsBundle,
  ServiceCatalogItem,
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

// CPF é armazenado somente com 11 dígitos. A máscara fica apenas na interface.
// A validação evita que recibos/notas futuros sejam emitidos com um documento claramente inválido.
function normalizeCpf(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) throw new Error("CPF inválido");
  const calc = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) sum += Number(digits[index]) * (length + 1 - index);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  if (calc(9) !== Number(digits[9]) || calc(10) !== Number(digits[10])) throw new Error("CPF inválido");
  return digits;
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
  const [patientsResult, plansResult] = await Promise.all([
    client
      .from("patients")
      .select("id,full_name,cpf,phone,email,active,billing_model,session_amount,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at")
      .is("archived_at", null)
      .order("full_name")
      .limit(MAX_ROWS),
    client
      .from("package_plans")
      .select("id,patient_id,total_amount,payment_mode,installment_count,first_due_date,status,created_at,updated_at")
      .eq("status", "active")
      .limit(MAX_ROWS),
  ]);
  const error = patientsResult.error ?? plansResult.error;
  if (error) throw error;
  const planByPatient = new Map(
    ((plansResult.data ?? []) as PackagePlanRow[]).map((plan) => [plan.patient_id, plan]),
  );
  return (patientsResult.data ?? []).map((raw) => {
    const patient = raw as Omit<PatientRow, "package_plan_id" | "package_payment_mode" | "package_installments" | "package_first_due_date">;
    const plan = planByPatient.get(patient.id);
    return {
      ...patient,
      package_plan_id: plan?.id ?? null,
      package_payment_mode: plan?.payment_mode ?? null,
      package_installments: plan?.installment_count ?? null,
      package_first_due_date: plan?.first_due_date ?? null,
    } as PatientRow;
  });
}

export async function createPatient(input: Partial<PatientRow> & Pick<PatientRow, "full_name">, clientRequestId = crypto.randomUUID()) {
  const client = requireSupabase();
  const fullName = cleanText(input.full_name, 160);
  if (!fullName || fullName.length < 2) throw new Error("Nome do paciente inválido");
  const billingModel = input.billing_model === "package" ? "package" : "session";
  const { data, error } = await client.from("patients").insert({
    client_request_id: clientRequestId,
    full_name: fullName,
    cpf: normalizeCpf(input.cpf),
    phone: cleanText(input.phone, 40),
    email: cleanText(input.email, 254),
    active: input.active ?? true,
    billing_model: billingModel,
    session_amount: billingModel === "session" && input.session_amount != null ? safeMoney(input.session_amount) : null,
    package_amount: billingModel === "package" ? safeMoney(input.package_amount) : null,
    package_timing: null,
    billing_day: null,
    notes_admin: cleanText(input.notes_admin, 4000),
  }).select("id,full_name,cpf,phone,email,active,billing_model,session_amount,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await client.from("patients").select("id,full_name,cpf,phone,email,active,billing_model,session_amount,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at").eq("client_request_id", clientRequestId).maybeSingle();
      if (!existing.error && existing.data) return { ...existing.data, package_plan_id: null, package_payment_mode: null, package_installments: null, package_first_due_date: null } as PatientRow;
    }
    throw error;
  }
  return { ...data, package_plan_id: null, package_payment_mode: null, package_installments: null, package_first_due_date: null } as PatientRow;
}

export async function updatePatient(id: string, patch: Partial<PatientRow>) {
  const client = requireSupabase();
  const allowed: Record<string, unknown> = {};
  if (patch.full_name !== undefined) allowed["full_name"] = cleanText(patch.full_name, 160);
  if (patch.cpf !== undefined) allowed["cpf"] = normalizeCpf(patch.cpf);
  if (patch.phone !== undefined) allowed["phone"] = cleanText(patch.phone, 40);
  if (patch.email !== undefined) allowed["email"] = cleanText(patch.email, 254);
  if (patch.active !== undefined) allowed["active"] = Boolean(patch.active);
  if (patch.billing_model !== undefined) allowed["billing_model"] = patch.billing_model === "package" ? "package" : "session";
  if (patch.session_amount !== undefined) allowed["session_amount"] = patch.session_amount == null ? null : safeMoney(patch.session_amount);
  if (patch.package_amount !== undefined) allowed["package_amount"] = patch.package_amount == null ? null : safeMoney(patch.package_amount);
  if (patch.package_timing !== undefined) allowed["package_timing"] = patch.package_timing;
  if (patch.billing_day !== undefined) allowed["billing_day"] = patch.billing_day == null ? null : Math.max(1, Math.min(28, Number(patch.billing_day)));
  if (patch.notes_admin !== undefined) allowed["notes_admin"] = cleanText(patch.notes_admin, 4000);
  const { data, error } = await client.from("patients").update(allowed).eq("id", id).is("archived_at", null).select("id,full_name,cpf,phone,email,active,billing_model,session_amount,package_amount,package_timing,billing_day,notes_admin,archived_at,created_at").single();
  if (error) throw error;
  return { ...data, package_plan_id: null, package_payment_mode: null, package_installments: null, package_first_due_date: null } as PatientRow;
}

// Pacote/plano financeiro é separado do cadastro do paciente para preservar histórico.
// A RPC cria/reconfigura as parcelas e mantém o vínculo paciente ↔ plano ↔ billing_entries.
export async function savePatientPackagePlan(input: {
  patient_id: string;
  total_amount: number;
  payment_mode: "single" | "installments";
  installment_count: number;
  first_due_date: string;
  client_request_id?: string;
}) {
  const client = requireSupabase();
  const total = safeMoney(input.total_amount);
  if (total <= 0) throw new Error("Informe o valor total do pacote/plano.");
  const installmentCount = input.payment_mode === "single" ? 1 : Math.max(2, Math.min(60, Math.trunc(input.installment_count)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.first_due_date)) throw new Error("Informe a data do primeiro pagamento.");
  const { data, error } = await client.rpc("save_patient_package_plan", {
    p_patient_id: input.patient_id,
    p_total_amount: total,
    p_payment_mode: input.payment_mode,
    p_installment_count: installmentCount,
    p_first_due_date: input.first_due_date,
    p_client_request_id: input.client_request_id ?? crypto.randomUUID(),
  });
  if (error) throw error;
  return data as string;
}

export async function cancelPatientPackagePlan(patientId: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("cancel_patient_package_plan", { p_patient_id: patientId });
  if (error) throw error;
}

export async function deletePatient(id: string) {
  const client = requireSupabase();
  const { error } = await client.rpc("archive_patient", { p_id: id });
  if (error) throw error;
}

export async function listAppointments(startIso: string, endIso: string) {
  const client = requireSupabase();
  const { data, error } = await client.from("appointments")
    .select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,service_name,amount,notes_admin,created_at")
    .gte("scheduled_at", startIso).lt("scheduled_at", endIso).order("scheduled_at").limit(MAX_ROWS);
  if (error) throw error;
  return (data ?? []) as AppointmentRow[];
}

export async function listAllAppointments() {
  const client = requireSupabase();
  const pageSize = 500;
  const rows: AppointmentRow[] = [];
  for (let from = 0; from < 10_000; from += pageSize) {
    const { data, error } = await client.from("appointments")
      .select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,service_name,amount,notes_admin,created_at")
      .order("scheduled_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as AppointmentRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export async function listAppointmentPayments(appointmentIds: string[]) {
  const client = requireSupabase();
  if (appointmentIds.length === 0) return [] as AppointmentPaymentRow[];
  const ensure = await client.rpc("ensure_appointment_billings");
  if (ensure.error) throw ensure.error;
  const uniqueIds = Array.from(new Set(appointmentIds));
  const rows: AppointmentPaymentRow[] = [];
  const chunkSize = 200;
  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    const ids = uniqueIds.slice(index, index + chunkSize);
    const { data, error } = await client
      .from("billing_entries")
      .select("id,appointment_id,status,amount,received_amount,received_at,payment_method")
      .in("appointment_id", ids)
      .order("created_at", { ascending: false });
    if (error) throw error;
    rows.push(...((data ?? []).filter((item) => item.appointment_id) as AppointmentPaymentRow[]));
  }
  return rows;
}

export async function getAppointmentPayment(appointmentId: string) {
  const client = requireSupabase();
  const ensure = await client.rpc("ensure_appointment_billings");
  if (ensure.error) throw ensure.error;
  const { data, error } = await client
    .from("billing_entries")
    .select("id,appointment_id,status,amount,received_amount,received_at,payment_method")
    .eq("appointment_id", appointmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AppointmentPaymentRow | null;
}

export async function markAppointmentPaid(appointmentId: string, paymentMethod: "pix" | "bank_transfer" | "cash" | "credit_card" | "debit_card" | "other") {
  const client = requireSupabase();
  const { error } = await client.rpc("mark_appointment_paid", { p_appointment_id: appointmentId, p_payment_method: paymentMethod });
  if (error) throw error;
}

export async function createAppointment(input: Omit<AppointmentRow, "id" | "created_at">, clientRequestId: string = crypto.randomUUID()) {
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
    service_name: cleanText(input.service_name, 120),
    amount: safeMoney(input.amount),
    notes_admin: cleanText(input.notes_admin, 4000),
  };
  const { data, error } = await client.from("appointments").insert(payload).select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,service_name,amount,notes_admin,created_at").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const existing = await client.from("appointments").select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,service_name,amount,notes_admin,created_at").eq("client_request_id", clientRequestId).maybeSingle();
      if (!existing.error && existing.data) return existing.data as AppointmentRow;
    }
    throw error;
  }
  return data as AppointmentRow;
}

export async function updateAppointment(id: string, patch: Partial<AppointmentRow>) {
  const client = requireSupabase();
  const allowed: Record<string, unknown> = {};
  if (patch.patient_id !== undefined) allowed["patient_id"] = patch.patient_id || null;
  if (patch.patient_name !== undefined) allowed["patient_name"] = cleanText(patch.patient_name, 160);
  if (patch.scheduled_at !== undefined) allowed["scheduled_at"] = patch.scheduled_at;
  if (patch.duration_minutes !== undefined) allowed["duration_minutes"] = Math.max(10, Math.min(240, Number(patch.duration_minutes)));
  if (patch.modality !== undefined) allowed["modality"] = patch.modality;
  if (patch.status !== undefined) allowed["status"] = patch.status;
  if (patch.service_kind !== undefined) allowed["service_kind"] = patch.service_kind;
  if (patch.service_name !== undefined) allowed["service_name"] = cleanText(patch.service_name, 120);
  if (patch.amount !== undefined) allowed["amount"] = safeMoney(patch.amount);
  if (patch.notes_admin !== undefined) allowed["notes_admin"] = cleanText(patch.notes_admin, 4000);
  const { data, error } = await client.from("appointments").update(allowed).eq("id", id).select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,service_name,amount,notes_admin,created_at").single();
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


function cleanServiceCatalog(value: ServiceCatalogItem[] | undefined) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 30) throw new Error("Lista de serviços inválida");
  const allowedKinds = new Set(["session", "psychological_test", "neuropsychology", "company", "other"]);
  const ids = new Set<string>();
  return value.map((item) => {
    const id = String(item.id || "").trim().slice(0, 64);
    const name = String(item.name || "").trim().slice(0, 120);
    if (!id || ids.has(id) || !name || !allowedKinds.has(item.kind)) throw new Error("Serviço inválido");
    ids.add(id);
    return { id, name, kind: item.kind, active: Boolean(item.active) };
  });
}

export async function getAppSettings() {
  const client = requireSupabase();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw userError ?? new Error("Usuário não autenticado");
  const fields = "owner_id,professional_name,cpf,crp,city,phone,email,vault_salt,vault_verifier_ciphertext,vault_verifier_iv,vault_version,vault_password_salt,vault_password_key_ciphertext,vault_password_key_iv,vault_recovery_salt,vault_recovery_key_ciphertext,vault_recovery_key_iv,vault_email_recovery_ciphertext,vault_email_recovery_iv,vault_email_recovery_version,service_catalog";
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

  // IMPORTANTE: não use upsert com owner_id neste ponto. O banco permite INSERT de owner_id,
  // mas não UPDATE dessa coluna (proteção intencional contra troca de proprietário). Um UPSERT
  // inclui owner_id no ramo UPDATE e pode falhar justamente ao salvar o cofre/serviços.
  // Primeiro atualizamos somente as colunas permitidas; se o registro ainda não existir, inserimos.
  const allowed: Record<string, unknown> = {};
  if (patch.professional_name !== undefined) allowed["professional_name"] = cleanText(patch.professional_name, 160);
  if (patch.cpf !== undefined) allowed["cpf"] = normalizeCpf(patch.cpf);
  if (patch.crp !== undefined) allowed["crp"] = cleanText(patch.crp, 40);
  if (patch.city !== undefined) allowed["city"] = cleanText(patch.city, 120);
  if (patch.phone !== undefined) allowed["phone"] = cleanText(patch.phone, 40);
  if (patch.email !== undefined) allowed["email"] = cleanText(patch.email, 254);
  if (patch.vault_salt !== undefined) allowed["vault_salt"] = patch.vault_salt;
  if (patch.vault_verifier_ciphertext !== undefined) allowed["vault_verifier_ciphertext"] = patch.vault_verifier_ciphertext;
  if (patch.vault_verifier_iv !== undefined) allowed["vault_verifier_iv"] = patch.vault_verifier_iv;
  if (patch.vault_version !== undefined) allowed["vault_version"] = patch.vault_version;
  if (patch.vault_password_salt !== undefined) allowed["vault_password_salt"] = patch.vault_password_salt;
  if (patch.vault_password_key_ciphertext !== undefined) allowed["vault_password_key_ciphertext"] = patch.vault_password_key_ciphertext;
  if (patch.vault_password_key_iv !== undefined) allowed["vault_password_key_iv"] = patch.vault_password_key_iv;
  if (patch.vault_recovery_salt !== undefined) allowed["vault_recovery_salt"] = patch.vault_recovery_salt;
  if (patch.vault_recovery_key_ciphertext !== undefined) allowed["vault_recovery_key_ciphertext"] = patch.vault_recovery_key_ciphertext;
  if (patch.vault_recovery_key_iv !== undefined) allowed["vault_recovery_key_iv"] = patch.vault_recovery_key_iv;
  if (patch.vault_email_recovery_ciphertext !== undefined) allowed["vault_email_recovery_ciphertext"] = patch.vault_email_recovery_ciphertext;
  if (patch.vault_email_recovery_iv !== undefined) allowed["vault_email_recovery_iv"] = patch.vault_email_recovery_iv;
  if (patch.vault_email_recovery_version !== undefined) allowed["vault_email_recovery_version"] = patch.vault_email_recovery_version;
  if (patch.service_catalog !== undefined) allowed["service_catalog"] = cleanServiceCatalog(patch.service_catalog);

  const fields = "owner_id,professional_name,cpf,crp,city,phone,email,vault_salt,vault_verifier_ciphertext,vault_verifier_iv,vault_version,vault_password_salt,vault_password_key_ciphertext,vault_password_key_iv,vault_recovery_salt,vault_recovery_key_ciphertext,vault_recovery_key_iv,vault_email_recovery_ciphertext,vault_email_recovery_iv,vault_email_recovery_version,service_catalog";
  const { data: updated, error: updateError } = await client
    .from("app_settings")
    .update(allowed)
    .eq("owner_id", userData.user.id)
    .select(fields)
    .maybeSingle();
  if (updateError) throw updateError;
  if (updated) return updated as AppSettingsRow;

  const { data: created, error: createError } = await client
    .from("app_settings")
    .insert({ owner_id: userData.user.id, email: userData.user.email ?? null, ...allowed })
    .select(fields)
    .single();
  if (createError) throw createError;
  return created as AppSettingsRow;
}

export async function loadReports(startDate: string, endExclusive: string): Promise<ReportsBundle> {
  const client = requireSupabase();
  const ensureFixed = await client.rpc("ensure_fixed_expenses", { p_month: startDate });
  if (ensureFixed.error) throw ensureFixed.error;
  const startTs = `${startDate}T00:00:00`;
  const endTs = `${endExclusive}T00:00:00`;
  const [appointmentsResult, billingResult, receivedResult, receivablesResult, expensesResult] = await Promise.all([
    client.from("appointments").select("id,patient_id,patient_name,scheduled_at,duration_minutes,modality,status,service_kind,service_name,amount,notes_admin,created_at").gte("scheduled_at", startTs).lt("scheduled_at", endTs).order("scheduled_at").limit(MAX_ROWS),
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
  const ensureFixed = await client.rpc("ensure_fixed_expenses_range", { p_start: startDate, p_end_exclusive: endExclusive });
  if (ensureFixed.error) throw ensureFixed.error;
  const [billingResult, receivedResult, expenseResult] = await Promise.all([
    client.from("billing_entries").select("competence_date,amount,status").gte("competence_date", startDate).lt("competence_date", endExclusive).neq("status", "cancelled").limit(MAX_ROWS),
    client.from("billing_entries").select("received_at,received_amount").gte("received_at", startDate).lt("received_at", endExclusive).gt("received_amount", 0).limit(MAX_ROWS),
    client.from("expenses").select("competence_date,amount").gte("competence_date", startDate).lt("competence_date", endExclusive).limit(MAX_ROWS),
  ]);
  const error = billingResult.error ?? receivedResult.error ?? expenseResult.error;
  if (error) throw error;
  return { billings: billingResult.data ?? [], received: receivedResult.data ?? [], expenses: expenseResult.data ?? [] };
}
