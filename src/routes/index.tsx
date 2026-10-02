import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
  BriefcaseBusiness,
  Bell,
  BookOpenText,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  FileBarChart,
  FileText,
  Filter,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Video,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { AuthGate, useAuth } from "../components/auth/AuthGate";
import { FinanceDashboardMetrics, FinancePage as FinancePageV2, type FinanceTab } from "../features/finance/FinancePage";
import { ServiceWorkPage } from "../features/service-work/ServiceWorkPage";
import { UsageMonitorPage } from "../features/usage-monitor/UsageMonitorPage";
import { paymentMethodLabels } from "../features/finance/documents";
import type { PaymentMethod } from "../features/finance/types";
import {
  clinicalAad,
  createPasswordEnvelope,
  createRecoverableEnvelopeForExistingKey,
  createRecoverableVault,
  createRecoveryEnvelope,
  decryptText,
  encryptText,
  exportVaultKeyBase64,
  importVaultKeyBase64,
  isValidVaultPassphrase,
  recoverVaultWithCode,
  unlockLegacyVault,
  unlockRecoverableVault,
} from "../features/clinic/crypto";
import {
  createAppointment,
  createClinicalNote,
  createPatient,
  deleteAppointment,
  deleteClinicalNote,
  deleteMaterial,
  deletePatient,
  getAppSettings,
  grantClinicalAccess,
  getAppointmentPayment,
  listAllAppointments,
  listAppointmentPayments,
  listAppointments,
  listClinicalNotes,
  listMaterials,
  listPatients,
  loadFinanceHistory,
  loadReports,
  markAppointmentPaid,
  openMaterial,
  revokeClinicalAccess,
  saveAppSettings,
  savePatientPackagePlan,
  cancelPatientPackagePlan,
  updateAppointment,
  updatePatient,
  uploadMaterial,
} from "../features/clinic/repository";
import type {
  AppSettingsRow,
  AppointmentPaymentRow,
  AppointmentRow,
  AppointmentStatus,
  ClinicalNoteRow,
  MaterialRow,
  PatientRow,
  ReportsBundle,
  ServiceCatalogItem,
  ServiceKind,
} from "../features/clinic/types";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TAGES | Consultório Anna" },
      { name: "description", content: "Gestão segura do consultório e módulo isolado de prestação de serviço." },
      { name: "robots", content: "noindex,nofollow,noarchive,nosnippet" },
    ],
  }),
  component: SecureConsultorioApp,
});

function SecureConsultorioApp() {
  return <AuthGate><RoleAwareApp /></AuthGate>;
}

function RoleAwareApp() {
  const { user } = useAuth();
  const role = typeof user?.app_metadata?.["tages_role"] === "string" ? user.app_metadata["tages_role"] : "";
  if (role === "usage_monitor") return <UsageMonitorPage />;
  return <ConsultorioApp />;
}

type ModuleKey = "Dashboard" | "Agenda" | "Pacientes" | "Sessões" | "Financeiro" | "Prestação de Serviço" | "Relatórios" | "Materiais" | "Configurações";
type QuickAction = "session" | "expense" | "revenue" | "patient";

type PatientView = PatientRow & {
  initials: string;
  lastSession: string;
  nextSession: string;
};

type DecryptedEvolution = ClinicalNoteRow & { text: string };

const navItems: Array<[ModuleKey, typeof LayoutDashboard]> = [
  ["Dashboard", LayoutDashboard],
  ["Agenda", CalendarDays],
  ["Pacientes", Users],
  ["Sessões", Video],
  ["Financeiro", WalletCards],
  ["Prestação de Serviço", BriefcaseBusiness],
  ["Relatórios", FileBarChart],
  ["Materiais", FileText],
  ["Configurações", Settings],
];

