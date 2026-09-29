export type ServiceWorkKind = "income" | "expense";
export type ServiceWorkStatus = "pending" | "paid" | "cancelled";
export type ServiceWorkPaymentMethod = "pix" | "bank_transfer" | "cash" | "credit_card" | "debit_card" | "other";

export type ServiceWorkEntry = {
  id: string;
  kind: ServiceWorkKind;
  client_name: string | null;
  description: string;
  amount: number;
  due_date: string;
  status: ServiceWorkStatus;
  paid_at: string | null;
  payment_method: ServiceWorkPaymentMethod | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceWorkEntryInput = {
  kind: ServiceWorkKind;
  client_name?: string | null;
  description: string;
  amount: number;
  due_date: string;
  status: ServiceWorkStatus;
  paid_at?: string | null;
  payment_method?: ServiceWorkPaymentMethod | null;
  notes?: string | null;
};
