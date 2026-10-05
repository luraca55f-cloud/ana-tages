import type {
  AppSettingsRow,
  AppointmentPaymentRow,
  AppointmentRow,
  ClinicalNoteRow,
  MaterialRow,
  PackagePlanRow,
  PatientRow,
  ReportsBundle,
} from "../features/clinic/types";
import type { BillingEntry, ExpenseEntry, FinanceBundle, PatientBilling, PaymentMethod } from "../features/finance/types";
import type { ServiceWorkEntry, ServiceWorkEntryInput } from "../features/service-work/types";
import { getTestEmail } from "./test-mode";

const DB_KEY = "tages:test-db:v1";
const TEST_OWNER_ID = "00000000-0000-4000-8000-000000000032";
const MAX_LOCAL_FILE_BYTES = 2 * 1024 * 1024;

type TestBillingEntry = BillingEntry & { appointment_id?: string | null };
type TestMaterial = MaterialRow & { data_url?: string | null };

type TestDb = {
  version: 1;
  patients: PatientRow[];
  appointments: AppointmentRow[];
  billings: TestBillingEntry[];
  expenses: ExpenseEntry[];
  packagePlans: PackagePlanRow[];
  materials: TestMaterial[];
  clinicalNotes: ClinicalNoteRow[];
  serviceWork: ServiceWorkEntry[];
  settings: AppSettingsRow;
};

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultSettings(): AppSettingsRow {
  return {
    owner_id: TEST_OWNER_ID,
    professional_name: "Anna Karina Dias",
    cpf: null,
    crp: null,
    city: null,
    phone: null,
    email: getTestEmail() || null,
    vault_salt: null,
    vault_verifier_ciphertext: null,
    vault_verifier_iv: null,
    vault_version: null,
    vault_password_salt: null,
    vault_password_key_ciphertext: null,
    vault_password_key_iv: null,
    vault_recovery_salt: null,
    vault_recovery_key_ciphertext: null,
    vault_recovery_key_iv: null,
    vault_email_recovery_ciphertext: null,
    vault_email_recovery_iv: null,
    vault_email_recovery_version: null,
    service_catalog: [],
  };
}

function emptyDb(): TestDb {
  return {
    version: 1,
    patients: [],
    appointments: [],
    billings: [],
    expenses: [],
    packagePlans: [],
    materials: [],
    clinicalNotes: [],
    serviceWork: [],
    settings: defaultSettings(),
  };
}

function storage() {
  if (typeof window === "undefined") throw new Error("O perfil de teste só está disponível no navegador.");
  return window.localStorage;
}

export function readTestDb(): TestDb {
  const raw = storage().getItem(DB_KEY);
  if (!raw) {
    const db = emptyDb();
    writeTestDb(db);
    return db;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<TestDb>;
    const db: TestDb = {
      ...emptyDb(),
      ...parsed,
      version: 1,
      patients: Array.isArray(parsed.patients) ? parsed.patients : [],
      appointments: Array.isArray(parsed.appointments) ? parsed.appointments : [],
      billings: Array.isArray(parsed.billings) ? parsed.billings : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      packagePlans: Array.isArray(parsed.packagePlans) ? parsed.packagePlans : [],
      materials: Array.isArray(parsed.materials) ? parsed.materials : [],
      clinicalNotes: Array.isArray(parsed.clinicalNotes) ? parsed.clinicalNotes : [],
      serviceWork: Array.isArray(parsed.serviceWork) ? parsed.serviceWork : [],
      settings: parsed.settings ? { ...defaultSettings(), ...parsed.settings, service_catalog: Array.isArray(parsed.settings.service_catalog) ? parsed.settings.service_catalog : [] } : defaultSettings(),
    };
    return db;
  } catch {
    const db = emptyDb();
    writeTestDb(db);
    return db;
  }
}

export function writeTestDb(db: TestDb) {
  try {
    storage().setItem(DB_KEY, JSON.stringify(db));
  } catch {
    throw new Error("O armazenamento local do perfil de teste ficou cheio. Apague materiais de teste ou use 'Zerar dados de teste'.");
  }
  window.dispatchEvent(new CustomEvent("tages:test-db-changed"));
}