function isoDateLocal(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseMonth(month: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const fallback = new Date();
  const year = match ? Number(match[1]) : fallback.getFullYear();
  const monthNumber = match ? Number(match[2]) : fallback.getMonth() + 1;
  return {
    year,
    monthNumber: Math.max(1, Math.min(12, monthNumber)),
  };
}

function monthBounds(month: string) {
  const { year, monthNumber } = parseMonth(month);
  const normalizedMonth = `${year}-${String(monthNumber).padStart(2, "0")}`;
  const next = new Date(year, monthNumber, 1);
  const start = `${normalizedMonth}-01`;
  const end = isoDateLocal(next);
  return { start, end };
}

function dayBounds(day: string) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

function dateTimeLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function addMonthsClamped(dateText: string, monthOffset: number) {
  // `noUncheckedIndexedAccess` considera itens de `split()` potencialmente ausentes.
  // Os valores padrão mantêm a função tipada sem alterar a regra de vencimento mensal.
  const [yearText = "1970", monthText = "01", dayText = "01"] = dateText.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const targetMonth = month - 1 + monthOffset;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  const result = new Date(targetYear, normalizedMonth, Math.min(day, lastDay));
  return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, "0")}-${String(result.getDate()).padStart(2, "0")}`;
}

function packageInstallmentPreview(total: number, count: number, firstDueDate: string) {
  if (!Number.isFinite(total) || total <= 0 || !firstDueDate || count < 1) return [];
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    dueDate: addMonthsClamped(firstDueDate, index),
    amount: (index === count - 1 ? totalCents - baseCents * (count - 1) : baseCents) / 100,
  }));
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
}

function cpfDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

function formatCpf(value: string | null | undefined) {
  const digits = cpfDigits(value ?? "");
  if (!digits) return "";
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3}\.\d{3}\.\d{3})(\d{1,2})$/, "$1-$2");
}

function statusLabel(status: AppointmentStatus) {
  return ({ scheduled: "Agendada", confirmed: "Confirmada", completed: "Concluída", cancelled: "Cancelada", no_show: "Falta" } as const)[status];
}

function modalityLabel(modality: AppointmentRow["modality"]) {
  return modality === "online" ? "On-line" : "Presencial";
}

function serviceLabel(kind: ServiceKind) {
  return ({ session: "Sessão", psychological_test: "Teste psicológico", neuropsychology: "Neuropsicologia", company: "Empresa", other: "Outro" } as const)[kind];
}

const DEFAULT_SERVICE_CATALOG: ServiceCatalogItem[] = [
  { id: "session", name: "Sessão", kind: "session", active: true },
  { id: "psychological-test", name: "Teste psicológico", kind: "psychological_test", active: true },
  { id: "neuropsychology", name: "Neuropsicologia", kind: "neuropsychology", active: true },
  { id: "company", name: "Empresa", kind: "company", active: true },
  { id: "other", name: "Outro", kind: "other", active: true },
];

function appointmentServiceLabel(item: AppointmentRow) {
  return item.service_name?.trim() || serviceLabel(item.service_kind);
}

type AppSaveError = { code?: string; message?: string; details?: string; hint?: string };

// Traduz falhas de persistência do atendimento para mensagens úteis ao usuário.
// Não exibir o erro bruto do banco na interface: ele pode conter nomes internos de constraints/RPCs.
// Sempre mantenha os casos de conflito de agenda e expiração de MFA explícitos, pois são os
// bloqueios operacionais mais comuns e precisam dizer exatamente o que deve ser corrigido.
function appointmentSaveErrorMessage(error: unknown) {
  const dbError = (error && typeof error === "object" ? error : {}) as AppSaveError;
  const code = dbError.code ?? "";
  const message = dbError.message ?? (error instanceof Error ? error.message : "");
  const details = dbError.details ?? "";
  const combined = `${message} ${details}`.toLowerCase();

  if (code === "23P01" || combined.includes("sobrepondo") || combined.includes("overlap")) {
    return "Este horário conflita com outro atendimento ativo. Escolha outro horário ou reduza a duração do atendimento.";
  }
  if (code === "23505" && (combined.includes("appointments_open_slot_unique") || combined.includes("scheduled_at"))) {
    return "Já existe um atendimento cadastrado neste horário. Escolha outro horário.";
  }
  if (code === "42501" || combined.includes("mfa obrigatório") || combined.includes("row-level security") || combined.includes("permission denied")) {
    return "Sua autorização de segurança expirou ou não permite esta operação. Confirme o acesso/MFA e tente novamente.";
  }
  if (code === "23514") {
    if (combined.includes("duration") || combined.includes("duração")) return "A duração do atendimento deve ficar entre 10 e 240 minutos.";
    if (combined.includes("amount") || combined.includes("valor")) return "O valor informado para o atendimento é inválido.";
    return "Um dos dados do atendimento não atende às regras de cadastro. Revise os campos informados.";
  }
  if (code === "22023" || combined.includes("valor inválido") || combined.includes("data inválida")) {
    return message && !message.toLowerCase().includes("invalid input syntax")
      ? message
      : "Há um dado inválido no atendimento. Revise data, duração e valor.";
  }
  if (combined.includes("failed to fetch") || combined.includes("network") || combined.includes("fetch")) {
    return "Não foi possível comunicar com o servidor. Verifique a conexão e tente novamente.";
  }
  if (combined.includes("supabase não configurado")) return "O serviço de dados não está configurado corretamente.";

  return "Não foi possível salvar o atendimento por um erro inesperado. Tente novamente; se persistir, consulte os logs do sistema.";
}

type DataOperationError = { code?: string; message?: string; details?: string; hint?: string };

// Traduz falhas do cofre para mensagens acionáveis. Os erros do Supabase/PostgREST
// são objetos simples (não instâncias de Error), então depender apenas de `instanceof Error`
// escondia a causa real e mostrava sempre "Não foi possível criar o cofre".
function vaultOperationErrorMessage(error: unknown, action: "criar" | "desbloquear" | "redefinir" | "recuperacao") {
  const dataError = (error && typeof error === "object" ? error : {}) as DataOperationError;
  const code = dataError.code ?? "";
  const message = dataError.message ?? (error instanceof Error ? error.message : "");
  const details = dataError.details ?? "";
  const combined = `${message} ${details}`.toLowerCase();

  if (code === "PGRST204" || code === "42703" || combined.includes("vault_password_salt") || combined.includes("vault_recovery_salt")) {
    return "O banco ainda não possui a estrutura de recuperação do cofre. Execute o SQL_ATUALIZACAO_ANA_TAGES_v2.0.14.sql no Supabase e tente novamente.";
  }
  if (code === "42501" || combined.includes("mfa obrigatório") || combined.includes("row-level security") || combined.includes("permission denied")) {
    return "Sua autorização de segurança não permite salvar o cofre neste momento. Saia e entre novamente, confirme o Google Authenticator e tente de novo.";
  }
  if (combined.includes("failed to fetch") || combined.includes("network") || combined.includes("fetch")) {
    return "Não foi possível comunicar com o Supabase. Verifique a conexão e tente novamente.";
  }
  if (code === "23514") {
    return "O banco rejeitou a configuração do cofre por uma regra de integridade. Atualize a página e tente novamente.";
  }
  if (message && !combined.includes("invalid input syntax")) return message;

  if (action === "criar") return "Não foi possível salvar a configuração do cofre. Atualize a página e tente novamente.";
  if (action === "desbloquear") return "Não foi possível desbloquear o cofre.";
  if (action === "redefinir") return "Não foi possível redefinir a senha do cofre.";
  return "Não foi possível atualizar o código de recuperação do cofre.";
}

async function getAal2AccessToken() {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || aal.currentLevel !== "aal2") throw new Error("Confirme o Google Authenticator antes de continuar.");
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) throw new Error("Sua sessão segura expirou. Entre novamente.");
  return token;
}

async function provisionVaultEmailRecovery(key: CryptoKey) {
  const token = await getAal2AccessToken();
  const rawKey = await exportVaultKeyBase64(key);
  const response = await fetch("/api/vault-email-recovery/provision", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ rawKey }),
  });
  const payload = await response.json() as { ciphertext?: string; iv?: string; version?: number; error?: string };
  if (!response.ok || !payload.ciphertext || !payload.iv) throw new Error(payload.error || "Não foi possível ativar a recuperação por e-mail.");
  return { ciphertext: payload.ciphertext, iv: payload.iv, version: payload.version ?? 1 };
}

async function recoverVaultKeyFromEmailEnvelope(settings: AppSettingsRow) {
  if (!settings.vault_email_recovery_ciphertext || !settings.vault_email_recovery_iv) {
    throw new Error("A recuperação por e-mail ainda não foi ativada para este cofre.");
  }
  const token = await getAal2AccessToken();
  const response = await fetch("/api/vault-email-recovery/recover", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ciphertext: settings.vault_email_recovery_ciphertext,
      iv: settings.vault_email_recovery_iv,
    }),
  });
  const payload = await response.json() as { rawKey?: string; error?: string };
  if (!response.ok || !payload.rawKey) throw new Error(payload.error || "Não foi possível recuperar o cofre por e-mail.");
  return importVaultKeyBase64(payload.rawKey);
}

function availableServices(settings: AppSettingsRow | null) {
  const catalog = settings?.service_catalog;
  return Array.isArray(catalog) && catalog.length ? catalog : DEFAULT_SERVICE_CATALOG;
}

function toPatientView(patient: PatientRow, appointments: AppointmentRow[]): PatientView {
  const related = appointments.filter((item) => item.patient_id === patient.id && item.status !== "cancelled");
  const now = Date.now();
  const past = related.filter((item) => new Date(item.scheduled_at).getTime() <= now && item.status === "completed").sort((a, b) => +new Date(b.scheduled_at) - +new Date(a.scheduled_at));
  const future = related.filter((item) => new Date(item.scheduled_at).getTime() > now && ["scheduled", "confirmed"].includes(item.status)).sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  return {
    ...patient,
    initials: initials(patient.full_name),
    lastSession: past[0] ? dateTimeLabel(past[0].scheduled_at) : "—",
    nextSession: future[0] ? dateTimeLabel(future[0].scheduled_at) : "Não agendada",
  };
}

function ConsultorioApp() {
  const { user, signOut } = useAuth();
  const [activeModule, setActiveModule] = useState<ModuleKey>(() =>
    typeof window !== "undefined" && window.sessionStorage.getItem("tages:vault-email-recovery-authorized") === "1"
      ? "Configurações"
      : "Dashboard",
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patientModal, setPatientModal] = useState<PatientRow | "new" | null>(null);
  const [recordPatient, setRecordPatient] = useState<PatientView | null>(null);
  const [verifiedPatient, setVerifiedPatient] = useState<PatientView | null>(null);
  const [settings, setSettings] = useState<AppSettingsRow | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [loadingCore, setLoadingCore] = useState(isSupabaseConfigured);
  const [coreLoadError, setCoreLoadError] = useState(false);
  const [pendingQuickAction, setPendingQuickAction] = useState<QuickAction | null>(null);
  const [pendingFinanceTab, setPendingFinanceTab] = useState<FinanceTab | null>(null);

  const refreshCore = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoadingCore(false);
      setCoreLoadError(false);
      return;
    }
    setLoadingCore(true);
    setCoreLoadError(false);
    try {
      const now = new Date();
      const from = new Date(now); from.setFullYear(from.getFullYear() - 1);
      const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
      const [patientRows, appointmentRows, appSettings] = await Promise.all([
        listPatients(),
        listAppointments(from.toISOString(), to.toISOString()),
        getAppSettings(),
      ]);
      setPatients(patientRows);
      setAppointments(appointmentRows);
      setSettings(appSettings);
    } catch (error) {
      console.error(error);
      setCoreLoadError(true);
    } finally {
      setLoadingCore(false);
    }
  }, []);

  useEffect(() => { if (user) void refreshCore(); }, [user, refreshCore]);

  const patientViews = useMemo(() => patients.map((patient) => toPatientView(patient, appointments)), [patients, appointments]);

  const openModule = (module: ModuleKey) => {
    setActiveModule(module);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const runQuickAction = (action: QuickAction) => {
    if (action === "patient") {
      setPatientModal("new");
      return;
    }
    setPendingQuickAction(action);
    openModule(action === "session" ? "Sessões" : "Financeiro");
  };

  const openFinanceTab = (tab: FinanceTab) => {
    setPendingFinanceTab(tab);
    openModule("Financeiro");
  };

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      <aside className={`${menuOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-border bg-card/95 p-5 backdrop-blur-xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:bg-card/60`}>
        <Button variant="ghost" size="icon" className="absolute right-3 top-3 lg:hidden" onClick={() => setMenuOpen(false)}><X /></Button>
        <button onClick={() => openModule("Dashboard")} className="flex items-center gap-3 text-left">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary font-display text-sm font-bold text-primary-foreground">AK</span>
          <div><p className="text-sm font-semibold">Anna Karina Dias</p><p className="text-[10px] text-muted-foreground">Gestão do consultório</p></div>
        </button>
        <nav className="mt-8 space-y-1.5">
          {navItems.map(([label, Icon]) => <button key={label} onClick={() => openModule(label)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-medium transition-colors ${activeModule === label ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}><Icon className="size-4" />{label}</button>)}
        </nav>
        <div className="mt-auto rounded-2xl border border-border bg-background/55 p-3 text-[10px] leading-4 text-muted-foreground"><ShieldCheck className="mb-2 size-4 text-secondary" />Prontuários com TOTP e conteúdo clínico criptografado no navegador.</div>
      </aside>

      {menuOpen && <button className="fixed inset-0 z-40 bg-foreground/20 lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Fechar menu" />}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center border-b border-border bg-background/90 px-4 backdrop-blur-xl sm:px-7">
          <Button variant="ghost" size="icon" className="mr-2 lg:hidden" onClick={() => setMenuOpen(true)}><Menu /></Button>
          <div className="hidden text-xs text-muted-foreground sm:block">{loadingCore ? "Atualizando dados..." : coreLoadError ? "Falha ao atualizar dados" : "Dados atualizados"}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="quiet" size="icon" className="rounded-full"><Bell /></Button>
            <Button variant="quiet" size="icon" className="rounded-full" onClick={() => void signOut()}><LogOut /></Button>
            <div className="hidden border-l border-border pl-3 sm:block"><p className="text-xs font-semibold">{settings?.professional_name || "Anna Karina Dias"}</p><p className="text-[10px] text-muted-foreground">{user?.email ?? ""}</p></div>
          </div>
        </header>

        <main className="mx-auto max-w-[1460px] p-4 sm:p-7">
          {activeModule === "Dashboard" && <DashboardPage patients={patientViews} appointments={appointments} loading={loadingCore} loadError={coreLoadError} openModule={openModule} openRecord={setRecordPatient} onQuickAction={runQuickAction} openFinanceTab={openFinanceTab} />}
          {activeModule === "Agenda" && <AgendaPage patients={patients} services={availableServices(settings)} onChanged={refreshCore} />}
          {activeModule === "Pacientes" && <PatientsPage patients={patientViews} onNew={() => setPatientModal("new")} onEdit={(patient) => setPatientModal(patient)} onRecord={setRecordPatient} onChanged={refreshCore} />}
          {activeModule === "Sessões" && <SessionsPage patients={patients} services={availableServices(settings)} onChanged={refreshCore} initialCreate={pendingQuickAction === "session"} onInitialCreateHandled={() => setPendingQuickAction(null)} />}
          {activeModule === "Financeiro" && <FinancePageV2 initialModal={pendingQuickAction === "expense" ? "expense" : pendingQuickAction === "revenue" ? "revenue" : null} onInitialModalHandled={() => setPendingQuickAction(null)} initialTab={pendingFinanceTab} onInitialTabHandled={() => setPendingFinanceTab(null)} />}
          {activeModule === "Prestação de Serviço" && <ServiceWorkPage />}
          {activeModule === "Relatórios" && <ReportsPage />}
          {activeModule === "Materiais" && <MaterialsPage />}
          {activeModule === "Configurações" && <SettingsPage settings={settings} vaultKey={vaultKey} onVaultKey={setVaultKey} onSettings={(value) => setSettings(value)} />}
        </main>
      </div>

      {patientModal && <PatientModal patient={patientModal === "new" ? null : patientModal} services={availableServices(settings)} onClose={() => setPatientModal(null)} onSaved={async () => { setPatientModal(null); await refreshCore(); }} />}
      {recordPatient && <TwoFactorModal patient={recordPatient} settings={settings} vaultKey={vaultKey} onVaultKey={setVaultKey} onSettings={setSettings} onRecover={() => { setRecordPatient(null); setActiveModule("Configurações"); }} onClose={() => setRecordPatient(null)} onVerified={() => { setVerifiedPatient(recordPatient); setRecordPatient(null); }} />}
      {verifiedPatient && vaultKey && <PatientRecordModal patient={verifiedPatient} vaultKey={vaultKey} onClose={() => setVerifiedPatient(null)} />}
    </div>
  );
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <section className="animate-rise flex flex-wrap items-end justify-between gap-4 pb-6"><div><h1 className="font-display text-3xl leading-tight">{title}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p></div>{action}</section>;
}

// Regra de continuidade: após F5, arrays vazios são apenas o estado inicial do React.
// Não apresentar zeros/"nenhum" até o carregamento principal terminar; use skeleton/erro explícito.
function DashboardPage({ patients: _patients, appointments, loading, loadError, openModule, openRecord: _openRecord, onQuickAction, openFinanceTab }: { patients: PatientView[]; appointments: AppointmentRow[]; loading: boolean; loadError: boolean; openModule: (m: ModuleKey) => void; openRecord: (p: PatientView) => void; onQuickAction: (action: QuickAction) => void; openFinanceTab: (tab: FinanceTab) => void }) {
  const today = isoDateLocal();
  const now = Date.now();
  const todayAppointments = appointments.filter((item) => item.scheduled_at.slice(0, 10) === today && item.status !== "cancelled").sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  const upcomingAppointments = appointments
    .filter((item) => item.scheduled_at.slice(0, 10) !== today && new Date(item.scheduled_at).getTime() > now && ["scheduled", "confirmed"].includes(item.status))
    .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at))
    .slice(0, 6);
  const month = today.slice(0, 7);
  const monthly = appointments.filter((item) => item.scheduled_at.slice(0, 7) === month && item.status !== "cancelled");
  const monthlyFuture = monthly.filter((item) => new Date(item.scheduled_at).getTime() > now && ["scheduled", "confirmed"].includes(item.status)).length;
  const monthlyCompleted = monthly.filter((item) => item.status === "completed").length;
  const monthlyPresential = monthly.filter((item) => item.modality === "presential").length;
  const monthlyOnline = monthly.filter((item) => item.modality === "online").length;

  return <>
    <section className="animate-rise flex flex-wrap items-end justify-between gap-4 pb-6"><div><h1 className="font-display text-3xl">Olá, Anna!</h1><p className="mt-2 text-sm text-muted-foreground">O essencial do consultório em uma visão rápida.</p></div><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" }).format(new Date())}</p></section>
    <FinanceDashboardMetrics onOpenBilled={() => openFinanceTab("billed")} onOpenReceived={() => openFinanceTab("received")} onOpenReceivables={() => openFinanceTab("receivables")} onOpenExpenses={() => openFinanceTab("expenses")} />

    <div className="mt-4 grid grid-cols-12 gap-4">
      <section className="dashboard-card col-span-12 rounded-2xl p-5 xl:col-span-8">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-display text-lg">Agenda e próximos atendimentos</h2><p className="mt-1 text-[11px] text-muted-foreground">Hoje e os próximos compromissos já agendados.</p></div><Button variant="link" className="h-auto p-0 text-xs" onClick={() => openModule("Agenda")}>Ver agenda <ChevronRight /></Button></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Hoje</p><span className="text-[10px] text-muted-foreground">{loading || loadError ? "—" : todayAppointments.length}</span></div>
            <div className="space-y-2">{loading ? <DashboardAgendaSkeleton /> : loadError ? <DashboardLoadError /> : <>{todayAppointments.length === 0 && <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">Nenhum atendimento hoje.</div>}{todayAppointments.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/45 p-3"><span className="w-12 text-xs font-semibold">{new Date(item.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{item.patient_name || appointmentServiceLabel(item)}</p><p className="text-[10px] text-muted-foreground">{appointmentServiceLabel(item)} • {modalityLabel(item.modality)}</p></div><StatusBadge status={statusLabel(item.status)} /></div>)}</>}</div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Próximos</p><span className="text-[10px] text-muted-foreground">{loading || loadError ? "—" : upcomingAppointments.length}</span></div>
            <div className="space-y-2">{loading ? <DashboardAgendaSkeleton /> : loadError ? <DashboardLoadError /> : <>{upcomingAppointments.length === 0 && <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">Nenhuma próxima sessão agendada.</div>}{upcomingAppointments.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/45 p-3"><span className="w-[72px] shrink-0 text-[11px] font-semibold">{new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.scheduled_at))}</span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{item.patient_name || appointmentServiceLabel(item)}</p><p className="text-[10px] text-muted-foreground">{appointmentServiceLabel(item)} • {modalityLabel(item.modality)}</p></div><StatusBadge status={statusLabel(item.status)} /></div>)}</>}</div>
          </div>
        </div>
      </section>

      <section className="dashboard-card col-span-12 rounded-2xl p-5 xl:col-span-4">
        <div><h2 className="font-display text-lg">Ações rápidas</h2><p className="mt-1 text-[11px] text-muted-foreground">Cadastros e lançamentos mais usados.</p></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <button onClick={() => onQuickAction("session")} className="flex items-center gap-3 rounded-xl border border-border bg-background/45 p-3 text-left transition-colors hover:bg-accent/60"><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><Video className="size-4" /></span><div><p className="text-xs font-semibold">Nova sessão</p><p className="mt-0.5 text-[10px] text-muted-foreground">Atendimento</p></div></button>
          <button onClick={() => onQuickAction("expense")} className="flex items-center gap-3 rounded-xl border border-border bg-background/45 p-3 text-left transition-colors hover:bg-accent/60"><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><TrendingDown className="size-4" /></span><div><p className="text-xs font-semibold">Nova despesa</p><p className="mt-0.5 text-[10px] text-muted-foreground">Saída</p></div></button>
          <button onClick={() => onQuickAction("revenue")} className="flex items-center gap-3 rounded-xl border border-border bg-background/45 p-3 text-left transition-colors hover:bg-accent/60"><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><TrendingUp className="size-4" /></span><div><p className="text-xs font-semibold">Nova receita</p><p className="mt-0.5 text-[10px] text-muted-foreground">Entrada</p></div></button>
          <button onClick={() => onQuickAction("patient")} className="flex items-center gap-3 rounded-xl border border-border bg-background/45 p-3 text-left transition-colors hover:bg-accent/60"><span className="grid size-9 place-items-center rounded-xl bg-accent text-primary"><UserPlus className="size-4" /></span><div><p className="text-xs font-semibold">Novo paciente</p><p className="mt-0.5 text-[10px] text-muted-foreground">Cadastro</p></div></button>
        </div>
      </section>

      <section className="dashboard-card col-span-12 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg">Atendimentos deste mês</h2><p className="mt-1 text-[11px] text-muted-foreground">Resumo direto, sem misturar com o financeiro.</p></div><Button variant="link" className="h-auto p-0 text-xs" onClick={() => openModule("Sessões")}>Ver atendimentos <ChevronRight /></Button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <DashboardMiniStat label="Total" value={String(monthly.length)} note="registrados" loading={loading} error={loadError} />
          <DashboardMiniStat label="Futuros" value={String(monthlyFuture)} note="a realizar" loading={loading} error={loadError} />
          <DashboardMiniStat label="Concluídos" value={String(monthlyCompleted)} note="finalizados" loading={loading} error={loadError} />
          <DashboardMiniStat label="Presenciais" value={String(monthlyPresential)} note="no consultório" loading={loading} error={loadError} />
          <DashboardMiniStat label="On-line" value={String(monthlyOnline)} note="remotos" loading={loading} error={loadError} />
        </div>
      </section>
    </div>
  </>;
}

function DashboardAgendaSkeleton() {
  return <div className="rounded-xl border border-border/70 bg-background/35 p-3" aria-hidden="true"><div className="h-3 w-20 animate-pulse rounded bg-muted/70" /><div className="mt-2 h-3 w-40 animate-pulse rounded bg-muted/55" /></div>;
}

function DashboardLoadError() {
  return <div className="rounded-xl border border-dashed border-destructive/30 px-3 py-5 text-center text-[11px] text-destructive">Não foi possível carregar estes dados.</div>;
}

function DashboardMiniStat({ label, value, note, loading = false, error = false }: { label: string; value: string; note: string; loading?: boolean; error?: boolean }) {
  return <div className="rounded-xl border border-border bg-background/45 p-4"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>{loading ? <div className="mt-3 h-6 w-10 animate-pulse rounded bg-muted/70" /> : <p className={`mt-2 font-display text-2xl leading-none ${error ? "text-muted-foreground" : ""}`}>{error ? "—" : value}</p>}<p className={`mt-2 text-[10px] ${error ? "text-destructive" : "text-muted-foreground"}`}>{error ? "Dados indisponíveis" : note}</p></div>;
}

function AgendaPage({ patients, services, onChanged }: { patients: PatientRow[]; services: ServiceCatalogItem[]; onChanged: () => Promise<void> }) {
  type AgendaRange = "day" | "current_month" | "previous_month" | "all";
  const [day, setDay] = useState(isoDateLocal());
  const [range, setRange] = useState<AgendaRange>("day");
  const [items, setItems] = useState<AppointmentRow[]>([]);
  const [editing, setEditing] = useState<AppointmentRow | "new" | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    try {
      if (range === "all") {
        setItems(await listAllAppointments());
        return;
      }
      if (range === "day") {
        const bounds = dayBounds(day);
        setItems(await listAppointments(bounds.start, bounds.end));
        return;
      }
      const current = parseMonth(isoDateLocal().slice(0, 7));
      const target = range === "current_month"
        ? `${current.year}-${String(current.monthNumber).padStart(2, "0")}`
        : (() => {
            const previous = new Date(current.year, current.monthNumber - 2, 1);
            return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
          })();
      const bounds = monthBounds(target);
      setItems(await listAppointments(new Date(`${bounds.start}T00:00:00`).toISOString(), new Date(`${bounds.end}T00:00:00`).toISOString()));
    } finally {
      setLoading(false);
    }
  }, [day, range]);

  useEffect(() => { void reload(); }, [reload]);

  const completed = items.filter((x) => x.status === "completed").length;
  const rangeLabel = range === "day" ? "dia" : range === "current_month" ? "este mês" : range === "previous_month" ? "mês anterior" : "todo o período";
  const defaultDate = range === "day" ? day : isoDateLocal();

  return <>
    <PageHeader title="Agenda" description="Cadastre, edite e acompanhe os atendimentos do consultório." action={<Button variant="dashboard" onClick={() => setEditing("new")}><Plus /> Novo agendamento</Button>} />
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <div><p className="mb-1 text-[10px] text-muted-foreground">Data específica</p><input type="date" value={day} onChange={(e) => { setDay(e.target.value); setRange("day"); }} className="h-10 rounded-xl border border-border bg-card px-3 text-sm" /></div>
      <Button variant={range === "current_month" ? "dashboard" : "quiet"} onClick={() => setRange("current_month")}>Este mês</Button>
      <Button variant={range === "previous_month" ? "dashboard" : "quiet"} onClick={() => setRange("previous_month")}>Mês anterior</Button>
      <Button variant={range === "all" ? "dashboard" : "quiet"} onClick={() => setRange("all")}>Todo período</Button>
    </div>
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="dashboard-card rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] text-muted-foreground">Visualizando</p><p className="mt-1 text-sm font-medium capitalize">{rangeLabel}</p></div><span className="text-xs text-muted-foreground">{loading ? "Carregando..." : `${items.length} registro(s)`}</span></div>
        <div className="mt-5 space-y-3">
          {items.length === 0 && !loading && <Empty text={range === "day" ? "Nenhum atendimento nesta data." : "Nenhum atendimento neste período."} />}
          {items.map((item) => <article key={item.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card/55 p-4 sm:flex-row sm:items-center"><div className={`${range === "day" ? "w-16" : "w-28"} text-xs font-semibold`}>{range === "day" ? new Date(item.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : dateTimeLabel(item.scheduled_at)}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.patient_name || appointmentServiceLabel(item)}</p><p className="mt-1 text-[11px] text-muted-foreground">{modalityLabel(item.modality)} • {item.duration_minutes} min • {appointmentServiceLabel(item)} • {money(item.amount)}</p></div><StatusBadge status={statusLabel(item.status)} /><Button variant="ghost" size="icon" onClick={() => setEditing(item)}><Pencil /></Button></article>)}
        </div>
      </section>
      <section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">Resumo do período</h2><p className="mt-1 text-[10px] text-muted-foreground capitalize">{rangeLabel}</p><div className="mt-4 space-y-3 text-xs"><SummaryRow label="Atendimentos" value={String(items.length)} /><SummaryRow label="Presenciais" value={String(items.filter((x) => x.modality === "presential").length)} /><SummaryRow label="On-line" value={String(items.filter((x) => x.modality === "online").length)} /><SummaryRow label="Concluídos" value={String(completed)} /></div><p className="mt-5 text-[10px] leading-4 text-muted-foreground">O agendamento é interno e gerenciado pela própria profissional.</p></section>
    </div>
    {editing && <AppointmentModal patients={patients} services={services} appointment={editing === "new" ? null : editing} defaultDate={defaultDate} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); await onChanged(); }} />}
  </>;
}

function PatientsPage({ patients, onNew, onEdit, onRecord, onChanged }: { patients: PatientView[]; onNew: () => void; onEdit: (p: PatientRow) => void; onRecord: (p: PatientView) => void; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const visible = patients.filter((p) => {
    const normalizedQuery = cpfDigits(query);
    return p.full_name.toLowerCase().includes(query.toLowerCase())
      || (p.phone ?? "").includes(query)
      || (normalizedQuery.length > 0 && (p.cpf ?? "").includes(normalizedQuery));
  });
  return <>
    <PageHeader title="Pacientes" description="Cadastro administrativo, regras de cobrança e acesso seguro ao prontuário clínico." action={<Button variant="dashboard" onClick={onNew}><UserPlus /> Novo paciente</Button>} />
    <section className="dashboard-card rounded-2xl p-4 sm:p-5"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background/60 pl-10 pr-4 text-sm" placeholder="Buscar paciente..." /></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3">Paciente</th><th className="px-3 py-3">Última sessão</th><th className="px-3 py-3">Próxima sessão</th><th className="px-3 py-3">Cobrança</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Ações</th></tr></thead><tbody>{visible.map((p) => <tr key={p.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-accent text-[11px] font-semibold">{p.initials}</span><div><p className="text-[13px] font-medium">{p.full_name}</p><p className="text-[10px] text-muted-foreground">{p.phone || "Sem telefone"}</p></div></div></td><td className="px-3 py-4 text-xs text-muted-foreground">{p.lastSession}</td><td className="px-3 py-4 text-xs">{p.nextSession}</td><td className="px-3 py-4 text-xs">{p.billing_model === "package" ? `Pacote ${p.package_amount ? money(p.package_amount) : ""}${p.package_payment_mode === "installments" && p.package_installments ? ` • ${p.package_installments}x` : " • à vista"}` : `Por sessão ${p.session_amount ? money(p.session_amount) : ""}`}</td><td className="px-3 py-4"><StatusBadge status={p.active ? "Ativo" : "Pausado"} /></td><td className="px-3 py-4"><div className="flex justify-end gap-1"><Button variant="quiet" size="sm" onClick={() => onRecord(p)}><LockKeyhole /> Prontuário</Button><Button variant="ghost" size="icon" onClick={() => onEdit(p)}><Pencil /></Button><Button variant="ghost" size="icon" onClick={async () => { if (confirm(`Arquivar ${p.full_name}? O histórico clínico e financeiro será preservado.`)) { await deletePatient(p.id); await onChanged(); } }}><Trash2 /></Button></div></td></tr>)}</tbody></table>{visible.length === 0 && <Empty text="Nenhum paciente encontrado." />}</div></section>
    <section className="dashboard-card mt-4 rounded-2xl p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent"><BookOpenText className="size-5" /></span><div><h2 className="font-display text-lg">Prontuário protegido</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Cada abertura exige código TOTP. O conteúdo das evoluções é criptografado no navegador antes de ser armazenado.</p></div></div></section>
  </>;
}

function SessionsPage({ patients, services, onChanged, initialCreate = false, onInitialCreateHandled }: { patients: PatientRow[]; services: ServiceCatalogItem[]; onChanged: () => Promise<void>; initialCreate?: boolean; onInitialCreateHandled?: () => void }) {
  const [month, setMonth] = useState(isoDateLocal().slice(0, 7));
  const [view, setView] = useState<"month" | "all">("month");
  const [allItems, setAllItems] = useState<AppointmentRow[]>([]);
  const [payments, setPayments] = useState<AppointmentPaymentRow[]>([]);
  const [editing, setEditing] = useState<AppointmentRow | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [modalityFilter, setModalityFilter] = useState("all");
  const [attendanceFilter, setAttendanceFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    try {
      const nextItems = await listAllAppointments();
      const nextPayments = await listAppointmentPayments(nextItems.map((item) => item.id));
      setAllItems(nextItems);
      setPayments(nextPayments);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!initialCreate) return;
    setEditing("new");
    onInitialCreateHandled?.();
  }, [initialCreate, onInitialCreateHandled]);

  const items = useMemo(() => view === "all" ? allItems : allItems.filter((x) => x.scheduled_at.slice(0, 7) === month), [allItems, month, view]);
  const completed = items.filter((x) => x.status === "completed");
  const evaluations = items.filter((x) => x.service_kind === "psychological_test" || x.service_kind === "neuropsychology");
  const now = Date.now();
  const future = allItems
    .filter((x) => new Date(x.scheduled_at).getTime() > now && ["scheduled", "confirmed"].includes(x.status))
    .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  const patientMap = useMemo(() => new Map(patients.map((patient) => [patient.id, patient])), [patients]);
  const paymentMap = useMemo(() => {
    const map = new Map<string, AppointmentPaymentRow>();
    payments.forEach((payment) => { if (!map.has(payment.appointment_id)) map.set(payment.appointment_id, payment); });
    return map;
  }, [payments]);
  const isPackageSession = (item: AppointmentRow) => item.service_kind === "session" && Boolean(item.patient_id && patientMap.get(item.patient_id)?.billing_model === "package");
  const pending = items.filter((item) => {
    const payment = paymentMap.get(item.id);
    return !isPackageSession(item) && payment && (payment.status === "pending" || payment.status === "partial");
  });
  const pendingAmount = pending.reduce((sum, item) => {
    const payment = paymentMap.get(item.id)!;
    return sum + Math.max(0, Number(payment.amount) - Number(payment.received_amount || 0));
  }, 0);
  const paymentState = (item: AppointmentRow) => {
    if (isPackageSession(item)) return { label: "Incluída no pacote", tone: "muted" as const };
    const payment = paymentMap.get(item.id);
    if (!payment || item.amount <= 0) return { label: "Sem cobrança", tone: "muted" as const };
    if (payment.status === "paid") return { label: "Recebido", tone: "ok" as const };
    if (payment.status === "partial") return { label: "Parcial", tone: "warn" as const };
    if (payment.status === "cancelled") return { label: "Cancelado", tone: "muted" as const };
    return { label: "A receber", tone: "warn" as const };
  };
  const paymentFilterKey = (item: AppointmentRow) => {
    if (isPackageSession(item)) return "package";
    const payment = paymentMap.get(item.id);
    if (!payment || item.amount <= 0) return "none";
    return payment.status;
  };
  const serviceOptions = Array.from(new Set(items.map((item) => appointmentServiceLabel(item)))).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filteredItems = items.filter((item) => {
    const query = searchQuery.trim().toLocaleLowerCase("pt-BR");
    const matchesQuery = !query || (item.patient_name ?? "").toLocaleLowerCase("pt-BR").includes(query) || appointmentServiceLabel(item).toLocaleLowerCase("pt-BR").includes(query);
    const matchesService = serviceFilter === "all" || appointmentServiceLabel(item) === serviceFilter;
    const matchesModality = modalityFilter === "all" || item.modality === modalityFilter;
    const matchesAttendance = attendanceFilter === "all" || item.status === attendanceFilter;
    const matchesPayment = paymentFilter === "all" || paymentFilterKey(item) === paymentFilter;
    return matchesQuery && matchesService && matchesModality && matchesAttendance && matchesPayment;
  });
  const hasFilters = Boolean(searchQuery.trim()) || serviceFilter !== "all" || modalityFilter !== "all" || attendanceFilter !== "all" || paymentFilter !== "all";
  const clearFilters = () => {
    setSearchQuery("");
    setServiceFilter("all");
    setModalityFilter("all");
    setAttendanceFilter("all");
    setPaymentFilter("all");
  };

  return <>
    <PageHeader title="Sessões" description="Acompanhe sessões, testes, avaliações, próximos atendimentos e pagamentos." action={<Button variant="dashboard" onClick={() => setEditing("new")}><Plus /> Registrar atendimento</Button>} />
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setView("month"); }} className="h-10 rounded-xl border border-border bg-card px-3 text-xs" />
      <Button variant={view === "month" ? "dashboard" : "quiet"} onClick={() => setView("month")}>Mês selecionado</Button>
      <Button variant={view === "all" ? "dashboard" : "quiet"} onClick={() => setView("all")}>Todo período</Button>
    </div>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <MetricCard label="Registros no período" value={String(items.length)} note={view === "month" ? "sessões e serviços no mês" : "todos os registros"} icon={<CalendarDays />} />
      <MetricCard label="Testes e avaliações" value={String(evaluations.length)} note="psicológicos e neuropsicológicos" icon={<ClipboardList />} />
      <MetricCard label="Atendimentos futuros" value={String(future.length)} note="agendados ou confirmados" icon={<Clock3 />} />
      <MetricCard label="A receber" value={money(pendingAmount)} note={`${pending.length} atendimento(s) pendente(s)`} icon={<WalletCards />} />
      <MetricCard label="Concluídos" value={String(completed.length)} note="atendimentos finalizados" icon={<BadgeCheck />} />
    </section>

    <section className="dashboard-card mt-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg">Próximos atendimentos</h2><p className="mt-1 text-[11px] text-muted-foreground">Visão das próximas sessões, testes e demais serviços.</p></div><strong className="text-sm">{future.length} futuro(s)</strong></div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {future.slice(0, 6).map((item) => <button key={item.id} onClick={() => setEditing(item)} className="flex items-center gap-3 rounded-xl border border-border bg-background/45 p-3 text-left hover:bg-accent/50"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary"><CalendarDays className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{item.patient_name || appointmentServiceLabel(item)}</p><p className="mt-1 text-[10px] text-muted-foreground">{dateTimeLabel(item.scheduled_at)} • {appointmentServiceLabel(item)}</p></div><ChevronRight className="size-4 text-muted-foreground" /></button>)}
        {future.length === 0 && <div className="lg:col-span-2"><Empty text="Nenhum atendimento futuro agendado." /></div>}
      </div>
    </section>

    <section className="dashboard-card mt-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg">Atendimentos e serviços</h2><p className="mt-1 text-[11px] text-muted-foreground">Filtre por paciente, serviço, modalidade, atendimento ou pagamento.</p></div><span className="text-[10px] text-muted-foreground">{loading ? "Carregando..." : `${filteredItems.length} de ${items.length} registro(s)`}</span></div>
      <div className="mt-4 rounded-2xl border border-border bg-background/35 p-3">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground"><Filter className="size-4" /> Filtros</div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative xl:col-span-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Paciente ou serviço" className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-xs outline-none" /></label>
          <select value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs"><option value="all">Todos os serviços</option>{serviceOptions.map((service) => <option key={service} value={service}>{service}</option>)}</select>
          <select value={modalityFilter} onChange={(event) => setModalityFilter(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs"><option value="all">Todas as modalidades</option><option value="presential">Presencial</option><option value="online">On-line</option></select>
          <select value={attendanceFilter} onChange={(event) => setAttendanceFilter(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs"><option value="all">Todos os atendimentos</option><option value="scheduled">Agendado</option><option value="confirmed">Confirmado</option><option value="completed">Concluído</option><option value="no_show">Faltou</option><option value="cancelled">Cancelado</option></select>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs"><option value="all">Todos os pagamentos</option><option value="pending">A receber</option><option value="partial">Parcial</option><option value="paid">Recebido</option><option value="package">Incluído no pacote</option><option value="none">Sem cobrança</option><option value="cancelled">Cancelado</option></select>
        </div>
        {hasFilters && <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" onClick={clearFilters}>Limpar filtros</Button></div>}
      </div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1040px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3">Data</th><th className="px-3 py-3">Paciente/cliente</th><th className="px-3 py-3">Serviço</th><th className="px-3 py-3">Modalidade</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3">Atendimento</th><th className="px-3 py-3">Pagamento</th><th className="px-3 py-3 text-right">Ações</th></tr></thead><tbody>{filteredItems.map((item) => { const payment = paymentMap.get(item.id); const state = paymentState(item); return <tr key={item.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs">{dateTimeLabel(item.scheduled_at)}</td><td className="px-3 py-4 text-[13px] font-medium">{item.patient_name || "—"}</td><td className="px-3 py-4 text-xs">{appointmentServiceLabel(item)}</td><td className="px-3 py-4 text-xs">{modalityLabel(item.modality)}</td><td className="px-3 py-4 text-xs font-medium">{isPackageSession(item) ? "Pacote" : money(item.amount)}</td><td className="px-3 py-4"><StatusBadge status={statusLabel(item.status)} /></td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${state.tone === "ok" ? "bg-primary/8 text-primary" : state.tone === "warn" ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground"}`}>{state.label}</span></td><td className="px-3 py-4"><div className="flex justify-end gap-2">{payment && (payment.status === "pending" || payment.status === "partial") && !isPackageSession(item) && <Button size="sm" variant="quiet" onClick={() => setEditing(item)}><Check /> Receber</Button>}<Button variant="ghost" size="icon" onClick={() => setEditing(item)}><Pencil /></Button></div></td></tr>; })}</tbody></table>{filteredItems.length === 0 && !loading && <Empty text={hasFilters ? "Nenhum atendimento corresponde aos filtros." : "Nenhum atendimento encontrado neste período."} />}</div>
    </section>
    {editing && <AppointmentModal patients={patients} services={services} appointment={editing === "new" ? null : editing} defaultDate={`${month}-01`} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); await onChanged(); }} />}
  </>;
}

