export type PackagePaymentMode = "single" | "installments";

export type PatientRow = {
  id: string;
  full_name: string;
  cpf: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
  billing_model: "session" | "package";
  session_amount: number | null;
  package_amount: number | null;
  package_timing: "current_month" | "next_month" | null;
  billing_day: number | null;
  // Campos abaixo vêm do plano ativo em package_plans. Eles ficam no tipo do paciente
  // para a UI trabalhar com um único objeto sem duplicar estado financeiro.
  package_plan_id: string | null;
  package_payment_mode: PackagePaymentMode | null;
  package_installments: number | null;
  package_first_due_date: string | null;
  notes_admin: string | null;
  archived_at: string | null;
  created_at: string;
};

export type AppointmentStatus = "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
export type ServiceKind = "session" | "psychological_test" | "neuropsychology" | "company" | "other";

export type ServiceCatalogItem = {
  id: string;
  name: string;
  kind: ServiceKind;
  active: boolean;
};

export type AppointmentRow = {
  id: string;
  patient_id: string | null;
  patient_name: string | null;
  scheduled_at: string;
  duration_minutes: number;
  modality: "presential" | "online";
  status: AppointmentStatus;
  service_kind: ServiceKind;
  service_name: string | null;
  amount: number;
  notes_admin: string | null;
  created_at: string;
};


export type AppointmentPaymentRow = {
  id: string;
  appointment_id: string;
  status: "pending" | "partial" | "paid" | "cancelled";
  amount: number;
  received_amount: number;
  received_at: string | null;
  payment_method: "pix" | "bank_transfer" | "cash" | "credit_card" | "debit_card" | "other" | null;
};

export type MaterialRow = {
  id: string;
  title: string;
  category: string | null;
  file_path: string | null;
  file_type: string | null;
  notes: string | null;
  created_at: string;
};

export type ClinicalNoteRow = {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  note_date: string;
  title: string;
  content_ciphertext: string;
  content_iv: string;
  archived_at: string | null;
  created_at: string;
};

export type AppSettingsRow = {
  owner_id: string;
  professional_name: string;
  cpf: string | null;
  crp: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  vault_salt: string | null;
  vault_verifier_ciphertext: string | null;
  vault_verifier_iv: string | null;
  vault_version: number | null;
  vault_password_salt: string | null;
  vault_password_key_ciphertext: string | null;
  vault_password_key_iv: string | null;
  vault_recovery_salt: string | null;
  vault_recovery_key_ciphertext: string | null;
  vault_recovery_key_iv: string | null;
  // Envelope de recuperação por e-mail. A chave clínica continua criptografada;
  // o servidor só consegue desembrulhá-la após sessão Supabase válida em AAL2.
  vault_email_recovery_ciphertext: string | null;
  vault_email_recovery_iv: string | null;
  vault_email_recovery_version: number | null;
  service_catalog: ServiceCatalogItem[];
};

export type ReportsBundle = {
  appointments: AppointmentRow[];
  billings: Array<{
    id: string;
    source_type: string;
    amount: number;
    received_amount: number;
    status: string;
    competence_date: string;
    received_at: string | null;
  }>;
  received: Array<{ id: string; received_amount: number; received_at: string | null }>;
  receivables: Array<{ id: string; amount: number; received_amount: number; status: string }>;
  expenses: Array<{ id: string; amount: number; competence_date: string }>;
};

export type PackagePlanRow = {
  id: string;
  patient_id: string;
  total_amount: number;
  payment_mode: PackagePaymentMode;
  installment_count: number;
  first_due_date: string;
  status: "active" | "cancelled" | "completed";
  created_at: string;
  updated_at: string;
};
