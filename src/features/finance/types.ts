export type RevenueSource = "session" | "package" | "company" | "psychological_test" | "neuropsychology" | "other";
export type RevenueStatus = "pending" | "partial" | "paid" | "cancelled";
export type ExpenseRecurrence = "fixed" | "variable";
export type PackagePaymentMode = "single" | "installments";
export type PaymentMethod = "pix" | "bank_transfer" | "cash" | "credit_card" | "debit_card" | "other";

export type BillingEntry = {
  id: string;
  source_type: RevenueSource;
  client_name: string;
  description: string;
  competence_date: string;
  issued_at: string;
  due_date: string | null;
  amount: number;
  status: RevenueStatus;
  received_amount: number;
  received_at: string | null;
  payment_method: PaymentMethod | null;
  patient_id?: string | null;
  appointment_id?: string | null;
  package_plan_id?: string | null;
  installment_number?: number | null;
  installment_count?: number | null;
};

export type ExpenseEntry = {
  id: string;
  category: string;
  description: string;
  competence_date: string;
  due_date: string | null;
  amount: number;
  recurrence: ExpenseRecurrence;
  status: "pending" | "paid";
  paid_at: string | null;
  fixed_rule_id?: string | null;
};

export type PatientBilling = {
  id: string;
  full_name: string;
  cpf: string | null;
  billing_model: "session" | "package";
  session_amount: number | null;
  package_amount: number | null;
  package_timing: "current_month" | "next_month" | null;
  billing_day: number | null;
  package_plan_id: string | null;
  package_payment_mode: PackagePaymentMode | null;
  package_installments: number | null;
  package_first_due_date: string | null;
};

export type PatientIdentity = {
  id: string;
  full_name: string;
  cpf: string | null;
};

export type FinanceBundle = {
  billed: BillingEntry[];
  receivedInPeriod: BillingEntry[];
  receivables: BillingEntry[];
  packageBillings: BillingEntry[];
  expenses: ExpenseEntry[];
  patients: PatientBilling[];
  patientDirectory: PatientIdentity[];
};