function ReportsPage() {
  const [month, setMonth] = useState(isoDateLocal().slice(0, 7));
  const [data, setData] = useState<ReportsBundle>({ appointments: [], billings: [], received: [], receivables: [], expenses: [] });
  const [history, setHistory] = useState<Array<{ month: string; billed: number; expenses: number }>>([]);
  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const b = monthBounds(month);
    setData(await loadReports(b.start, b.end));
    const { year, monthNumber } = parseMonth(month);
    const start = new Date(year, monthNumber - 6, 1);
    const end = new Date(year, monthNumber, 1);
    const hist = await loadFinanceHistory(isoDateLocal(start), isoDateLocal(end));
    const rows: Array<{ month: string; billed: number; expenses: number }> = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(year, monthNumber - 6 + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      rows.push({ month: key, billed: hist.billings.filter((x) => String(x.competence_date).slice(0, 7) === key).reduce((s, x) => s + Number(x.amount), 0), expenses: hist.expenses.filter((x) => String(x.competence_date).slice(0, 7) === key).reduce((s, x) => s + Number(x.amount), 0) });
    }
    setHistory(rows);
  }, [month]);
  useEffect(() => { void reload(); }, [reload]);
  const completed = data.appointments.filter((x) => x.status === "completed");
  const attendedPatients = new Set(completed.map((x) => x.patient_id).filter(Boolean)).size;
  const billed = data.billings.reduce((s, x) => s + Number(x.amount), 0);
  const received = data.received.reduce((s, x) => s + Number(x.received_amount), 0);
  const expenses = data.expenses.reduce((s, x) => s + Number(x.amount), 0);
  const receivable = data.receivables.reduce((s, x) => s + Math.max(0, Number(x.amount) - Number(x.received_amount)), 0);
  const presential = completed.filter((x) => x.modality === "presential").length;
  const online = completed.filter((x) => x.modality === "online").length;
  const noShow = data.appointments.filter((x) => x.status === "no_show").length;
  const attendanceBase = completed.length + noShow;
  const attendanceRate = attendanceBase ? (completed.length / attendanceBase) * 100 : 0;
  const exportCsv = () => {
    const lines = ["Indicador;Valor", `Pacientes atendidos;${attendedPatients}`, `Atendimentos concluídos;${completed.length}`, `Faturado;${billed.toFixed(2)}`, `Recebido;${received.toFixed(2)}`, `Despesas;${expenses.toFixed(2)}`, `Resultado de caixa;${(received-expenses).toFixed(2)}`, `Carteira a receber;${receivable.toFixed(2)}`, `Taxa de comparecimento;${attendanceRate.toFixed(1)}%`];
    const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `relatorio-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <>
    <PageHeader title="Relatórios" description="Indicadores reais de atendimentos, faturamento, recebimentos, despesas e pendências." action={<div className="flex gap-2"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs" /><Button variant="dashboard" onClick={exportCsv}><Download /> Exportar CSV</Button></div>} />
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Pacientes atendidos" value={String(attendedPatients)} note={`${completed.length} atendimento(s) concluído(s)`} icon={<Users />} /><MetricCard label="Faturado" value={money(billed)} note={`Recebido: ${money(received)}`} icon={<TrendingUp />} /><MetricCard label="Despesas" value={money(expenses)} note={billed ? `${((expenses/billed)*100).toFixed(1).replace(".", ",")}% do faturamento` : "sem faturamento no período"} icon={<TrendingDown />} /><MetricCard label="Resultado de caixa" value={money(received-expenses)} note={`Carteira: ${money(receivable)}`} icon={<WalletCards />} /></section>
    <div className="mt-4 grid gap-4 xl:grid-cols-2"><section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">Atendimentos por semana</h2><WeeklyAppointmentsChart appointments={data.appointments} /></section><section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">Faturamento x despesas</h2><FinanceHistoryChart rows={history} /></section></div>
    <div className="mt-4 grid gap-4 md:grid-cols-3"><ReportInsight title="Modalidade" value={presential >= online ? "Presencial" : "On-line"} detail={`${presential} presenciais • ${online} on-line`} icon={<Users />} /><ReportInsight title="Pagamentos pendentes" value={money(receivable)} detail={`${data.receivables.length} cobrança(s) em aberto`} icon={<CircleDollarSign />} /><ReportInsight title="Comparecimento" value={`${attendanceRate.toFixed(0)}%`} detail={`${noShow} falta(s) no período`} icon={<BadgeCheck />} /></div>
  </>;
}

function MaterialsPage() {
  const [items, setItems] = useState<MaterialRow[]>([]);
  const [query, setQuery] = useState("");
  const [modal, setModal] = useState(false);
  const reload = useCallback(async () => { if (isSupabaseConfigured) setItems(await listMaterials()); }, []);
  useEffect(() => { void reload(); }, [reload]);
  const visible = items.filter((x) => x.title.toLowerCase().includes(query.toLowerCase()) || (x.category ?? "").toLowerCase().includes(query.toLowerCase()));
  return <>
    <PageHeader title="Materiais" description="Armazene arquivos do consultório em uma área privada e protegida." action={<Button variant="dashboard" onClick={() => setModal(true)}><Upload /> Adicionar material</Button>} />
    <section className="dashboard-card rounded-2xl p-5"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background/60 pl-10 pr-4 text-sm" placeholder="Buscar material..." /></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-card/55 p-4"><span className="grid size-10 place-items-center rounded-xl bg-accent"><FileText className="size-5" /></span><h2 className="mt-4 text-sm font-medium">{item.title}</h2><p className="mt-1 text-[11px] text-muted-foreground">{item.category || "Sem categoria"} • {item.file_type || "Arquivo"}</p><p className="mt-3 text-[10px] text-muted-foreground">Adicionado em {dateLabel(item.created_at)}</p><div className="mt-4 flex gap-2"><Button variant="quiet" size="sm" className="flex-1" onClick={async () => { if (!item.file_path) return; const url = await openMaterial(item.file_path); window.open(url, "_blank", "noopener,noreferrer"); }}><Eye /> Abrir</Button><Button variant="ghost" size="icon" onClick={async () => { if (confirm(`Excluir ${item.title}?`)) { await deleteMaterial(item); await reload(); } }}><Trash2 /></Button></div></article>)}</div>{visible.length === 0 && <Empty text="Nenhum material cadastrado." />}</section>
    {modal && <MaterialModal onClose={() => setModal(false)} onSaved={async () => { setModal(false); await reload(); }} />}
  </>;
}

function SettingsPage({ settings, vaultKey, onVaultKey, onSettings }: { settings: AppSettingsRow | null; vaultKey: CryptoKey | null; onVaultKey: (k: CryptoKey | null) => void; onSettings: (s: AppSettingsRow) => void }) {
  // Nome completo, CPF e CRP formam a identificação profissional usada futuramente
  // em recibos e notas de cobrança. Não fixe esses dados no código: a fonte é Configurações.
  const [draft, setDraft] = useState({ professional_name: settings?.professional_name || "Anna Karina Dias", cpf: formatCpf(settings?.cpf), crp: settings?.crp || "", city: settings?.city || "", phone: settings?.phone || "", email: settings?.email || "" });
  const [message, setMessage] = useState("");
  useEffect(() => { if (settings) setDraft({ professional_name: settings.professional_name, cpf: formatCpf(settings.cpf), crp: settings.crp || "", city: settings.city || "", phone: settings.phone || "", email: settings.email || "" }); }, [settings]);
  const saveProfile = async () => {
    setMessage("");
    try {
      const saved = await saveAppSettings({ ...draft, cpf: draft.cpf || null });
      onSettings(saved);
      setMessage("Perfil salvo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar o perfil.");
    }
  };
  return <>
    <PageHeader title="Configurações" description="Perfil, serviços oferecidos e proteção da conta e dos prontuários." />
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsCard title="Perfil profissional" description="Dados administrativos usados no consultório, recibos e documentos financeiros."><div className="grid gap-4 sm:grid-cols-2"><FieldEdit label="Nome completo" value={draft.professional_name} onChange={(v) => setDraft((d) => ({...d, professional_name:v}))} /><FieldEdit label="CPF" value={draft.cpf} onChange={(v) => setDraft((d) => ({...d, cpf:formatCpf(v)}))} /><FieldEdit label="CRP" value={draft.crp} onChange={(v) => setDraft((d) => ({...d, crp:v}))} /><FieldEdit label="Cidade" value={draft.city} onChange={(v) => setDraft((d) => ({...d, city:v}))} /><FieldEdit label="Telefone" value={draft.phone} onChange={(v) => setDraft((d) => ({...d, phone:v}))} /><FieldEdit label="E-mail" value={draft.email} onChange={(v) => setDraft((d) => ({...d, email:v}))} /></div><Button variant="quiet" size="sm" className="mt-4" onClick={() => void saveProfile()}>Salvar alterações</Button></SettingsCard>
      <ServiceCatalogSettings settings={settings} onSettings={onSettings} />
      <MfaSettings />
      <VaultSettings settings={settings} vaultKey={vaultKey} onVaultKey={onVaultKey} onSettings={onSettings} />
      <SettingsCard title="Proteção implementada" description="Como os dados clínicos são protegidos."><div className="space-y-3 text-xs text-muted-foreground"><p><strong className="text-foreground">Controle de acesso:</strong> o usuário autenticado acessa somente os próprios registros.</p><p><strong className="text-foreground">TOTP:</strong> cada abertura de prontuário exige um novo código do aplicativo autenticador.</p><p><strong className="text-foreground">Criptografia:</strong> evoluções são cifradas com AES-GCM no navegador e o sistema armazena somente o conteúdo cifrado.</p><p><strong className="text-foreground">Cofre:</strong> a senha não é salva no sistema. A recuperação principal usa o e-mail cadastrado + Google Authenticator; o código separado permanece como contingência.</p></div></SettingsCard>
    </div>
    {message && <p className="mt-4 text-xs text-primary">{message}</p>}
  </>;
}

function ServiceCatalogSettings({ settings, onSettings }: { settings: AppSettingsRow | null; onSettings: (s: AppSettingsRow) => void }) {
  const [items, setItems] = useState<ServiceCatalogItem[]>(() => availableServices(settings).map((item) => ({ ...item })));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setItems(availableServices(settings).map((item) => ({ ...item })));
  }, [settings]);

  const updateItem = (id: string, patch: Partial<ServiceCatalogItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addItem = () => setItems((current) => [...current, { id: crypto.randomUUID(), name: "Novo serviço", kind: "other", active: true }]);
  const removeItem = (id: string) => setItems((current) => current.filter((item) => item.id !== id));
  const save = async () => {
    const normalized = items.map((item) => ({ ...item, name: item.name.trim() })).filter((item) => item.name);
    if (normalized.length === 0) { setMessage("Mantenha pelo menos um serviço cadastrado."); return; }
    setSaving(true); setMessage("");
    try {
      const saved = await saveAppSettings({ service_catalog: normalized });
      onSettings(saved);
      setMessage("Serviços atualizados.");
    } catch {
      setMessage("Não foi possível salvar os serviços.");
    } finally {
      setSaving(false);
    }
  };

  return <SettingsCard title="Serviços oferecidos" description="Defina quais serviços aparecem ao criar ou editar um agendamento."><div className="space-y-3">{items.map((item) => <div key={item.id} className="grid gap-2 rounded-xl border border-border bg-background/45 p-3 sm:grid-cols-[1fr_150px_110px_auto]"><input value={item.name} maxLength={120} onChange={(e)=>updateItem(item.id,{name:e.target.value})} className="h-9 rounded-lg border border-border bg-background px-3 text-xs" aria-label="Nome do serviço" /><select value={item.kind} onChange={(e)=>updateItem(item.id,{kind:e.target.value as ServiceKind})} className="h-9 rounded-lg border border-border bg-background px-2 text-xs" aria-label="Categoria do serviço"><option value="session">Sessão</option><option value="psychological_test">Teste psicológico</option><option value="neuropsychology">Neuropsicologia</option><option value="company">Empresa</option><option value="other">Outro</option></select><select value={item.active ? "active" : "inactive"} onChange={(e)=>updateItem(item.id,{active:e.target.value === "active"})} className="h-9 rounded-lg border border-border bg-background px-2 text-xs" aria-label="Status do serviço"><option value="active">Ativo</option><option value="inactive">Inativo</option></select><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={()=>removeItem(item.id)} aria-label={`Excluir ${item.name}`}><Trash2 /></Button></div>)}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><Button variant="quiet" size="sm" onClick={addItem}><Plus /> Adicionar serviço</Button><Button variant="dashboard" size="sm" disabled={saving} onClick={()=>void save()}>{saving ? "Salvando..." : "Salvar serviços"}</Button></div>{message && <p className="mt-3 text-[11px] text-muted-foreground">{message}</p>}<p className="mt-3 text-[10px] leading-4 text-muted-foreground">A categoria mantém os cálculos financeiros corretos. O nome pode ser personalizado livremente.</p></SettingsCard>;
}

function MfaSettings() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) { setMessage(error.message); return; }
    const factor = data.totp.find((x) => x.status === "verified") ?? data.totp[0];
    setFactorId(factor?.id ?? null); setVerified(factor?.status === "verified");
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const startEnroll = async () => {
    if (!supabase) return;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Prontuário Anna" });
    if (error) { setMessage(error.message); return; }
    setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setMessage("Escaneie o QR Code no Google Authenticator e confirme o código.");
  };
  const confirmEnroll = async () => {
    if (!supabase || !factorId || !/^\d{6}$/.test(code)) return;
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) { setMessage(challengeError.message); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
    if (error) { setMessage("Código inválido. Tente novamente."); return; }
    setQr(""); setSecret(""); setCode(""); setMessage("Autenticador configurado com sucesso."); await refresh();
  };
  const qrSrc = qr.startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}` : qr;
  return <SettingsCard title="Google Authenticator / 2FA" description="Obrigatório para abrir qualquer prontuário.">{verified ? <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs"><div className="flex items-center gap-2 font-medium text-primary"><ShieldCheck className="size-4" /> Autenticador ativo</div><p className="mt-2 text-muted-foreground">Cada prontuário solicitará um novo código de 6 dígitos.</p></div> : <div><Button variant="dashboard" size="sm" onClick={() => void startEnroll()}>Configurar autenticador</Button>{qr && <div className="mt-4"><img src={qrSrc} alt="QR Code do autenticador" className="size-44 rounded-xl bg-white p-2" /><p className="mt-2 break-all text-[10px] text-muted-foreground">Chave manual: {secret}</p><div className="mt-3 flex gap-2"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-center font-mono tracking-[0.3em]" placeholder="000000" /><Button variant="dashboard" onClick={() => void confirmEnroll()}>Confirmar</Button></div></div>}</div>}{message && <p className="mt-3 text-[11px] text-muted-foreground">{message}</p>}</SettingsCard>;
}