export function resetTestDb() {
  storage().removeItem(DB_KEY);
  writeTestDb(emptyDb());
}

function uuid() {
  return crypto.randomUUID();
}

function cleanText(value: string | null | undefined, max: number) {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized.slice(0, max) : null;
}

function safeMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) throw new Error("Valor inválido");
  return Math.round(amount * 100) / 100;
}

function normalizeCpf(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) throw new Error("CPF inválido");
  const calc = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(digits[i]) * (length + 1 - i);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  if (calc(9) !== Number(digits[9]) || calc(10) !== Number(digits[10])) throw new Error("CPF inválido");
  return digits;
}

function monthAdd(dateText: string, offset: number) {
  const [y, m, d] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1 + offset, 1));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d!, maxDay)).padStart(2, "0")}`;
}

function splitInstallments(total: number, count: number) {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / count);
  const remainder = cents - base * count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
}

function activePlanFor(db: TestDb, patientId: string) {
  return db.packagePlans.find((plan) => plan.patient_id === patientId && plan.status === "active") ?? null;
}

function patientWithPlan(db: TestDb, patient: PatientRow): PatientRow {
  const plan = activePlanFor(db, patient.id);
  return {
    ...patient,
    package_plan_id: plan?.id ?? null,
    package_payment_mode: plan?.payment_mode ?? null,
    package_installments: plan?.installment_count ?? null,
    package_first_due_date: plan?.first_due_date ?? null,
  };
}

function syncAppointmentBilling(db: TestDb, appointment: AppointmentRow) {
  const key = `session:${appointment.id}`;
  const existing = db.billings.find((entry) => entry.id === key || entry.appointment_id === appointment.id);
  const patient = appointment.patient_id ? db.patients.find((p) => p.id === appointment.patient_id) : null;
  const shouldBill = appointment.status === "completed" && appointment.amount > 0 && patient?.billing_model !== "package";

  if (!shouldBill) {
    if (existing && existing.status !== "paid") existing.status = "cancelled";
    return;
  }

  const date = appointment.scheduled_at.slice(0, 10);
  if (existing) {
    if (existing.status !== "paid") {
      existing.status = "pending";
      existing.amount = appointment.amount;
      existing.client_name = appointment.patient_name || patient?.full_name || "Atendimento";
      existing.description = appointment.service_name || "Sessão realizada";
      existing.competence_date = date;
      existing.issued_at = date;
      existing.due_date = date;
    }
    return;
  }

  db.billings.push({
    id: key,
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    source_type: appointment.service_kind,
    client_name: appointment.patient_name || patient?.full_name || "Atendimento",
    description: appointment.service_name || (appointment.service_kind === "session" ? "Sessão realizada" : "Serviço realizado"),
    competence_date: date,
    issued_at: date,
    due_date: date,
    amount: appointment.amount,
    status: "pending",
    received_amount: 0,
    received_at: null,
    payment_method: null,
    package_plan_id: null,
    installment_number: null,
    installment_count: null,
  });
}

export function testListPatients() {
  const db = readTestDb();
  return db.patients.filter((p) => !p.archived_at).map((p) => patientWithPlan(db, p)).sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export function testCreatePatient(input: Partial<PatientRow> & Pick<PatientRow, "full_name">) {
  const db = readTestDb();
  const fullName = cleanText(input.full_name, 160);
  if (!fullName || fullName.length < 2) throw new Error("Nome do paciente inválido");
  const billingModel = input.billing_model === "package" ? "package" : "session";
  const row: PatientRow = {
    id: uuid(),
    full_name: fullName,
    cpf: normalizeCpf(input.cpf),
    phone: cleanText(input.phone, 40),
    email: cleanText(input.email, 254),
    active: input.active ?? true,
    billing_model: billingModel,
    session_amount: billingModel === "session" && input.session_amount != null ? safeMoney(input.session_amount) : null,
    package_amount: billingModel === "package" && input.package_amount != null ? safeMoney(input.package_amount) : null,
    package_timing: null,
    billing_day: null,
    package_plan_id: null,
    package_payment_mode: null,
    package_installments: null,
    package_first_due_date: null,
    notes_admin: cleanText(input.notes_admin, 4000),
    archived_at: null,
    created_at: nowIso(),
  };
  db.patients.push(row);
  writeTestDb(db);
  return row;
}

export function testUpdatePatient(id: string, patch: Partial<PatientRow>) {
  const db = readTestDb();
  const patient = db.patients.find((p) => p.id === id && !p.archived_at);
  if (!patient) throw new Error("Paciente não encontrado");
  if (patch.full_name !== undefined) patient.full_name = cleanText(patch.full_name, 160) || patient.full_name;
  if (patch.cpf !== undefined) patient.cpf = normalizeCpf(patch.cpf);
  if (patch.phone !== undefined) patient.phone = cleanText(patch.phone, 40);
  if (patch.email !== undefined) patient.email = cleanText(patch.email, 254);
  if (patch.active !== undefined) patient.active = Boolean(patch.active);
  if (patch.billing_model !== undefined) patient.billing_model = patch.billing_model === "package" ? "package" : "session";
  if (patch.session_amount !== undefined) patient.session_amount = patch.session_amount == null ? null : safeMoney(patch.session_amount);
  if (patch.package_amount !== undefined) patient.package_amount = patch.package_amount == null ? null : safeMoney(patch.package_amount);
  if (patch.package_timing !== undefined) patient.package_timing = patch.package_timing;
  if (patch.billing_day !== undefined) patient.billing_day = patch.billing_day == null ? null : Math.max(1, Math.min(28, Number(patch.billing_day)));
  if (patch.notes_admin !== undefined) patient.notes_admin = cleanText(patch.notes_admin, 4000);
  writeTestDb(db);
  return patientWithPlan(db, patient);
}

export function testSavePatientPackagePlan(input: { patient_id: string; total_amount: number; payment_mode: "single" | "installments"; installment_count: number; first_due_date: string }) {
  const db = readTestDb();
  const patient = db.patients.find((p) => p.id === input.patient_id && !p.archived_at);
  if (!patient) throw new Error("Paciente não encontrado");
  const total = safeMoney(input.total_amount);
  if (total <= 0) throw new Error("Informe o valor total do pacote/plano.");
  const count = input.payment_mode === "single" ? 1 : Math.max(1, Math.min(60, Math.trunc(input.installment_count)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.first_due_date)) throw new Error("Informe a data do primeiro pagamento.");

  const previous = activePlanFor(db, input.patient_id);
  if (previous) {
    previous.status = "cancelled";
    previous.updated_at = nowIso();
    db.billings.forEach((entry) => { if (entry.package_plan_id === previous.id && entry.status === "pending") entry.status = "cancelled"; });
  }

  const planId = uuid();
  const plan: PackagePlanRow = {
    id: planId,
    patient_id: input.patient_id,
    total_amount: total,
    payment_mode: input.payment_mode,
    installment_count: count,
    first_due_date: input.first_due_date,
    status: "active",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  db.packagePlans.push(plan);
  patient.billing_model = "package";
  patient.package_amount = total;
  patient.session_amount = null;
  const values = splitInstallments(total, count);
  values.forEach((amount, index) => {
    const due = monthAdd(input.first_due_date, index);
    db.billings.push({
      id: uuid(),
      patient_id: patient.id,
      appointment_id: null,
      source_type: "package",
      client_name: patient.full_name,
      description: `Pacote / plano • Parcela ${index + 1}/${count}`,
      competence_date: due,
      issued_at: todayIso(),
      due_date: due,
      amount,
      status: "pending",
      received_amount: 0,
      received_at: null,
      payment_method: null,
      package_plan_id: planId,
      installment_number: index + 1,
      installment_count: count,
    });
  });
  writeTestDb(db);
  return planId;
}

export function testCancelPatientPackagePlan(patientId: string) {
  const db = readTestDb();
  const plan = activePlanFor(db, patientId);
  if (plan) {
    plan.status = "cancelled";
    plan.updated_at = nowIso();
    db.billings.forEach((entry) => { if (entry.package_plan_id === plan.id && entry.status === "pending") entry.status = "cancelled"; });
  }
  const patient = db.patients.find((p) => p.id === patientId);
  if (patient) {
    patient.billing_model = "session";
    patient.package_amount = null;
  }
  writeTestDb(db);
}

export function testDeletePatient(id: string) {
  const db = readTestDb();
  const patient = db.patients.find((p) => p.id === id);
  if (patient) patient.archived_at = nowIso();
  writeTestDb(db);
}

export function testListAppointments(startIso?: string, endIso?: string) {
  const db = readTestDb();
  return db.appointments
    .filter((a) => (!startIso || a.scheduled_at >= startIso) && (!endIso || a.scheduled_at < endIso))
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

export function testCreateAppointment(input: Omit<AppointmentRow, "id" | "created_at">) {
  const db = readTestDb();
  const row: AppointmentRow = { ...input, id: uuid(), created_at: nowIso() };
  db.appointments.push(row);
  syncAppointmentBilling(db, row);
  writeTestDb(db);
  return row;
}

export function testUpdateAppointment(id: string, patch: Partial<AppointmentRow>) {
  const db = readTestDb();
  const row = db.appointments.find((a) => a.id === id);
  if (!row) throw new Error("Atendimento não encontrado");
  Object.assign(row, patch);
  syncAppointmentBilling(db, row);
  writeTestDb(db);
  return row;
}

export function testDeleteAppointment(id: string, cancelPackagePlan = false) {
  const db = readTestDb();
  const row = db.appointments.find((a) => a.id === id);
  if (!row) throw new Error("Atendimento não encontrado");
  row.status = "cancelled";
  db.billings.forEach((entry) => { if (entry.appointment_id === id && entry.status !== "paid") entry.status = "cancelled"; });
  if (cancelPackagePlan && row.patient_id) {
    const plan = activePlanFor(db, row.patient_id);
    if (plan) {
      plan.status = "cancelled";
      plan.updated_at = nowIso();
      db.billings.forEach((entry) => { if (entry.package_plan_id === plan.id && entry.status === "pending") entry.status = "cancelled"; });
    }
  }
  writeTestDb(db);
}

export function testListAppointmentPayments(ids: string[]): AppointmentPaymentRow[] {
  const db = readTestDb();
  return db.billings.filter((b) => b.appointment_id && ids.includes(b.appointment_id)).map((b) => ({
    id: b.id,
    appointment_id: b.appointment_id!,
    status: b.status,
    amount: b.amount,
    received_amount: b.received_amount,
    received_at: b.received_at,
    payment_method: b.payment_method,
  }));
}

export function testGetAppointmentPayment(id: string): AppointmentPaymentRow | null {
  return testListAppointmentPayments([id])[0] ?? null;
}

export function testMarkAppointmentPaid(appointmentId: string, method: PaymentMethod) {
  const db = readTestDb();
  const appointment = db.appointments.find((a) => a.id === appointmentId);
  if (appointment) syncAppointmentBilling(db, appointment);
  const billing = db.billings.find((b) => b.appointment_id === appointmentId && b.status !== "cancelled");
  if (!billing) throw new Error("Cobrança do atendimento não encontrada");
  billing.status = "paid";
  billing.received_amount = billing.amount;
  billing.received_at = todayIso();
  billing.payment_method = method;
  writeTestDb(db);
}

export function testListMaterials(): MaterialRow[] {
  return readTestDb().materials.map(({ data_url: _data, ...item }) => item);
}

export async function testUploadMaterial(file: File, title: string, category: string, notes: string) {
  if (file.size <= 0 || file.size > MAX_LOCAL_FILE_BYTES) throw new Error("No perfil de teste, arquivos devem ter no máximo 2 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
  const db = readTestDb();
  const row: TestMaterial = {
    id: uuid(), title: title.trim().slice(0, 180), category: cleanText(category, 100), file_path: `local:${uuid()}`,
    file_type: file.type || "application/octet-stream", notes: cleanText(notes, 2000), created_at: nowIso(), data_url: dataUrl,
  };
  db.materials.unshift(row);
  writeTestDb(db);
  const { data_url: _data, ...result } = row;
  return result;
}

export function testOpenMaterial(path: string) {
  const db = readTestDb();
  const item = db.materials.find((m) => m.file_path === path);
  if (!item?.data_url) throw new Error("Arquivo de teste não encontrado neste navegador.");
  return item.data_url;
}

export function testDeleteMaterial(id: string) {
  const db = readTestDb();
  db.materials = db.materials.filter((m) => m.id !== id);
  writeTestDb(db);
}

export function testListClinicalNotes(patientId: string) {
  return readTestDb().clinicalNotes.filter((n) => n.patient_id === patientId && !n.archived_at).sort((a, b) => b.note_date.localeCompare(a.note_date));
}

export function testCreateClinicalNote(input: Omit<ClinicalNoteRow, "id" | "created_at" | "archived_at">) {
  const db = readTestDb();
  const row: ClinicalNoteRow = { ...input, id: uuid(), archived_at: null, created_at: nowIso() };
  db.clinicalNotes.unshift(row);
  writeTestDb(db);
  return row;
}

export function testDeleteClinicalNote(id: string) {
  const db = readTestDb();
  const row = db.clinicalNotes.find((n) => n.id === id);
  if (row) row.archived_at = nowIso();
  writeTestDb(db);
}

export function testGetAppSettings() {
  return readTestDb().settings;
}

export function testSaveAppSettings(patch: Partial<AppSettingsRow>) {
  const db = readTestDb();
  db.settings = { ...db.settings, ...patch, owner_id: TEST_OWNER_ID };
  if (patch.cpf !== undefined) db.settings.cpf = normalizeCpf(patch.cpf);
  writeTestDb(db);
  return db.settings;
}

export function testLoadReports(startDate: string, endExclusive: string): ReportsBundle {
  const db = readTestDb();
  return {
    appointments: db.appointments.filter((a) => a.scheduled_at.slice(0, 10) >= startDate && a.scheduled_at.slice(0, 10) < endExclusive),
    billings: db.billings.filter((b) => b.competence_date >= startDate && b.competence_date < endExclusive && b.status !== "cancelled").map((b) => ({ id: b.id, source_type: b.source_type, amount: b.amount, received_amount: b.received_amount, status: b.status, competence_date: b.competence_date, received_at: b.received_at })),
    received: db.billings.filter((b) => b.received_at && b.received_at >= startDate && b.received_at < endExclusive && b.received_amount > 0).map((b) => ({ id: b.id, received_amount: b.received_amount, received_at: b.received_at })),
    receivables: db.billings.filter((b) => b.status === "pending" || b.status === "partial").map((b) => ({ id: b.id, amount: b.amount, received_amount: b.received_amount, status: b.status })),
    expenses: db.expenses.filter((e) => e.competence_date >= startDate && e.competence_date < endExclusive).map((e) => ({ id: e.id, amount: e.amount, competence_date: e.competence_date })),
  };
}

export function testLoadFinanceHistory(startDate: string, endExclusive: string) {
  const db = readTestDb();
  return {
    billings: db.billings.filter((b) => b.competence_date >= startDate && b.competence_date < endExclusive && b.status !== "cancelled").map((b) => ({ competence_date: b.competence_date, amount: b.amount, status: b.status })),
    received: db.billings.filter((b) => b.received_at && b.received_at >= startDate && b.received_at < endExclusive && b.received_amount > 0).map((b) => ({ received_at: b.received_at, received_amount: b.received_amount })),
    expenses: db.expenses.filter((e) => e.competence_date >= startDate && e.competence_date < endExclusive).map((e) => ({ competence_date: e.competence_date, amount: e.amount })),
  };
}

export function testLoadFinanceBundle(month: string, includeReceivableDetails = false): FinanceBundle {
  const db = readTestDb();
  const start = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  const billed = db.billings.filter((b) => b.competence_date >= start && b.competence_date < next && b.status !== "cancelled");
  const receivedInPeriod = db.billings.filter((b) => b.received_at && b.received_at >= start && b.received_at < next && b.received_amount > 0);
  const receivables = db.billings.filter((b) => b.status === "pending" || b.status === "partial").sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const expenses = db.expenses.filter((e) => e.competence_date >= start && e.competence_date < next);
  const patients: PatientBilling[] = db.patients.filter((p) => p.active && !p.archived_at).map((p) => {
    const plan = activePlanFor(db, p.id);
    return {
      id: p.id, full_name: p.full_name, cpf: p.cpf, billing_model: p.billing_model, session_amount: p.session_amount,
      package_amount: p.package_amount, package_timing: p.package_timing, billing_day: p.billing_day,
      package_plan_id: plan?.id ?? null, package_payment_mode: plan?.payment_mode ?? null,
      package_installments: plan?.installment_count ?? null, package_first_due_date: plan?.first_due_date ?? null,
    };
  });
  return {
    billed,
    receivedInPeriod,
    receivables,
    packageBillings: includeReceivableDetails ? db.billings.filter((b) => b.package_plan_id && b.status !== "cancelled") : [],
    expenses,
    patients,
    patientDirectory: includeReceivableDetails ? db.patients.filter((p) => !p.archived_at).map((p) => ({ id: p.id, full_name: p.full_name, cpf: p.cpf })) : [],
  };
}

export function testCreateRevenue(input: { source_type: BillingEntry["source_type"]; client_name: string; description: string; competence_date: string; issued_at: string; due_date: string | null; amount: number; status: "pending" | "paid"; payment_method?: PaymentMethod | null }) {
  const db = readTestDb();
  const amount = safeMoney(input.amount);
  db.billings.unshift({
    id: uuid(), source_type: input.source_type, client_name: input.client_name.trim(), description: input.description.trim(),
    competence_date: input.competence_date, issued_at: input.issued_at, due_date: input.due_date, amount,
    status: input.status === "paid" ? "paid" : "pending", received_amount: input.status === "paid" ? amount : 0,
    received_at: input.status === "paid" ? input.issued_at : null, payment_method: input.status === "paid" ? input.payment_method ?? null : null,
    patient_id: null, package_plan_id: null, installment_number: null, installment_count: null,
  });
  writeTestDb(db);
}

export function testCreateExpense(input: { category: string; description: string; competence_date: string; due_date: string | null; amount: number; recurrence: "fixed" | "variable"; status: "pending" | "paid" }) {
  const db = readTestDb();
  db.expenses.unshift({ id: uuid(), category: input.category, description: input.description.trim(), competence_date: input.competence_date, due_date: input.due_date, amount: safeMoney(input.amount), recurrence: input.recurrence, status: input.status, paid_at: input.status === "paid" ? input.competence_date : null, fixed_rule_id: null });
  writeTestDb(db);
}

export function testMarkExpensePaid(id: string) {
  const db = readTestDb();
  const row = db.expenses.find((e) => e.id === id);
  if (row) { row.status = "paid"; row.paid_at = todayIso(); }
  writeTestDb(db);
}

export function testUpdateExpense(input: ExpenseEntry) {
  const db = readTestDb();
  const row = db.expenses.find((e) => e.id === input.id);
  if (!row) throw new Error("Despesa não encontrada");
  Object.assign(row, input, { amount: safeMoney(input.amount), paid_at: input.status === "paid" ? input.paid_at ?? todayIso() : null });
  writeTestDb(db);
}

export function testDeleteExpense(id: string) {
  const db = readTestDb();
  db.expenses = db.expenses.filter((e) => e.id !== id);
  writeTestDb(db);
}

export function testMarkRevenuePaid(id: string) {
  const db = readTestDb();
  const row = db.billings.find((b) => b.id === id);
  if (!row) throw new Error("Cobrança não encontrada");
  row.status = "paid"; row.received_amount = row.amount; row.received_at = todayIso();
  writeTestDb(db);
}

export function testUpdateRevenueReceipt(input: { id: string; received_amount: number; received_at: string; payment_method: PaymentMethod }) {
  const db = readTestDb();
  const row = db.billings.find((b) => b.id === input.id);
  if (!row) throw new Error("Cobrança não encontrada");
  const value = safeMoney(input.received_amount);
  if (value <= 0 || value > row.amount) throw new Error("Valor recebido inválido");
  row.received_amount = value; row.received_at = input.received_at; row.payment_method = input.payment_method; row.status = value === row.amount ? "paid" : "partial";
  writeTestDb(db);
}

export function testDeleteRevenueReceipt(id: string) {
  const db = readTestDb();
  const row = db.billings.find((b) => b.id === id);
  if (!row) throw new Error("Cobrança não encontrada");
  row.received_amount = 0; row.received_at = null; row.payment_method = null; row.status = "pending";
  writeTestDb(db);
}

export function testUpdatePatientBilling(input: PatientBilling): void {
  if (input.billing_model === "package") {
    if (!input.package_first_due_date || input.package_amount == null) throw new Error("Informe valor total e primeiro vencimento do pacote/plano.");
    testSavePatientPackagePlan({ patient_id: input.id, total_amount: input.package_amount, payment_mode: input.package_payment_mode === "installments" ? "installments" : "single", installment_count: input.package_installments ?? 1, first_due_date: input.package_first_due_date });
    return;
  }
  testCancelPatientPackagePlan(input.id);
  const db = readTestDb();
  const patient = db.patients.find((p) => p.id === input.id);
  if (patient) { patient.billing_model = "session"; patient.session_amount = input.session_amount; patient.package_amount = null; }
  writeTestDb(db);
  return;
}

export function testListServiceWorkEntries(startDate: string, endExclusive: string) {
  return readTestDb().serviceWork.filter((e) => e.due_date >= startDate && e.due_date < endExclusive).sort((a, b) => b.due_date.localeCompare(a.due_date));
}

export function testCreateServiceWorkEntry(input: ServiceWorkEntryInput) {
  const db = readTestDb();
  const id = uuid();
  const row: ServiceWorkEntry = { id, kind: input.kind, client_name: input.client_name ?? null, description: input.description, amount: safeMoney(input.amount), due_date: input.due_date, status: input.status, paid_at: input.paid_at ?? (input.status === "paid" ? todayIso() : null), payment_method: input.payment_method ?? null, notes: input.notes ?? null, created_at: nowIso(), updated_at: nowIso() };
  db.serviceWork.unshift(row); writeTestDb(db); return id;
}

export function testUpdateServiceWorkEntry(id: string, input: ServiceWorkEntryInput) {
  const db = readTestDb(); const row = db.serviceWork.find((e) => e.id === id); if (!row) throw new Error("Lançamento não encontrado");
  Object.assign(row, input, { amount: safeMoney(input.amount), client_name: input.client_name ?? null, paid_at: input.paid_at ?? (input.status === "paid" ? row.paid_at ?? todayIso() : null), payment_method: input.payment_method ?? null, notes: input.notes ?? null, updated_at: nowIso() }); writeTestDb(db);
}

export function testDeleteServiceWorkEntry(id: string) { const db = readTestDb(); db.serviceWork = db.serviceWork.filter((e) => e.id !== id); writeTestDb(db); }
export function testMarkServiceWorkPaid(id: string, paidAt: string, paymentMethod: string | null) { const db = readTestDb(); const row = db.serviceWork.find((e) => e.id === id); if (!row) throw new Error("Lançamento não encontrado"); row.status = "paid"; row.paid_at = paidAt; row.payment_method = paymentMethod as ServiceWorkEntry["payment_method"]; row.updated_at = nowIso(); writeTestDb(db); }
