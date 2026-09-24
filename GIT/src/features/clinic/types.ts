export type PatientRow = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  active: boolean;
  billing_model: "session" | "package";
  package_amount: number | null;
  package_timing: "current_month" | "next_month" | null;
  billing_day: number | null;
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
  crp: string | null;
  phone: string | null;
  email: string | null;
  vault_salt: string | null;
  vault_verifier_ciphertext: string | null;
  vault_verifier_iv: string | null;
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