function VaultSettings({ settings, vaultKey, onVaultKey, onSettings }: { settings: AppSettingsRow | null; vaultKey: CryptoKey | null; onVaultKey: (k: CryptoKey | null) => void; onSettings: (s: AppSettingsRow) => void }) {
  const { user } = useAuth();
  const legacyConfigured = Boolean(settings?.vault_salt && settings?.vault_verifier_ciphertext && settings?.vault_verifier_iv);
  const recoverableConfigured = Boolean(
    settings?.vault_version === 3
    && settings.vault_password_salt
    && settings.vault_password_key_ciphertext
    && settings.vault_password_key_iv
    && settings.vault_recovery_salt
    && settings.vault_recovery_key_ciphertext
    && settings.vault_recovery_key_iv,
  );
  const configured = recoverableConfigured || legacyConfigured;
  const emailRecoveryConfigured = Boolean(settings?.vault_email_recovery_ciphertext && settings?.vault_email_recovery_iv && settings?.vault_email_recovery_version === 1);
  const [pass, setPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [message, setMessage] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [activatingEmailRecovery, setActivatingEmailRecovery] = useState(false);
  const [recoveringByEmail, setRecoveringByEmail] = useState(() =>
    typeof window !== "undefined" && window.sessionStorage.getItem("tages:vault-email-recovery-authorized") === "1",
  );
  const [changingPassword, setChangingPassword] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmNewPass, setConfirmNewPass] = useState("");
  const [vaultBusy, setVaultBusy] = useState(false);

  const saveRecoverableSettings = async (created: {
    password: { salt: string; ciphertext: string; iv: string };
    recovery: { salt: string; ciphertext: string; iv: string };
  }) => saveAppSettings({
    vault_version: 3,
    vault_salt: null,
    vault_verifier_ciphertext: null,
    vault_verifier_iv: null,
    vault_password_salt: created.password.salt,
    vault_password_key_ciphertext: created.password.ciphertext,
    vault_password_key_iv: created.password.iv,
    vault_recovery_salt: created.recovery.salt,
    vault_recovery_key_ciphertext: created.recovery.ciphertext,
    vault_recovery_key_iv: created.recovery.iv,
  });

  const activateEmailRecovery = async (key: CryptoKey) => {
    const envelope = await provisionVaultEmailRecovery(key);
    const saved = await saveAppSettings({
      vault_email_recovery_ciphertext: envelope.ciphertext,
      vault_email_recovery_iv: envelope.iv,
      vault_email_recovery_version: envelope.version,
    });
    onSettings(saved);
    return saved;
  };

  const sendVaultRecoveryEmail = async () => {
    if (!supabase || !user?.email) throw new Error("Não foi possível identificar o e-mail cadastrado da conta.");
    const redirectTo = `${window.location.origin}${window.location.pathname}?mode=vault-recovery`;
    const { error } = await supabase.auth.signInWithOtp({
      email: user.email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    if (error) {
      const normalized = error.message.toLowerCase();
      if (normalized.includes("rate limit")) throw new Error("Muitas solicitações de e-mail foram feitas recentemente. Aguarde alguns minutos e tente novamente.");
      throw error;
    }
    setMessage(`Enviamos um link de recuperação para ${user.email}. Abra o e-mail e confirme também o Google Authenticator.`);
  };

  const requestEmailRecovery = async () => {
    if (!emailRecoveryConfigured) {
      if (vaultKey) {
        setVaultBusy(true);
        setMessage("");
        try {
          await activateEmailRecovery(vaultKey);
          await sendVaultRecoveryEmail();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Não foi possível ativar a recuperação por e-mail.");
        } finally {
          setVaultBusy(false);
        }
        return;
      }
      // Cofres criados antes da v2.0.24 ainda não possuem o envelope de recuperação por e-mail.
      // A chave clínica não pode ser reconstruída só com o login/MFA; por isso esta migração
      // pede UMA única confirmação da senha atual ou do código de recuperação. Depois disso,
      // a recuperação principal passa a ser somente e-mail + Google Authenticator.
      setActivatingEmailRecovery(true);
      setMessage("");
      return;
    }
    setVaultBusy(true);
    setMessage("");
    try {
      await sendVaultRecoveryEmail();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível enviar o e-mail de recuperação.");
    } finally {
      setVaultBusy(false);
    }
  };

  const activateLegacyEmailRecovery = async () => {
    if (!settings) return;
    if (!pass.trim() && !recoveryInput.trim()) {
      setMessage("Informe a senha atual do cofre ou o código de recuperação para concluir esta ativação única.");
      return;
    }
    setVaultBusy(true);
    setMessage("");
    try {
      let key: CryptoKey | null = null;
      if (pass.trim()) {
        if (recoverableConfigured && settings.vault_password_salt && settings.vault_password_key_ciphertext && settings.vault_password_key_iv) {
          key = await unlockRecoverableVault(pass, {
            salt: settings.vault_password_salt,
            ciphertext: settings.vault_password_key_ciphertext,
            iv: settings.vault_password_key_iv,
          });
        } else if (legacyConfigured && settings.vault_salt && settings.vault_verifier_ciphertext && settings.vault_verifier_iv) {
          key = await unlockLegacyVault(pass, settings.vault_salt, settings.vault_verifier_ciphertext, settings.vault_verifier_iv);
          if (key) {
            const upgraded = await createRecoverableEnvelopeForExistingKey(pass, key);
            const saved = await saveRecoverableSettings(upgraded);
            onSettings(saved);
            setRecoveryCode(upgraded.recoveryCode);
          }
        }
      } else if (recoverableConfigured && settings.vault_recovery_salt && settings.vault_recovery_key_ciphertext && settings.vault_recovery_key_iv) {
        key = await recoverVaultWithCode(recoveryInput, {
          salt: settings.vault_recovery_salt,
          ciphertext: settings.vault_recovery_key_ciphertext,
          iv: settings.vault_recovery_key_iv,
        });
      }
      if (!key) {
        setMessage(pass.trim() ? "Senha atual do cofre incorreta." : "Código de recuperação inválido.");
        return;
      }
      await activateEmailRecovery(key);
      onVaultKey(key);
      setPass("");
      setRecoveryInput("");
      setActivatingEmailRecovery(false);
      await sendVaultRecoveryEmail();
    } catch (error) {
      console.error("Falha ao ativar recuperação por e-mail do cofre legado", error);
      setMessage(error instanceof Error ? error.message : "Não foi possível ativar a recuperação por e-mail.");
    } finally {
      setVaultBusy(false);
    }
  };

  const recoverByEmail = async () => {
    if (!settings) return;
    if (!newPass || newPass !== confirmNewPass) {
      setMessage(!newPass ? "Informe a nova senha do cofre." : "As novas senhas não coincidem.");
      return;
    }
    setVaultBusy(true);
    setMessage("");
    try {
      const key = await recoverVaultKeyFromEmailEnvelope(settings);
      const passwordEnvelope = await createPasswordEnvelope(key, newPass);
      const saved = await saveAppSettings({
        vault_version: 3,
        vault_password_salt: passwordEnvelope.salt,
        vault_password_key_ciphertext: passwordEnvelope.ciphertext,
        vault_password_key_iv: passwordEnvelope.iv,
      });
      onSettings(saved);
      onVaultKey(key);
      window.sessionStorage.removeItem("tages:vault-email-recovery-authorized");
      setRecoveringByEmail(false);
      setNewPass("");
      setConfirmNewPass("");
      setMessage("Senha do cofre redefinida por e-mail com sucesso. As evoluções foram preservadas.");
    } catch (error) {
      console.error("Falha na recuperação do cofre por e-mail", error);
      setMessage(error instanceof Error ? error.message : "Não foi possível recuperar o cofre por e-mail.");
    } finally {
      setVaultBusy(false);
    }
  };

  const setup = async () => {
    if (!isValidVaultPassphrase(pass) || pass !== confirmPass) {
      setMessage(!pass ? "Informe uma senha para o cofre." : "As senhas informadas não coincidem.");
      return;
    }
    setVaultBusy(true);
    setMessage("");
    try {
      const created = await createRecoverableVault(pass);
      const saved = await saveRecoverableSettings(created);
      onSettings(saved);
      onVaultKey(created.key);
      setRecoveryCode(created.recoveryCode);
      setPass("");
      setConfirmPass("");
      try {
        await activateEmailRecovery(created.key);
        setMessage("Cofre criado e recuperação por e-mail ativada. Guarde também o código abaixo como alternativa de emergência.");
      } catch (emailError) {
        console.error("Falha ao ativar recuperação do cofre por e-mail", emailError);
        setMessage(`Cofre criado. A recuperação por e-mail ainda não foi ativada: ${emailError instanceof Error ? emailError.message : "verifique a configuração do servidor"}. Guarde o código abaixo.`);
      }
    } catch (error) {
      console.error("Falha ao criar cofre clínico", error);
      setMessage(vaultOperationErrorMessage(error, "criar"));
    } finally {
      setVaultBusy(false);
    }
  };

  const unlock = async () => {
    if (!settings) return;
    try {
      let key: CryptoKey | null = null;
      if (recoverableConfigured && settings.vault_password_salt && settings.vault_password_key_ciphertext && settings.vault_password_key_iv) {
        key = await unlockRecoverableVault(pass, {
          salt: settings.vault_password_salt,
          ciphertext: settings.vault_password_key_ciphertext,
          iv: settings.vault_password_key_iv,
        });
      } else if (legacyConfigured && settings.vault_salt && settings.vault_verifier_ciphertext && settings.vault_verifier_iv) {
        key = await unlockLegacyVault(pass, settings.vault_salt, settings.vault_verifier_ciphertext, settings.vault_verifier_iv);
        if (key) {
          // Migração v2 -> v3: preserva a MESMA chave que já cifra as evoluções e apenas
          // passa a encapsulá-la pela senha + código de recuperação. Nenhum prontuário é recriptografado.
          const upgraded = await createRecoverableEnvelopeForExistingKey(pass, key);
          const saved = await saveRecoverableSettings(upgraded);
          onSettings(saved);
          setRecoveryCode(upgraded.recoveryCode);
          setMessage("Cofre atualizado para permitir recuperação. Guarde o código de recuperação abaixo.");
        }
      }
      if (!key) {
        setMessage("Senha do cofre incorreta.");
        return;
      }
      onVaultKey(key);
      setPass("");
      try {
        await activateEmailRecovery(key);
        if (!recoveryCode) setMessage("Cofre desbloqueado. Recuperação por e-mail ativa para a conta cadastrada.");
      } catch (emailError) {
        console.error("Falha ao atualizar recuperação do cofre por e-mail", emailError);
        if (!recoveryCode) setMessage(`Cofre desbloqueado, mas a recuperação por e-mail não pôde ser ativada: ${emailError instanceof Error ? emailError.message : "verifique a configuração do servidor"}.`);
      }
    } catch (error) {
      console.error("Falha ao desbloquear cofre clínico", error);
      setMessage(vaultOperationErrorMessage(error, "desbloquear"));
    }
  };

  const recover = async () => {
    if (!settings?.vault_recovery_salt || !settings.vault_recovery_key_ciphertext || !settings.vault_recovery_key_iv) {
      setMessage("A recuperação ainda não foi configurada para este cofre. Desbloqueie com a senha atual para ativá-la.");
      return;
    }
    if (!recoveryInput.trim() || !newPass || newPass !== confirmNewPass) {
      setMessage(!recoveryInput.trim() ? "Informe o código de recuperação." : !newPass ? "Informe a nova senha do cofre." : "As novas senhas não coincidem.");
      return;
    }
    const key = await recoverVaultWithCode(recoveryInput, {
      salt: settings.vault_recovery_salt,
      ciphertext: settings.vault_recovery_key_ciphertext,
      iv: settings.vault_recovery_key_iv,
    });
    if (!key) {
      setMessage("Código de recuperação inválido.");
      return;
    }
    try {
      const passwordEnvelope = await createPasswordEnvelope(key, newPass);
      const saved = await saveAppSettings({
        vault_version: 3,
        vault_password_salt: passwordEnvelope.salt,
        vault_password_key_ciphertext: passwordEnvelope.ciphertext,
        vault_password_key_iv: passwordEnvelope.iv,
      });
      onSettings(saved);
      onVaultKey(key);
      setRecoveryInput("");
      setNewPass("");
      setConfirmNewPass("");
      setRecovering(false);
      try {
        await activateEmailRecovery(key);
        setMessage("Senha do cofre redefinida. A recuperação por e-mail também ficou ativa e as evoluções foram preservadas.");
      } catch (emailError) {
        console.error("Falha ao ativar recuperação por e-mail após código", emailError);
        setMessage("Senha do cofre redefinida com sucesso. As evoluções existentes foram preservadas; mantenha o código de recuperação guardado.");
      }
    } catch (error) {
      console.error("Falha ao redefinir senha do cofre", error);
      setMessage(vaultOperationErrorMessage(error, "redefinir"));
    }
  };

  const changePassword = async () => {
    if (!vaultKey) { setMessage("Desbloqueie o cofre antes de trocar a senha."); return; }
    if (!newPass || newPass !== confirmNewPass) {
      setMessage(!newPass ? "Informe a nova senha do cofre." : "As novas senhas não coincidem.");
      return;
    }
    setVaultBusy(true);
    setMessage("");
    try {
      // A chave que cifra as evoluções não muda. Apenas o envelope protegido pela senha
      // é recriado; assim trocar a senha não exige recriptografar prontuários.
      const passwordEnvelope = await createPasswordEnvelope(vaultKey, newPass);
      const saved = await saveAppSettings({
        vault_version: 3,
        vault_password_salt: passwordEnvelope.salt,
        vault_password_key_ciphertext: passwordEnvelope.ciphertext,
        vault_password_key_iv: passwordEnvelope.iv,
      });
      onSettings(saved);
      setNewPass("");
      setConfirmNewPass("");
      setChangingPassword(false);
      setMessage("Senha do cofre alterada com sucesso.");
    } catch (error) {
      console.error("Falha ao trocar senha do cofre", error);
      setMessage(vaultOperationErrorMessage(error, "redefinir"));
    } finally {
      setVaultBusy(false);
    }
  };

  const regenerateRecovery = async () => {
    if (!vaultKey) return;
    try {
      const generated = await createRecoveryEnvelope(vaultKey);
      const saved = await saveAppSettings({
        vault_version: 3,
        vault_recovery_salt: generated.recovery.salt,
        vault_recovery_key_ciphertext: generated.recovery.ciphertext,
        vault_recovery_key_iv: generated.recovery.iv,
      });
      onSettings(saved);
      setRecoveryCode(generated.recoveryCode);
      setMessage("Novo código de recuperação gerado. O código anterior deixou de funcionar.");
    } catch (error) {
      console.error("Falha ao gerar código de recuperação do cofre", error);
      setMessage(vaultOperationErrorMessage(error, "recuperacao"));
    }
  };

  return (
    <SettingsCard title="Cofre clínico criptografado" description="A senha não é armazenada no sistema. A recuperação principal usa o e-mail cadastrado + Google Authenticator; o código de recuperação continua disponível como alternativa de emergência.">
      {!configured ? (
        <div className="space-y-3">
          <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Crie uma senha para o cofre" />
          <input type="password" autoComplete="new-password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Repita a senha" />
          <p className="text-[10px] leading-4 text-muted-foreground">Não há requisito mínimo de caracteres. Para maior segurança, prefira uma senha difícil de adivinhar.</p>
          <Button variant="dashboard" disabled={vaultBusy} onClick={() => void setup()}>{vaultBusy ? "Criando cofre..." : "Criar cofre clínico"}</Button>
        </div>
      ) : activatingEmailRecovery ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-5 text-primary">
            Ativação única da recuperação por e-mail. Este cofre foi criado antes desse recurso. Confirme uma vez a senha atual <strong>ou</strong> o código de recuperação; depois disso, futuras recuperações usarão somente e-mail + Google Authenticator.
          </div>
          <input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Senha atual do cofre (opção 1)" />
          <div className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">ou</div>
          <input value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())} className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm" placeholder="Código de recuperação (opção 2)" autoComplete="off" />
          <div className="flex flex-wrap gap-2">
            <Button variant="dashboard" disabled={vaultBusy} onClick={() => void activateLegacyEmailRecovery()}>{vaultBusy ? "Ativando..." : "Ativar e enviar e-mail"}</Button>
            <Button variant="ghost" onClick={() => { setActivatingEmailRecovery(false); setPass(""); setRecoveryInput(""); setMessage(""); }}>Cancelar</Button>
          </div>
        </div>
      ) : recoveringByEmail ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs leading-5 text-primary">E-mail e Google Authenticator confirmados. Defina uma nova senha para o cofre.</div>
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Nova senha do cofre" autoComplete="new-password" />
          <input type="password" value={confirmNewPass} onChange={(e) => setConfirmNewPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Repita a nova senha" autoComplete="new-password" />
          <div className="flex flex-wrap gap-2"><Button variant="dashboard" disabled={vaultBusy} onClick={() => void recoverByEmail()}>{vaultBusy ? "Recuperando..." : "Redefinir senha do cofre"}</Button><Button variant="ghost" onClick={() => { window.sessionStorage.removeItem("tages:vault-email-recovery-authorized"); setRecoveringByEmail(false); setNewPass(""); setConfirmNewPass(""); setMessage(""); }}>Cancelar</Button></div>
        </div>
      ) : recovering ? (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">Informe o código de recuperação salvo anteriormente e defina uma nova senha. O conteúdo clínico permanecerá criptografado.</p>
          <input value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())} className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-sm" placeholder="Código de recuperação" autoComplete="off" />
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Nova senha do cofre" autoComplete="new-password" />
          <input type="password" value={confirmNewPass} onChange={(e) => setConfirmNewPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Repita a nova senha" autoComplete="new-password" />
          <div className="flex flex-wrap gap-2"><Button variant="dashboard" onClick={() => void recover()}>Redefinir senha do cofre</Button><Button variant="ghost" onClick={() => setRecovering(false)}>Cancelar</Button></div>
        </div>
      ) : changingPassword ? (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">Defina a nova senha do cofre. As evoluções existentes permanecem criptografadas e o código de recuperação atual continua válido.</p>
          <input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Nova senha do cofre" autoComplete="new-password" />
          <input type="password" value={confirmNewPass} onChange={(e) => setConfirmNewPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Repita a nova senha" autoComplete="new-password" />
          <div className="flex flex-wrap gap-2"><Button variant="dashboard" disabled={vaultBusy} onClick={() => void changePassword()}>{vaultBusy ? "Alterando..." : "Salvar nova senha"}</Button><Button variant="ghost" onClick={() => { setChangingPassword(false); setNewPass(""); setConfirmNewPass(""); setMessage(""); }}>Cancelar</Button></div>
        </div>
      ) : vaultKey ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary"><Check className="mr-2 inline size-4" /> Cofre desbloqueado nesta sessão</div>
          <p className="text-[10px] leading-4 text-muted-foreground">Recuperação por e-mail: <strong className={emailRecoveryConfigured ? "text-primary" : "text-destructive"}>{emailRecoveryConfigured ? "ativa" : "pendente"}</strong>.</p>
          <div className="flex flex-wrap gap-2"><Button variant="dashboard" size="sm" onClick={() => { setChangingPassword(true); setMessage(""); }}>Trocar senha do cofre</Button><Button variant="quiet" size="sm" onClick={() => void regenerateRecovery()}>Gerar novo código de recuperação</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2"><input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void unlock(); }} className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm" placeholder="Senha do cofre" /><Button variant="dashboard" onClick={() => void unlock()}>Desbloquear</Button></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="quiet" size="sm" disabled={vaultBusy} onClick={() => void requestEmailRecovery()}>{vaultBusy ? "Aguarde..." : emailRecoveryConfigured ? "Recuperar por e-mail" : "Ativar recuperação por e-mail"}</Button>
            <button type="button" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-primary hover:underline" onClick={() => { setRecovering(true); setMessage(""); }}>Usar código de recuperação</button>
          </div>
        </div>
      )}
      {recoveryCode && <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Código de recuperação do cofre</p><p className="mt-2 break-all font-mono text-sm font-semibold text-foreground">{recoveryCode}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Button variant="quiet" size="sm" onClick={() => { void navigator.clipboard.writeText(recoveryCode); }}>Copiar código</Button><span className="text-[10px] leading-4 text-muted-foreground">Guarde fora do sistema. Ele permite redefinir a senha sem perder as evoluções.</span></div></div>}
      {message && <p className="mt-3 text-[11px] text-muted-foreground">{message}</p>}
    </SettingsCard>
  );
}

function PatientModal({ patient, services, onClose, onSaved }: { patient: PatientRow | null; services: ServiceCatalogItem[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const sessionServices = services.filter((service) => service.active && service.kind === "session");
  const [name, setName] = useState(patient?.full_name ?? "");
  const [cpf, setCpf] = useState(formatCpf(patient?.cpf));
  const [phone, setPhone] = useState(patient?.phone ?? "");
  const [email, setEmail] = useState(patient?.email ?? "");
  const [active, setActive] = useState(patient?.active ?? true);
  const [billing, setBilling] = useState<"session"|"package">(patient?.billing_model ?? "session");
  const [sessionAmount, setSessionAmount] = useState(patient?.session_amount?.toString().replace(".", ",") ?? "");
  const [packageAmount, setPackageAmount] = useState(patient?.package_amount?.toString().replace(".", ",") ?? "");
  const [packagePaymentMode, setPackagePaymentMode] = useState<"single" | "installments">(patient?.package_payment_mode ?? "single");
  const [packageInstallments, setPackageInstallments] = useState(patient?.package_installments ?? 2);
  const [packageFirstDueDate, setPackageFirstDueDate] = useState(patient?.package_first_due_date ?? isoDateLocal());
  const packagePlanRequestId = useRef(crypto.randomUUID()).current;
  const [notes, setNotes] = useState(patient?.notes_admin ?? "");
  const [scheduleNow, setScheduleNow] = useState(false);
  const [sessionServiceId, setSessionServiceId] = useState(sessionServices[0]?.id ?? "");
  const [sessionModality, setSessionModality] = useState<"presential"|"online">("presential");
  const [sessionDuration, setSessionDuration] = useState(50);
  const [futureSlots, setFutureSlots] = useState<Array<{ id: string; when: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const nextSuggestedSlot = () => {
    const lastWhen = futureSlots.at(-1)?.when;
    const base = lastWhen ? new Date(lastWhen) : new Date();
    const next = new Date(base);
    next.setDate(next.getDate() + 7);
    next.setHours(9, 0, 0, 0);
    return `${isoDateLocal(next)}T09:00`;
  };
  const addFutureSlot = () => setFutureSlots((current) => [...current, { id: crypto.randomUUID(), when: nextSuggestedSlot() }]);
  const toggleSchedule = (checked: boolean) => {
    setScheduleNow(checked);
    if (checked && futureSlots.length === 0) setFutureSlots([{ id: crypto.randomUUID(), when: nextSuggestedSlot() }]);
  };

  const parsedPackageAmountPreview = Number(packageAmount.replace(",", ".")) || 0;
  const effectiveInstallmentCount = packagePaymentMode === "single" ? 1 : Math.max(1, Math.min(60, Math.trunc(packageInstallments || 1)));
  const installmentPreview = packageInstallmentPreview(parsedPackageAmountPreview, effectiveInstallmentCount, packageFirstDueDate);

  const save = async () => {
    if (!name.trim()) return;
    const parsedSessionAmount = Number(sessionAmount.replace(",", ".")) || 0;
    const parsedPackageAmount = Number(packageAmount.replace(",", ".")) || 0;
    if (billing === "session" && parsedSessionAmount <= 0) { setError("Informe o valor padrão da sessão."); return; }
    if (billing === "package" && parsedPackageAmount <= 0) { setError("Informe o valor total do pacote/plano."); return; }
    if (billing === "package" && !packageFirstDueDate) { setError("Informe a data do primeiro pagamento."); return; }
    if (billing === "package" && packagePaymentMode === "installments" && (packageInstallments < 1 || packageInstallments > 60)) { setError("Informe entre 1 e 60 parcelas."); return; }
    setSaving(true); setError("");
    try {
      // Dados cadastrais e regra financeira são persistidos em etapas separadas. A configuração
      // do pacote fica concentrada na RPC transacional; assim uma falha ao gerar parcelas não
      // deixa package_amount/modelo atualizados sem as respectivas cobranças em A receber.
      const basePatch = {
        full_name:name.trim(), cpf:cpf||null, phone:phone.trim()||null, email:email.trim()||null, active,
        notes_admin:notes.trim()||null,
      };
      const savedPatient = patient
        ? await updatePatient(patient.id, basePatch)
        : await createPatient({ ...basePatch, billing_model:"session", session_amount:billing === "session" ? parsedSessionAmount : null } as Partial<PatientRow> & Pick<PatientRow,"full_name">, requestId);

      if (billing === "package") {
        await savePatientPackagePlan({
          patient_id: savedPatient.id,
          total_amount: parsedPackageAmount,
          payment_mode: packagePaymentMode,
          installment_count: effectiveInstallmentCount,
          first_due_date: packageFirstDueDate,
          client_request_id: packagePlanRequestId,
        });
      } else {
        if (patient?.billing_model === "package" || patient?.package_plan_id) await cancelPatientPackagePlan(savedPatient.id);
        await updatePatient(savedPatient.id, {
          billing_model:"session", session_amount:parsedSessionAmount, package_amount:null, package_timing:null, billing_day:null,
        });
      }
      if (scheduleNow) {
        const service = sessionServices.find((item) => item.id === sessionServiceId);
        if (!service) throw new Error("Cadastre um serviço de sessão antes de agendar.");
        const validSlots = futureSlots.filter((slot) => slot.when);
        for (const slot of validSlots) {
          const parsed = new Date(slot.when);
          if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) throw new Error("As próximas sessões precisam ter datas futuras válidas.");
          await createAppointment({
            patient_id:savedPatient.id,
            patient_name:savedPatient.full_name,
            scheduled_at:parsed.toISOString(),
            duration_minutes:sessionDuration,
            modality:sessionModality,
            status:"scheduled",
            service_kind:"session",
            service_name:service.name,
            amount:billing === "package" ? 0 : parsedSessionAmount,
            notes_admin:billing === "package" ? "Sessão incluída no pacote" : "Sessão futura agendada no cadastro do paciente",
          }, slot.id);
        }
      }
      await onSaved();
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o paciente. Confira os dados e tente novamente.");
    }
    finally { setSaving(false); }
  };

  return <ModalShell onClose={onClose} width="max-w-3xl">
    <ModalHeader title={patient ? "Editar paciente" : "Novo paciente"} subtitle="Dados administrativos, cobrança e próximas sessões." onClose={onClose} />
    <div className="grid gap-4 p-5 sm:grid-cols-2">
      <FieldEdit label="Nome completo" value={name} onChange={setName} />
      <FieldEdit label="CPF" value={cpf} onChange={(value) => setCpf(formatCpf(value))} />
      <FieldEdit label="WhatsApp" value={phone} onChange={setPhone} />
      <FieldEdit label="E-mail" value={email} onChange={setEmail} />
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Status</span><select value={active ? "active":"paused"} onChange={(e)=>setActive(e.target.value === "active")} className="input-finance"><option value="active">Ativo</option><option value="paused">Pausado</option></select></label>
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Cobrança</span><select value={billing} onChange={(e)=>setBilling(e.target.value as "session"|"package")} className="input-finance"><option value="session">Por sessão</option><option value="package">Pacote mensal</option></select></label>
      {billing === "session" && <FieldEdit label="Valor padrão da sessão" value={sessionAmount} onChange={setSessionAmount} />}
      {billing === "package" && <>
        <FieldEdit label="Valor total do pacote / plano" value={packageAmount} onChange={setPackageAmount} />
        <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Forma de pagamento</span><select value={packagePaymentMode} onChange={(e)=>setPackagePaymentMode(e.target.value as "single" | "installments")} className="input-finance"><option value="single">À vista</option><option value="installments">Parcelado</option></select></label>
        {packagePaymentMode === "installments" && <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Número de parcelas</span><input type="number" min={1} max={60} value={packageInstallments} onChange={(e)=>setPackageInstallments(Number(e.target.value))} className="input-finance" /></label>}
        <label><span className="mb-1.5 block text-[10px] text-muted-foreground">{packagePaymentMode === "single" ? "Data prevista de pagamento" : "Vencimento da 1ª parcela"}</span><input type="date" value={packageFirstDueDate} onChange={(e)=>setPackageFirstDueDate(e.target.value)} className="input-finance" /></label>
        <div className="sm:col-span-2 rounded-2xl border border-border bg-background/45 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Cobranças que irão para A receber</p>
          {installmentPreview.length > 0 ? <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">{installmentPreview.map((installment)=><div key={installment.number} className="flex items-center justify-between gap-3 rounded-xl bg-card/70 px-3 py-2 text-xs"><span>{packagePaymentMode === "single" ? "Pagamento único" : `Parcela ${installment.number}/${installmentPreview.length}`} • {dateLabel(installment.dueDate)}</span><strong>{money(installment.amount)}</strong></div>)}</div> : <p className="mt-2 text-[10px] text-muted-foreground">Informe o valor e a data de pagamento para visualizar as cobranças.</p>}
          <p className="mt-3 text-[10px] leading-4 text-muted-foreground">Ao salvar, cada parcela será criada automaticamente como cobrança pendente em A receber e ficará vinculada a este paciente e ao pacote/plano.</p>
        </div>
      </>}

      <div className="sm:col-span-2 rounded-2xl border border-border bg-background/45 p-4">
        <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={scheduleNow} onChange={(e)=>toggleSchedule(e.target.checked)} /> Agendar próximas sessões agora</label>
        {scheduleNow && <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Serviço</span><select value={sessionServiceId} onChange={(e)=>setSessionServiceId(e.target.value)} className="input-finance" disabled={sessionServices.length===0}>{sessionServices.length===0?<option value="">Sem serviço de sessão</option>:sessionServices.map((service)=><option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Modalidade</span><select value={sessionModality} onChange={(e)=>setSessionModality(e.target.value as "presential"|"online")} className="input-finance"><option value="presential">Presencial</option><option value="online">On-line</option></select></label>
            <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Duração</span><input type="number" min={10} max={240} value={sessionDuration} onChange={(e)=>setSessionDuration(Number(e.target.value))} className="input-finance" /></label>
          </div>
          <div className="space-y-2">{futureSlots.map((slot,index)=><div key={slot.id} className="flex items-center gap-2"><span className="w-20 text-[10px] text-muted-foreground">Sessão {index+1}</span><input type="datetime-local" value={slot.when} onChange={(e)=>setFutureSlots((current)=>current.map((item)=>item.id===slot.id?{...item,when:e.target.value}:item))} className="input-finance flex-1" /><Button type="button" variant="ghost" size="icon" onClick={()=>setFutureSlots((current)=>current.filter((item)=>item.id!==slot.id))}><Trash2 /></Button></div>)}</div>
          <Button type="button" variant="quiet" size="sm" onClick={addFutureSlot}><Plus /> Adicionar sessão</Button>
          <p className="text-[10px] text-muted-foreground">{billing === "package" ? "As sessões serão incluídas no pacote, sem cobrança individual." : `Cada sessão futura será criada com o valor padrão de ${sessionAmount || "0,00"} e ficará A receber até o pagamento.`}</p>
        </div>}
      </div>

      <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] text-muted-foreground">Observações administrativas</span><textarea maxLength={4000} value={notes} onChange={(e)=>setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>
      {error&&<p className="text-xs text-destructive sm:col-span-2">{error}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" disabled={saving || !name.trim() || (billing === "session" ? !sessionAmount : !packageAmount)} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar"}</Button></div>
    </div>
  </ModalShell>;
}

function AppointmentModal({ patients, services, appointment, defaultDate, onClose, onSaved }: { patients: PatientRow[]; services: ServiceCatalogItem[]; appointment: AppointmentRow | null; defaultDate: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const initialDateTime = appointment ? new Date(appointment.scheduled_at) : new Date(`${defaultDate}T09:00:00`);
  const localValue = `${isoDateLocal(initialDateTime)}T${String(initialDateTime.getHours()).padStart(2,"0")}:${String(initialDateTime.getMinutes()).padStart(2,"0")}`;
  const activeServices = services.filter((item) => item.active);
  const matchingCurrent = appointment ? services.find((item) => item.kind === appointment.service_kind && item.name === appointmentServiceLabel(appointment)) : undefined;
  const legacyCurrent: ServiceCatalogItem | null = appointment && !matchingCurrent ? { id: "__current__", name: appointmentServiceLabel(appointment), kind: appointment.service_kind, active: true } : null;
  const serviceOptions = legacyCurrent ? [legacyCurrent, ...activeServices] : activeServices;
  const initialServiceId = matchingCurrent?.id ?? legacyCurrent?.id ?? activeServices[0]?.id ?? "";

  const [patientId, setPatientId] = useState(appointment?.patient_id ?? "");
  const [name, setName] = useState(appointment?.patient_name ?? "");
  const [when, setWhen] = useState(localValue);
  const [duration, setDuration] = useState(appointment?.duration_minutes ?? 50);
  const [modality, setModality] = useState<"presential"|"online">(appointment?.modality ?? "presential");
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? "scheduled");
  const [serviceId, setServiceId] = useState(initialServiceId);
  const [amount, setAmount] = useState(String(appointment?.amount ?? ""));
  const [paymentReceived, setPaymentReceived] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [currentPayment, setCurrentPayment] = useState<AppointmentPaymentRow | null>(null);
  const [notes, setNotes] = useState(appointment?.notes_admin ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedService = serviceOptions.find((item) => item.id === serviceId) ?? null;
  const selectedPatient = patients.find((item) => item.id === patientId) ?? null;
  const isPackageSession = Boolean(selectedPatient?.billing_model === "package" && selectedService?.kind === "session");
  const numericAmount = isPackageSession ? 0 : Number(amount.replace(",",".")) || 0;
  const canCharge = !isPackageSession && numericAmount > 0 && ["scheduled", "confirmed", "completed"].includes(status);
  const paymentLocked = currentPayment?.status === "paid";

  useEffect(() => {
    let active = true;
    if (!appointment) { setCurrentPayment(null); setPaymentReceived(false); return; }
    void getAppointmentPayment(appointment.id).then((payment) => {
      if (!active) return;
      setCurrentPayment(payment);
      setPaymentReceived(payment?.status === "paid");
      if (payment?.payment_method) setPaymentMethod(payment.payment_method);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [appointment]);

  const applyPatientSessionAmount = (patient: PatientRow | undefined, service: ServiceCatalogItem | null) => {
    if (!patient || service?.kind !== "session") return;
    if (patient.billing_model === "package") { setAmount(""); return; }
    if (patient.session_amount != null && patient.session_amount > 0) setAmount(String(patient.session_amount).replace(".", ","));
  };
  const selectPatient = (id: string) => {
    setPatientId(id);
    const selected = patients.find((item)=>item.id===id);
    if (selected) { setName(selected.full_name); applyPatientSessionAmount(selected, selectedService); }
  };
  const selectService = (id: string) => {
    setServiceId(id);
    const service = serviceOptions.find((item) => item.id === id) ?? null;
    const patient = patients.find((item) => item.id === patientId);
    applyPatientSessionAmount(patient, service);
  };

  const save = async () => {
    // Validação local deve dizer qual campo impede o cadastro antes de chamar o Supabase.
    if (!name.trim()) { setError("Informe o paciente / cliente."); return; }
    if (!when) { setError("Informe a data e o horário do atendimento."); return; }
    if (!selectedService) { setError("Selecione um serviço antes de salvar o atendimento."); return; }
    if (!Number.isInteger(duration) || duration < 10 || duration > 240) {
      setError("A duração do atendimento deve ficar entre 10 e 240 minutos.");
      return;
    }
    if (!isPackageSession && amount.trim()) {
      const typedAmount = Number(amount.replace(",", "."));
      if (!Number.isFinite(typedAmount) || typedAmount < 0 || typedAmount > 1_000_000) {
        setError("Informe um valor válido entre R$ 0,00 e R$ 1.000.000,00.");
        return;
      }
    }

    const parsed = new Date(when);
    if (Number.isNaN(parsed.getTime())) { setError("A data e o horário informados são inválidos."); return; }

    // Ao cancelar uma sessão de paciente com pacote, o sistema pergunta explicitamente se
    // o pacote financeiro também deve ser cancelado. Isso evita tanto deixar parcelas de
    // uma simulação em aberto quanto apagar cobranças legítimas ao cancelar só uma sessão.
    let cancelPackageWithAppointment = false;
    if (appointment && status === "cancelled" && appointment.status !== "cancelled" && selectedPatient?.package_plan_id) {
      cancelPackageWithAppointment = window.confirm(
        "Este paciente possui um pacote/plano ativo. Deseja cancelar também o pacote e as parcelas ainda não pagas?\n\nOK = cancelar pacote e parcelas pendentes.\nCancelar = cancelar somente este atendimento.",
      );
    }

    setSaving(true); setError("");
    let stage: "appointment" | "payment" | "refresh" = "appointment";
    try {
      const payload = { patient_id:patientId||null, patient_name:name.trim(), scheduled_at:parsed.toISOString(), duration_minutes:duration, modality, status, service_kind:selectedService.kind, service_name:selectedService.name, amount:numericAmount, notes_admin:notes.trim()||null };
      const saved = appointment ? await updateAppointment(appointment.id, payload) : await createAppointment(payload as Omit<AppointmentRow, "id" | "created_at">, requestId);
      if (appointment && status === "cancelled" && appointment.status !== "cancelled") {
        await deleteAppointment(saved.id, cancelPackageWithAppointment);
      }
      stage = "payment";
      if (paymentReceived && canCharge && currentPayment?.status !== "paid") await markAppointmentPaid(saved.id, paymentMethod);
      stage = "refresh";
      await onSaved();
    } catch (saveError) {
      console.error("Falha ao salvar atendimento", { stage, error: saveError });
      if (stage === "appointment") {
        setError(appointmentSaveErrorMessage(saveError));
      } else if (stage === "payment") {
        setError(`O atendimento foi salvo, mas o recebimento não pôde ser registrado. ${appointmentSaveErrorMessage(saveError)}`);
      } else {
        setError("O atendimento foi salvo, mas a tela não conseguiu atualizar os dados. Feche esta janela e atualize a página.");
      }
    }
    finally { setSaving(false); }
  };

  return <ModalShell onClose={onClose} width="max-w-2xl">
    <ModalHeader title={appointment ? "Editar atendimento" : "Novo atendimento"} subtitle="Agenda, sessão e pagamento ficam vinculados no mesmo atendimento." onClose={onClose} />
    <div className="grid gap-4 p-5 sm:grid-cols-2">
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Paciente cadastrado</span><select value={patientId} onChange={(e)=>selectPatient(e.target.value)} className="input-finance"><option value="">Outro / não cadastrado</option>{patients.map((p)=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
      <FieldEdit label="Paciente / cliente" value={name} onChange={setName} />
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Data e hora</span><input type="datetime-local" value={when} onChange={(e)=>setWhen(e.target.value)} className="input-finance" /></label>
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Duração (min)</span><input type="number" min={10} max={240} value={duration} onChange={(e)=>setDuration(Number(e.target.value))} className="input-finance" /></label>
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Modalidade</span><select value={modality} onChange={(e)=>setModality(e.target.value as "presential"|"online")} className="input-finance"><option value="presential">Presencial</option><option value="online">On-line</option></select></label>
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Status do atendimento</span><select value={status} onChange={(e)=>setStatus(e.target.value as AppointmentStatus)} className="input-finance"><option value="scheduled">Agendada</option><option value="confirmed">Confirmada</option><option value="completed">Concluída</option><option value="no_show">Falta</option><option value="cancelled">Cancelada</option></select></label>
      <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Serviço</span><select value={serviceId} onChange={(e)=>selectService(e.target.value)} className="input-finance" disabled={serviceOptions.length === 0}>{serviceOptions.length === 0 ? <option value="">Cadastre um serviço nas Configurações</option> : serviceOptions.map((service)=><option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
      {isPackageSession ? <label><span className="mb-1.5 block text-[10px] text-muted-foreground">Valor</span><input value="Incluído no pacote" disabled className="input-finance opacity-70" /></label> : <FieldEdit label="Valor" value={amount} onChange={setAmount} />}

      <div className="rounded-2xl border border-border bg-accent/30 p-4 sm:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold">Pagamento desta sessão</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Defina se este atendimento ainda está a receber ou se o valor já foi recebido.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${isPackageSession || !canCharge ? "bg-muted text-muted-foreground" : paymentReceived || paymentLocked ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary"}`}>
            {isPackageSession ? "Incluído no pacote" : !canCharge ? "Sem cobrança" : paymentReceived || paymentLocked ? "Recebido" : currentPayment?.status === "partial" ? "Parcial" : "A receber"}
          </span>
        </div>
        <label className="mt-3 block"><span className="mb-1.5 block text-[10px] text-muted-foreground">Status do pagamento</span>
          <select className="input-finance" value={isPackageSession ? "package" : !canCharge ? "none" : paymentLocked ? "paid" : paymentReceived ? "paid" : currentPayment?.status === "partial" ? "partial" : "pending"} disabled={isPackageSession || !canCharge || paymentLocked} onChange={(e)=>setPaymentReceived(e.target.value === "paid")}>
            {isPackageSession ? <option value="package">Incluído no pacote</option> : !canCharge ? <option value="none">Sem cobrança</option> : <><option value="pending">A receber</option>{currentPayment?.status === "partial" && <option value="partial">Parcial</option>}<option value="paid">Recebido</option></>}
          </select>
        </label>
        {paymentReceived && canCharge && !paymentLocked && <label className="mt-3 block"><span className="mb-1.5 block text-[10px] text-muted-foreground">Forma de pagamento</span><select className="input-finance" value={paymentMethod} onChange={(e)=>setPaymentMethod(e.target.value as PaymentMethod)}>{Object.entries(paymentMethodLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>}
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{isPackageSession ? "Esta sessão está coberta pelo pacote do paciente e não gera cobrança individual." : paymentLocked ? "Pagamento já registrado no Financeiro." : paymentReceived ? "Ao salvar, o valor será registrado como recebido no Financeiro." : currentPayment?.status === "partial" ? `Pagamento parcial registrado. Falta receber ${money(Math.max(0, Number(currentPayment.amount) - Number(currentPayment.received_amount || 0)))}.` : canCharge ? `O valor de ${money(numericAmount)} ficará na carteira a receber até a baixa.` : "Informe um valor e mantenha o atendimento ativo para gerar a cobrança."}</p>
      </div>

      <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] text-muted-foreground">Observações administrativas</span><textarea maxLength={4000} value={notes} onChange={(e)=>setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>
      {error&&<p className="text-xs text-destructive sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2 sm:col-span-2">{appointment ? <Button variant="ghost" className="text-destructive" onClick={async()=>{
        if (!confirm("Cancelar este atendimento? O histórico será preservado.")) return;
        const cancelPackage = Boolean(selectedPatient?.package_plan_id) && confirm(
          "Este paciente possui um pacote/plano ativo. Deseja cancelar também o pacote e as parcelas ainda não pagas?\n\nOK = cancelar pacote e parcelas pendentes.\nCancelar = manter o pacote e cancelar somente o atendimento.",
        );
        setError("");
        try { await deleteAppointment(appointment.id, cancelPackage); await onSaved(); }
        catch { setError("Não foi possível cancelar o atendimento e atualizar o financeiro."); }
      }}><Trash2 /> Cancelar atendimento</Button>:<span/>}<div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" disabled={saving || !name.trim() || !when || !selectedService} onClick={() => void save()}>{saving?"Salvando...":"Salvar"}</Button></div></div>
    </div>
  </ModalShell>;
}

function MaterialModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!file || !title.trim()) return;
    setSaving(true);
    setError("");
    try {
      await uploadMaterial(file, title.trim(), category.trim(), notes.trim(), requestId);
      await onSaved();
    } catch {
      setError("Não foi possível enviar o arquivo. Use PDF, PNG, JPG ou WEBP com no máximo 10 MB.");
    } finally {
      setSaving(false);
    }
  };

  return <ModalShell onClose={onClose}><ModalHeader title="Adicionar material" subtitle="Arquivo privado, com tipo e tamanho validados antes do envio." onClose={onClose} /><div className="space-y-4 p-5"><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" onChange={(e)=>{const f=e.target.files?.[0]??null;setFile(f);setError("");if(f&&!title)setTitle(f.name.replace(/\.[^.]+$/, "").slice(0,180));}} className="w-full rounded-xl border border-border bg-background p-3 text-xs" /><p className="text-[10px] text-muted-foreground">Permitidos: PDF, PNG, JPG/JPEG e WEBP • máximo 10 MB.</p><FieldEdit label="Título" value={title} onChange={(value)=>setTitle(value.slice(0,180))} /><FieldEdit label="Categoria" value={category} onChange={(value)=>setCategory(value.slice(0,100))} /><FieldEdit label="Observação" value={notes} onChange={(value)=>setNotes(value.slice(0,2000))} />{error&&<p className="text-xs text-destructive">{error}</p>}<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" disabled={!file || !title.trim() || saving} onClick={()=>void save()}>{saving?"Enviando...":"Enviar arquivo"}</Button></div></div></ModalShell>;
}

function TwoFactorModal({ patient, settings, vaultKey, onVaultKey, onSettings, onRecover, onClose, onVerified }: { patient: PatientView; settings: AppSettingsRow | null; vaultKey: CryptoKey | null; onVaultKey: (k: CryptoKey) => void; onSettings: (s: AppSettingsRow) => void; onRecover: () => void; onClose: () => void; onVerified: () => void }) {
  const [phase, setPhase] = useState<"checking"|"totp"|"vault"|"recovery"|"blocked">("checking");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [granted, setGranted] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  const legacyConfigured = Boolean(settings?.vault_salt && settings?.vault_verifier_ciphertext && settings?.vault_verifier_iv);
  const recoverableConfigured = Boolean(
    settings?.vault_version === 3
    && settings.vault_password_salt
    && settings.vault_password_key_ciphertext
    && settings.vault_password_key_iv,
  );

  useEffect(()=>{(async()=>{
    if(!supabase){setPhase("blocked");setError("Serviço de dados indisponível.");return;}
    const {data,error}=await supabase.auth.mfa.listFactors();
    if(error){setPhase("blocked");setError("Não foi possível verificar o autenticador.");return;}
    const factor=data.totp.find((x)=>x.status==="verified");
    if(!factor){setPhase("blocked");setError("Configure o Google Authenticator em Configurações antes de abrir prontuários.");return;}
    if(!legacyConfigured&&!recoverableConfigured){setPhase("blocked");setError("Crie o cofre clínico em Configurações antes de abrir prontuários.");return;}
    setFactorId(factor.id);setPhase("totp");
  })();},[legacyConfigured,recoverableConfigured]);

  const closeSecure=()=>{
    if(granted) void revokeClinicalAccess(patient.id).catch(()=>undefined);
    onClose();
  };

  const goToRecovery=()=>{
    if(granted) void revokeClinicalAccess(patient.id).catch(()=>undefined);
    onRecover();
  };

  const verifyTotp=async()=>{
    if(!supabase||!factorId||!/^[0-9]{6}$/.test(code)){setError("Informe o código de 6 dígitos.");return;}
    setError("");
    const {error:ve}=await supabase.auth.mfa.challengeAndVerify({factorId,code});
    setCode("");
    if(ve){setError("Código inválido ou expirado.");return;}
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) { setError("Não foi possível atualizar a sessão segura. Tente novamente."); return; }
    try {
      await grantClinicalAccess(patient.id);
      setGranted(true);
    } catch {
      setError("Não foi possível liberar o prontuário. Aguarde o próximo código do autenticador e tente novamente.");
      return;
    }
    if(vaultKey){onVerified();return;}
    setPhase("vault");
  };

  const unlock=async()=>{
    if(!settings)return;
    const currentPass=pass;
    setError("");
    let key: CryptoKey | null = null;
    if(recoverableConfigured && settings.vault_password_salt && settings.vault_password_key_ciphertext && settings.vault_password_key_iv){
      key=await unlockRecoverableVault(currentPass,{salt:settings.vault_password_salt,ciphertext:settings.vault_password_key_ciphertext,iv:settings.vault_password_key_iv});
    } else if(legacyConfigured && settings.vault_salt && settings.vault_verifier_ciphertext && settings.vault_verifier_iv){
      key=await unlockLegacyVault(currentPass,settings.vault_salt,settings.vault_verifier_ciphertext,settings.vault_verifier_iv);
    }
    setPass("");
    if(!key){setError("Senha do cofre incorreta.");return;}
    onVaultKey(key);

    if(!recoverableConfigured && legacyConfigured){
      try{
        // Migra o cofre antigo no primeiro desbloqueio bem-sucedido, sem alterar a chave
        // que já cifra as evoluções. O código exibido abaixo é a única via de recuperação.
        const upgraded=await createRecoverableEnvelopeForExistingKey(currentPass,key);
        const saved=await saveAppSettings({
          vault_version:3,
          vault_salt:null,
          vault_verifier_ciphertext:null,
          vault_verifier_iv:null,
          vault_password_salt:upgraded.password.salt,
          vault_password_key_ciphertext:upgraded.password.ciphertext,
          vault_password_key_iv:upgraded.password.iv,
          vault_recovery_salt:upgraded.recovery.salt,
          vault_recovery_key_ciphertext:upgraded.recovery.ciphertext,
          vault_recovery_key_iv:upgraded.recovery.iv,
        });
        onSettings(saved);
        setRecoveryCode(upgraded.recoveryCode);
        setPhase("recovery");
        return;
      }catch{
        // Falha na migração não impede o acesso ao prontuário legado.
      }
    }
    onVerified();
  };

  return <ModalShell onClose={closeSecure}><div className="p-6"><div className="flex items-start justify-between"><span className="grid size-12 place-items-center rounded-2xl bg-accent"><LockKeyhole className="size-5" /></span><Button variant="ghost" size="icon" onClick={closeSecure}><X /></Button></div><h2 className="mt-5 font-display text-xl">Prontuário — {patient.full_name}</h2>{phase==="checking"&&<p className="mt-3 text-sm text-muted-foreground">Verificando proteção...</p>}{phase==="blocked"&&<div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">{error}</div>}{phase==="totp"&&<><p className="mt-2 text-sm text-muted-foreground">Digite o código atual do Google Authenticator. Cada abertura exige uma nova verificação.</p><input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e)=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} onKeyDown={(e)=>{if(e.key==="Enter")void verifyTotp();}} className="mt-5 h-12 w-full rounded-xl border border-border bg-background px-4 text-center font-mono text-xl tracking-[0.45em]" placeholder="000000" /><Button variant="dashboard" className="mt-4 w-full" disabled={code.length!==6} onClick={()=>void verifyTotp()}>Verificar código</Button></>}{phase==="vault"&&<><p className="mt-2 text-sm text-muted-foreground">Desbloqueie o cofre clínico. A senha permanece somente na memória desta aba e não é enviada ao servidor.</p><input autoFocus type="password" value={pass} onChange={(e)=>setPass(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")void unlock();}} className="mt-5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Senha do cofre" autoComplete="off" /><Button variant="dashboard" className="mt-4 w-full" disabled={!pass} onClick={()=>void unlock()}>Desbloquear cofre</Button><Button variant="ghost" className="mt-2 w-full" onClick={goToRecovery}>Esqueci a senha do cofre</Button></>}{phase==="recovery"&&<><p className="mt-2 text-sm text-muted-foreground">O cofre foi atualizado para permitir redefinição de senha. Guarde este código fora do sistema antes de continuar.</p><div className="mt-4 rounded-xl border border-border bg-muted/40 p-4"><p className="break-all font-mono text-sm font-semibold">{recoveryCode}</p><Button variant="quiet" size="sm" className="mt-3" onClick={()=>{void navigator.clipboard.writeText(recoveryCode);}}>Copiar código</Button></div><Button variant="dashboard" className="mt-4 w-full" onClick={onVerified}>Já guardei, abrir prontuário</Button></>}{error&&phase!=="blocked"&&<p className="mt-3 text-xs text-destructive">{error}</p>}</div></ModalShell>;
}

function PatientRecordModal({ patient, vaultKey, onClose }: { patient: PatientView; vaultKey: CryptoKey; onClose: () => void }) {
  const noteRequestId = useRef(crypto.randomUUID());
  const [entries, setEntries] = useState<DecryptedEvolution[]>([]);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("Evolução");
  const [date, setDate] = useState(isoDateLocal());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async()=>{
    try {
      setError("");
      const rows=await listClinicalNotes(patient.id);
      const decoded:DecryptedEvolution[]=[];
      for(const row of rows){
        try {
          const plaintext=await decryptText(vaultKey,row.content_ciphertext,row.content_iv,clinicalAad(patient.id));
          const payload=JSON.parse(plaintext) as {v?:number;title?:unknown;text?:unknown};
          decoded.push({...row,title:typeof payload.title==="string"?payload.title.slice(0,120):"Evolução",text:typeof payload.text==="string"?payload.text:""});
        } catch {
          decoded.push({...row,title:"Evolução",text:"[Não foi possível descriptografar este registro com a chave atual.]"});
        }
      }
      setEntries(decoded);
    } catch {
      setError("O acesso clínico expirou ou não foi possível carregar as evoluções. Feche e abra o prontuário novamente.");
    }
  },[patient.id,vaultKey]);

  useEffect(()=>{void reload();},[reload]);
  useEffect(()=>()=>{void revokeClinicalAccess(patient.id).catch(()=>undefined);},[patient.id]);

  const add=async()=>{
    const cleanNote=note.trim();
    const cleanTitle=(title.trim()||"Evolução").slice(0,120);
    if(!cleanNote)return;
    setSaving(true);setError("");
    try {
      const payload=JSON.stringify({v:2,title:cleanTitle,text:cleanNote.slice(0,100000)});
      const enc=await encryptText(vaultKey,payload,clinicalAad(patient.id));
      await createClinicalNote({patient_id:patient.id,appointment_id:null,note_date:date,title:"Evolução",content_ciphertext:enc.ciphertext,content_iv:enc.iv}, noteRequestId.current);
      noteRequestId.current=crypto.randomUUID();
      setNote("");setTitle("Evolução");
      await reload();
    } catch {
      setError("Não foi possível salvar. Se o acesso tiver expirado, feche e abra o prontuário novamente.");
    } finally {
      setSaving(false);
    }
  };

  return <ModalShell onClose={onClose} width="max-w-3xl"><ModalHeader title={`Prontuário — ${patient.full_name}`} subtitle="Acesso TOTP verificado • título e conteúdo clínico criptografados no navegador" onClose={onClose} /><div className="p-5"><div className="grid gap-3 sm:grid-cols-3"><MiniFeature icon={<CalendarDays />} title="Última sessão" text={patient.lastSession} /><MiniFeature icon={<CalendarDays />} title="Próxima sessão" text={patient.nextSession} /><MiniFeature icon={<ShieldCheck />} title="Segurança" text="AES-256-GCM + TOTP" /></div><div className="mt-6"><h3 className="font-display text-lg">Registrar evolução</h3><div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]"><input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-xs" /><input value={title} maxLength={120} onChange={(e)=>setTitle(e.target.value)} className="h-10 rounded-xl border border-border bg-background px-3 text-sm" placeholder="Título" /></div><textarea value={note} maxLength={100000} onChange={(e)=>setNote(e.target.value)} className="mt-3 min-h-32 w-full rounded-2xl border border-border bg-background/60 p-3 text-sm" placeholder="Registre os pontos relevantes da sessão..." /><div className="mt-2 flex justify-end"><Button variant="dashboard" size="sm" disabled={!note.trim()||saving} onClick={()=>void add()}><Plus /> {saving?"Criptografando...":"Salvar evolução"}</Button></div></div><div className="mt-7"><h3 className="font-display text-lg">Histórico de evolução</h3>{error&&<p className="mt-3 text-xs text-destructive">{error}</p>}<div className="mt-4 space-y-3">{entries.map((entry)=><article key={entry.id} className="rounded-2xl border border-border bg-background/45 p-4"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold">{entry.title}</p><span className="text-[10px] text-muted-foreground">{dateLabel(entry.note_date)}</span></div><Button variant="ghost" size="icon" title="Arquivar evolução" onClick={async()=>{if(confirm("Arquivar esta evolução? O registro não será apagado fisicamente.")){try{await deleteClinicalNote(entry.id);await reload();}catch{setError("Não foi possível arquivar a evolução.");}}}}><Trash2 /></Button></div><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{entry.text}</p></article>)}{entries.length===0&&<Empty text="Nenhuma evolução registrada." />}</div></div></div></ModalShell>;
}

function WeeklyAppointmentsChart({ appointments }: { appointments: AppointmentRow[] }) {
  const completed = appointments.filter((x)=>x.status==="completed"); const counts = [0,1,2,3,4,5,6].map((i)=>({label:["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"][i],office:completed.filter((x)=>new Date(x.scheduled_at).getDay()===i&&x.modality==="presential").length,online:completed.filter((x)=>new Date(x.scheduled_at).getDay()===i&&x.modality==="online").length})); const max=Math.max(1,...counts.flatMap((x)=>[x.office,x.online]));
  return <div className="mt-6 flex h-48 items-end gap-3 border-b border-border px-2 sm:gap-6">{counts.map((x)=><div key={x.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="flex h-[145px] items-end gap-1.5"><div className="w-3 rounded-t bg-primary sm:w-5" style={{height:`${(x.office/max)*100}%`}} title={`${x.office} presenciais`} /><div className="w-3 rounded-t bg-secondary sm:w-5" style={{height:`${(x.online/max)*100}%`}} title={`${x.online} on-line`} /></div><span className="pb-2 text-[10px] text-muted-foreground">{x.label}</span></div>)}</div>;
}

function FinanceHistoryChart({ rows }: { rows: Array<{month:string;billed:number;expenses:number}> }) {
  const max=Math.max(1,...rows.flatMap((x)=>[x.billed,x.expenses])); return <div className="mt-6 flex h-52 items-end gap-3 border-b border-border px-2 sm:gap-5">{rows.map((x)=><div key={x.month} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="flex h-[165px] items-end gap-1"><div className="w-3 rounded-t bg-primary sm:w-5" style={{height:`${(x.billed/max)*100}%`}} title={`Faturado ${money(x.billed)}`} /><div className="w-3 rounded-t bg-secondary sm:w-5" style={{height:`${(x.expenses/max)*100}%`}} title={`Despesas ${money(x.expenses)}`} /></div><span className="pb-2 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("pt-BR",{month:"short"}).format(new Date(`${x.month}-15T12:00:00`)).replace(".","")}</span></div>)}</div>;
}

function ModalShell({ children, onClose, width="max-w-xl" }: { children:ReactNode; onClose:()=>void; width?:string }) { return <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/25 p-4 backdrop-blur-sm" onMouseDown={onClose}><div className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-3xl border border-border bg-card shadow-2xl`} onMouseDown={(e)=>e.stopPropagation()}>{children}</div></div>; }
function ModalHeader({title,subtitle,onClose}:{title:string;subtitle:string;onClose:()=>void}){return <div className="flex items-start justify-between border-b border-border p-5"><div><h2 className="font-display text-xl">{title}</h2><p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X /></Button></div>}
function FieldEdit({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){return <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">{label}</span><input value={value} onChange={(e)=>onChange(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background/60 px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" /></label>}
function SettingsCard({title,description,children}:{title:string;description:string;children:ReactNode}){return <section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">{title}</h2><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p><div className="mt-5">{children}</div></section>}
function MetricCard({label,value,note,icon}:{label:string;value:string;note:string;icon:ReactNode}){return <article className="dashboard-card rounded-2xl p-5"><div className="flex items-start justify-between gap-3"><p className="text-xs font-medium text-muted-foreground">{label}</p><span className="grid size-10 place-items-center rounded-full bg-accent text-primary">{icon}</span></div><p className="mt-3 font-display text-2xl">{value}</p><p className="mt-2 text-[11px] text-muted-foreground">{note}</p></article>}
function SummaryRow({label,value}:{label:string;value:string}){return <div className="flex items-center justify-between border-b border-border/70 pb-3 last:border-0"><span className="text-muted-foreground">{label}</span><strong>{value}</strong></div>}
function StatusBadge({status}:{status:string}){const positive=["Ativo","Confirmada","Concluída","Pago"].includes(status);const neutral=["Agendada","Pausado"].includes(status);return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${positive?"bg-primary/8 text-primary":neutral?"bg-muted text-muted-foreground":"bg-secondary/15 text-secondary"}`}>{status}</span>}
function MiniFeature({icon,title,text}:{icon:ReactNode;title:string;text:string}){return <div className="rounded-xl bg-background/55 p-3"><span className="text-secondary [&_svg]:size-4">{icon}</span><p className="mt-2 text-xs font-medium">{title}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{text}</p></div>}
function ReportInsight({title,value,detail,icon}:{title:string;value:string;detail:string;icon:ReactNode}){return <section className="dashboard-card rounded-2xl p-5"><div className="flex items-start justify-between"><p className="text-xs text-muted-foreground">{title}</p><span className="text-secondary [&_svg]:size-5">{icon}</span></div><p className="mt-4 font-display text-2xl">{value}</p><p className="mt-2 text-[11px] text-muted-foreground">{detail}</p></section>}
function Empty({text}:{text:string}){return <p className="py-8 text-center text-xs text-muted-foreground">{text}</p>}
