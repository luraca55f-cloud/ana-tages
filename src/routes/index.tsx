import { createFileRoute } from "@tanstack/react-router";
import {
  BadgeCheck,
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
import { FinanceDashboardMetrics, FinancePage as FinancePageV2 } from "../features/finance/FinancePage";
import { clinicalAad, createVaultVerifier, decryptText, encryptText, isStrongVaultPassphrase, unlockVault } from "../features/clinic/crypto";
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
  listAppointments,
  listClinicalNotes,
  listMaterials,
  listPatients,
  loadFinanceHistory,
  loadReports,
  openMaterial,
  revokeClinicalAccess,
  saveAppSettings,
  updateAppointment,
  updatePatient,
  uploadMaterial,
} from "../features/clinic/repository";
import type {
  AppSettingsRow,
  AppointmentRow,
  AppointmentStatus,
  ClinicalNoteRow,
  MaterialRow,
  PatientRow,
  ReportsBundle,
  ServiceKind,
} from "../features/clinic/types";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Consultório | Anna Karina Dias" },
      { name: "description", content: "Gestão segura de pacientes, agenda, sessões, financeiro, relatórios e materiais." },
      { name: "robots", content: "noindex,nofollow,noarchive,nosnippet" },
    ],
  }),
  component: SecureConsultorioApp,
});

function SecureConsultorioApp() {
  return <AuthGate><ConsultorioApp /></AuthGate>;
}

type ModuleKey = "Dashboard" | "Agenda" | "Pacientes" | "Sessões" | "Financeiro" | "Relatórios" | "Materiais" | "Configurações";

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

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const next = new Date(y, m, 1);
  const start = `${month}-01`;
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

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
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
  const [activeModule, setActiveModule] = useState<ModuleKey>("Dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [patientModal, setPatientModal] = useState<PatientRow | "new" | null>(null);
  const [recordPatient, setRecordPatient] = useState<PatientView | null>(null);
  const [verifiedPatient, setVerifiedPatient] = useState<PatientView | null>(null);
  const [settings, setSettings] = useState<AppSettingsRow | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [loadingCore, setLoadingCore] = useState(false);

  const refreshCore = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoadingCore(true);
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
          <div className="hidden text-xs text-muted-foreground sm:block">{loadingCore ? "Atualizando dados..." : "Dados sincronizados com o Supabase"}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="quiet" size="icon" className="rounded-full"><Bell /></Button>
            <Button variant="quiet" size="icon" className="rounded-full" onClick={() => void signOut()}><LogOut /></Button>
            <div className="hidden border-l border-border pl-3 sm:block"><p className="text-xs font-semibold">{settings?.professional_name || "Anna Karina Dias"}</p><p className="text-[10px] text-muted-foreground">{user?.email ?? ""}</p></div>
          </div>
        </header>

        <main className="mx-auto max-w-[1460px] p-4 sm:p-7">
          {activeModule === "Dashboard" && <DashboardPage patients={patientViews} appointments={appointments} openModule={openModule} openRecord={setRecordPatient} />}
          {activeModule === "Agenda" && <AgendaPage patients={patients} onChanged={refreshCore} />}
          {activeModule === "Pacientes" && <PatientsPage patients={patientViews} onNew={() => setPatientModal("new")} onEdit={(patient) => setPatientModal(patient)} onRecord={setRecordPatient} onChanged={refreshCore} />}
          {activeModule === "Sessões" && <SessionsPage patients={patients} onChanged={refreshCore} />}
          {activeModule === "Financeiro" && <FinancePageV2 />}
          {activeModule === "Relatórios" && <ReportsPage />}
          {activeModule === "Materiais" && <MaterialsPage />}
          {activeModule === "Configurações" && <SettingsPage settings={settings} vaultKey={vaultKey} onVaultKey={setVaultKey} onSettings={(value) => setSettings(value)} />}
        </main>
      </div>

      {patientModal && <PatientModal patient={patientModal === "new" ? null : patientModal} onClose={() => setPatientModal(null)} onSaved={async () => { setPatientModal(null); await refreshCore(); }} />}
      {recordPatient && <TwoFactorModal patient={recordPatient} settings={settings} vaultKey={vaultKey} onVaultKey={setVaultKey} onClose={() => setRecordPatient(null)} onVerified={() => { setVerifiedPatient(recordPatient); setRecordPatient(null); }} />}
      {verifiedPatient && vaultKey && <PatientRecordModal patient={verifiedPatient} vaultKey={vaultKey} onClose={() => setVerifiedPatient(null)} />}
    </div>
  );
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <section className="animate-rise flex flex-wrap items-end justify-between gap-4 pb-6"><div><h1 className="font-display text-3xl leading-tight">{title}</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p></div>{action}</section>;
}

function DashboardPage({ patients, appointments, openModule, openRecord }: { patients: PatientView[]; appointments: AppointmentRow[]; openModule: (m: ModuleKey) => void; openRecord: (p: PatientView) => void }) {
  const today = isoDateLocal();
  const todayAppointments = appointments.filter((item) => item.scheduled_at.slice(0, 10) === today && item.status !== "cancelled").sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  const month = today.slice(0, 7);
  const monthly = appointments.filter((item) => item.scheduled_at.slice(0, 7) === month && item.status !== "cancelled");
  return <>
    <section className="animate-rise flex flex-wrap items-end justify-between gap-4 pb-6"><div><h1 className="font-display text-3xl">Olá, Anna!</h1><p className="mt-2 text-sm text-muted-foreground">Resumo real do consultório para hoje.</p></div><p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" }).format(new Date())}</p></section>
    <FinanceDashboardMetrics />
    <div className="mt-4 grid grid-cols-12 gap-4">
      <section className="dashboard-card col-span-12 rounded-2xl p-5 xl:col-span-7"><div className="flex items-center justify-between"><h2 className="font-display text-lg">Agenda de hoje</h2><Button variant="link" className="h-auto p-0 text-xs" onClick={() => openModule("Agenda")}>Ver agenda <ChevronRight /></Button></div><div className="mt-4 space-y-2">{todayAppointments.length === 0 && <Empty text="Nenhum atendimento agendado para hoje." />}{todayAppointments.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl bg-background/55 p-3"><span className="w-12 text-xs font-semibold">{new Date(item.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span><div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{item.patient_name || serviceLabel(item.service_kind)}</p><p className="text-[10px] text-muted-foreground">{modalityLabel(item.modality)} • {item.duration_minutes} min</p></div><StatusBadge status={statusLabel(item.status)} /></div>)}</div></section>
      <section className="dashboard-card col-span-12 rounded-2xl p-5 xl:col-span-5"><div className="flex items-center justify-between"><h2 className="font-display text-lg">Pacientes</h2><Button variant="link" className="h-auto p-0 text-xs" onClick={() => openModule("Pacientes")}>Ver todos</Button></div><div className="mt-3 space-y-1.5">{patients.slice(0, 5).map((patient) => <button key={patient.id} onClick={() => openRecord(patient)} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-accent/50"><span className="grid size-9 place-items-center rounded-full bg-accent text-[11px] font-semibold">{patient.initials}</span><div className="min-w-0"><p className="truncate text-[13px] font-medium">{patient.full_name}</p><p className="text-[10px] text-muted-foreground">Próxima: {patient.nextSession}</p></div></button>)}</div></section>
      <section className="dashboard-card col-span-12 rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-display text-lg">Atendimentos no mês</h2><p className="mt-1 text-[11px] text-muted-foreground">Dados cadastrados na agenda, sem números fictícios.</p></div><div className="flex gap-4 text-[11px] text-muted-foreground"><span>Presenciais: <strong className="text-foreground">{monthly.filter((x) => x.modality === "presential").length}</strong></span><span>On-line: <strong className="text-foreground">{monthly.filter((x) => x.modality === "online").length}</strong></span><span>Concluídos: <strong className="text-foreground">{monthly.filter((x) => x.status === "completed").length}</strong></span></div></div><WeeklyAppointmentsChart appointments={monthly} /></section>
    </div>
  </>;
}

function AgendaPage({ patients, onChanged }: { patients: PatientRow[]; onChanged: () => Promise<void> }) {
  const [day, setDay] = useState(isoDateLocal());
  const [items, setItems] = useState<AppointmentRow[]>([]);
  const [editing, setEditing] = useState<AppointmentRow | "new" | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => { if (!isSupabaseConfigured) return; setLoading(true); try { const bounds = dayBounds(day); setItems(await listAppointments(bounds.start, bounds.end)); } finally { setLoading(false); } }, [day]);
  useEffect(() => { void reload(); }, [reload]);
  const completed = items.filter((x) => x.status === "completed").length;
  return <>
    <PageHeader title="Agenda" description="Cadastre, edite e acompanhe os atendimentos do consultório." action={<Button variant="dashboard" onClick={() => setEditing("new")}><Plus /> Novo agendamento</Button>} />
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="dashboard-card rounded-2xl p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] text-muted-foreground">Data selecionada</p><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 h-10 rounded-xl border border-border bg-background px-3 text-sm" /></div><span className="text-xs text-muted-foreground">{loading ? "Carregando..." : `${items.length} registro(s)`}</span></div><div className="mt-5 space-y-3">{items.length === 0 && !loading && <Empty text="Nenhum atendimento nesta data." />}{items.map((item) => <article key={item.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card/55 p-4 sm:flex-row sm:items-center"><div className="w-16 text-sm font-semibold">{new Date(item.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.patient_name || serviceLabel(item.service_kind)}</p><p className="mt-1 text-[11px] text-muted-foreground">{modalityLabel(item.modality)} • {item.duration_minutes} min • {serviceLabel(item.service_kind)} • {money(item.amount)}</p></div><StatusBadge status={statusLabel(item.status)} /><Button variant="ghost" size="icon" onClick={() => setEditing(item)}><Pencil /></Button></article>)}</div></section>
      <section className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">Resumo do dia</h2><div className="mt-4 space-y-3 text-xs"><SummaryRow label="Atendimentos" value={String(items.length)} /><SummaryRow label="Presenciais" value={String(items.filter((x) => x.modality === "presential").length)} /><SummaryRow label="On-line" value={String(items.filter((x) => x.modality === "online").length)} /><SummaryRow label="Concluídos" value={String(completed)} /></div><p className="mt-5 text-[10px] leading-4 text-muted-foreground">O agendamento é interno. Não há página pública de autoagendamento nesta versão.</p></section>
    </div>
    {editing && <AppointmentModal patients={patients} appointment={editing === "new" ? null : editing} defaultDate={day} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); await onChanged(); }} />}
  </>;
}

function PatientsPage({ patients, onNew, onEdit, onRecord, onChanged }: { patients: PatientView[]; onNew: () => void; onEdit: (p: PatientRow) => void; onRecord: (p: PatientView) => void; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const visible = patients.filter((p) => p.full_name.toLowerCase().includes(query.toLowerCase()) || (p.phone ?? "").includes(query));
  return <>
    <PageHeader title="Pacientes" description="Cadastro administrativo, regras de cobrança e acesso seguro ao prontuário clínico." action={<Button variant="dashboard" onClick={onNew}><UserPlus /> Novo paciente</Button>} />
    <section className="dashboard-card rounded-2xl p-4 sm:p-5"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background/60 pl-10 pr-4 text-sm" placeholder="Buscar paciente..." /></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3">Paciente</th><th className="px-3 py-3">Última sessão</th><th className="px-3 py-3">Próxima sessão</th><th className="px-3 py-3">Cobrança</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Ações</th></tr></thead><tbody>{visible.map((p) => <tr key={p.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-accent text-[11px] font-semibold">{p.initials}</span><div><p className="text-[13px] font-medium">{p.full_name}</p><p className="text-[10px] text-muted-foreground">{p.phone || "Sem telefone"}</p></div></div></td><td className="px-3 py-4 text-xs text-muted-foreground">{p.lastSession}</td><td className="px-3 py-4 text-xs">{p.nextSession}</td><td className="px-3 py-4 text-xs">{p.billing_model === "package" ? `Pacote ${p.package_amount ? money(p.package_amount) : ""}` : "Por sessão"}</td><td className="px-3 py-4"><StatusBadge status={p.active ? "Ativo" : "Pausado"} /></td><td className="px-3 py-4"><div className="flex justify-end gap-1"><Button variant="quiet" size="sm" onClick={() => onRecord(p)}><LockKeyhole /> Prontuário</Button><Button variant="ghost" size="icon" onClick={() => onEdit(p)}><Pencil /></Button><Button variant="ghost" size="icon" onClick={async () => { if (confirm(`Arquivar ${p.full_name}? O histórico clínico e financeiro será preservado.`)) { await deletePatient(p.id); await onChanged(); } }}><Trash2 /></Button></div></td></tr>)}</tbody></table>{visible.length === 0 && <Empty text="Nenhum paciente encontrado." />}</div></section>
    <section className="dashboard-card mt-4 rounded-2xl p-5"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-accent"><BookOpenText className="size-5" /></span><div><h2 className="font-display text-lg">Prontuário protegido</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Cada abertura exige código TOTP. O conteúdo das evoluções é criptografado no navegador antes de ser enviado ao Supabase.</p></div></div></section>
  </>;
}

function SessionsPage({ patients, onChanged }: { patients: PatientRow[]; onChanged: () => Promise<void> }) {
  const [month, setMonth] = useState(isoDateLocal().slice(0, 7));
  const [items, setItems] = useState<AppointmentRow[]>([]);
  const [editing, setEditing] = useState<AppointmentRow | "new" | null>(null);
  const reload = useCallback(async () => { if (!isSupabaseConfigured) return; const b = monthBounds(month); setItems(await listAppointments(new Date(`${b.start}T00:00:00`).toISOString(), new Date(`${b.end}T00:00:00`).toISOString())); }, [month]);
  useEffect(() => { void reload(); }, [reload]);
  const completed = items.filter((x) => x.status === "completed");
  const sessionItems = items.filter((x) => x.service_kind === "session");
  return <>
    <PageHeader title="Sessões" description="Registre e acompanhe atendimentos, modalidade, duração, status e valor." action={<div className="flex gap-2"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-xs" /><Button variant="dashboard" onClick={() => setEditing("new")}><Plus /> Registrar sessão</Button></div>} />
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Sessões no mês" value={String(sessionItems.length)} note={`${completed.filter((x) => x.service_kind === "session").length} concluída(s)`} icon={<CalendarDays />} /><MetricCard label="Presenciais" value={String(items.filter((x) => x.modality === "presential").length)} note="atendimentos registrados" icon={<Users />} /><MetricCard label="On-line" value={String(items.filter((x) => x.modality === "online").length)} note="atendimentos registrados" icon={<Video />} /><MetricCard label="Pendentes" value={String(items.filter((x) => ["scheduled", "confirmed"].includes(x.status)).length)} note="a realizar" icon={<Clock3 />} /></section>
    <section className="dashboard-card mt-4 rounded-2xl p-5"><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="px-3 py-3">Data</th><th className="px-3 py-3">Paciente/cliente</th><th className="px-3 py-3">Serviço</th><th className="px-3 py-3">Modalidade</th><th className="px-3 py-3">Valor</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Ação</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-4 text-xs">{dateTimeLabel(item.scheduled_at)}</td><td className="px-3 py-4 text-[13px] font-medium">{item.patient_name || "—"}</td><td className="px-3 py-4 text-xs">{serviceLabel(item.service_kind)}</td><td className="px-3 py-4 text-xs">{modalityLabel(item.modality)}</td><td className="px-3 py-4 text-xs font-medium">{money(item.amount)}</td><td className="px-3 py-4"><StatusBadge status={statusLabel(item.status)} /></td><td className="px-3 py-4 text-right"><Button variant="ghost" size="icon" onClick={() => setEditing(item)}><Pencil /></Button></td></tr>)}</tbody></table>{items.length === 0 && <Empty text="Nenhum atendimento registrado no mês." />}</div></section>
    {editing && <AppointmentModal patients={patients} appointment={editing === "new" ? null : editing} defaultDate={`${month}-01`} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); await onChanged(); }} />}
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
    const [y, m] = month.split("-").map(Number);
    const start = new Date(y, m - 6, 1);
    const end = new Date(y, m, 1);
    const hist = await loadFinanceHistory(isoDateLocal(start), isoDateLocal(end));
    const rows: Array<{ month: string; billed: number; expenses: number }> = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(y, m - 6 + i, 1);
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
    <PageHeader title="Materiais" description="Armazene arquivos do consultório em bucket privado do Supabase." action={<Button variant="dashboard" onClick={() => setModal(true)}><Upload /> Adicionar material</Button>} />
    <section className="dashboard-card rounded-2xl p-5"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(e) => setQuery(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background/60 pl-10 pr-4 text-sm" placeholder="Buscar material..." /></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((item) => <article key={item.id} className="rounded-2xl border border-border bg-card/55 p-4"><span className="grid size-10 place-items-center rounded-xl bg-accent"><FileText className="size-5" /></span><h2 className="mt-4 text-sm font-medium">{item.title}</h2><p className="mt-1 text-[11px] text-muted-foreground">{item.category || "Sem categoria"} • {item.file_type || "Arquivo"}</p><p className="mt-3 text-[10px] text-muted-foreground">Adicionado em {dateLabel(item.created_at)}</p><div className="mt-4 flex gap-2"><Button variant="quiet" size="sm" className="flex-1" onClick={async () => { if (!item.file_path) return; const url = await openMaterial(item.file_path); window.open(url, "_blank", "noopener,noreferrer"); }}><Eye /> Abrir</Button><Button variant="ghost" size="icon" onClick={async () => { if (confirm(`Excluir ${item.title}?`)) { await deleteMaterial(item); await reload(); } }}><Trash2 /></Button></div></article>)}</div>{visible.length === 0 && <Empty text="Nenhum material cadastrado." />}</section>
    {modal && <MaterialModal onClose={() => setModal(false)} onSaved={async () => { setModal(false); await reload(); }} />}
  </>;
}

function SettingsPage({ settings, vaultKey, onVaultKey, onSettings }: { settings: AppSettingsRow | null; vaultKey: CryptoKey | null; onVaultKey: (k: CryptoKey | null) => void; onSettings: (s: AppSettingsRow) => void }) {
  const [draft, setDraft] = useState({ professional_name: settings?.professional_name || "Anna Karina Dias", crp: settings?.crp || "", phone: settings?.phone || "", email: settings?.email || "" });
  const [message, setMessage] = useState("");
  useEffect(() => { if (settings) setDraft({ professional_name: settings.professional_name, crp: settings.crp || "", phone: settings.phone || "", email: settings.email || "" }); }, [settings]);
  return <>
    <PageHeader title="Configurações" description="Perfil, autenticação em duas etapas e cofre criptográfico dos prontuários." />
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsCard title="Perfil profissional" description="Dados administrativos da profissional."><div className="grid gap-4 sm:grid-cols-2"><FieldEdit label="Nome" value={draft.professional_name} onChange={(v) => setDraft((d) => ({...d, professional_name:v}))} /><FieldEdit label="CRP" value={draft.crp} onChange={(v) => setDraft((d) => ({...d, crp:v}))} /><FieldEdit label="Telefone" value={draft.phone} onChange={(v) => setDraft((d) => ({...d, phone:v}))} /><FieldEdit label="E-mail" value={draft.email} onChange={(v) => setDraft((d) => ({...d, email:v}))} /></div><Button variant="quiet" size="sm" className="mt-4" onClick={async () => { const saved = await saveAppSettings(draft); onSettings(saved); setMessage("Perfil salvo."); }}>Salvar alterações</Button></SettingsCard>
      <MfaSettings />
      <VaultSettings settings={settings} vaultKey={vaultKey} onVaultKey={onVaultKey} onSettings={onSettings} />
      <SettingsCard title="Proteção implementada" description="Como os dados clínicos são protegidos."><div className="space-y-3 text-xs text-muted-foreground"><p><strong className="text-foreground">RLS:</strong> o usuário autenticado acessa somente os próprios registros.</p><p><strong className="text-foreground">TOTP:</strong> cada abertura de prontuário exige um novo código do aplicativo autenticador.</p><p><strong className="text-foreground">Criptografia:</strong> evoluções são cifradas com AES-GCM no navegador e o Supabase recebe somente texto cifrado.</p><p><strong className="text-foreground">Cofre:</strong> a senha do cofre não é salva no banco. Sem ela, o conteúdo cifrado não pode ser recuperado.</p></div></SettingsCard>
    </div>
    {message && <p className="mt-4 text-xs text-primary">{message}</p>}
  </>;
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
  const configured = Boolean(settings?.vault_salt && settings?.vault_verifier_ciphertext && settings?.vault_verifier_iv);
  const [pass, setPass] = useState(""); const [confirmPass, setConfirmPass] = useState(""); const [message, setMessage] = useState("");
  const setup = async () => {
    if (!isStrongVaultPassphrase(pass) || pass !== confirmPass) { setMessage("Use uma senha com pelo menos 16 caracteres, combinando pelo menos 3 grupos: maiúsculas, minúsculas, números e símbolos."); return; }
    const created = await createVaultVerifier(pass);
    const saved = await saveAppSettings({ vault_salt: created.salt, vault_verifier_ciphertext: created.ciphertext, vault_verifier_iv: created.iv });
    onSettings(saved); onVaultKey(created.key); setPass(""); setConfirmPass(""); setMessage("Cofre criado. Guarde essa senha em local seguro: ela não pode ser recuperada pelo sistema.");
  };
  const unlock = async () => {
    if (!settings?.vault_salt || !settings.vault_verifier_ciphertext || !settings.vault_verifier_iv) return;
    const key = await unlockVault(pass, settings.vault_salt, settings.vault_verifier_ciphertext, settings.vault_verifier_iv);
    if (!key) { setMessage("Senha do cofre incorreta."); return; }
    onVaultKey(key); setPass(""); setMessage("Cofre desbloqueado nesta sessão.");
  };
  return <SettingsCard title="Cofre clínico criptografado" description="A senha do cofre existe somente com a Anna e não é armazenada no Supabase.">{configured ? <div>{vaultKey ? <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary"><Check className="mr-2 inline size-4" /> Cofre desbloqueado nesta sessão</div> : <div className="flex gap-2"><input type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} className="h-10 flex-1 rounded-xl border border-border bg-background px-3 text-sm" placeholder="Senha do cofre" /><Button variant="dashboard" onClick={() => void unlock()}>Desbloquear</Button></div>}</div> : <div className="space-y-3"><input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Crie uma senha forte (mín. 16 caracteres)" /><input type="password" autoComplete="new-password" value={confirmPass} onChange={(e) => setConfirmPass(e.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Repita a senha" /><Button variant="dashboard" onClick={() => void setup()}>Criar cofre clínico</Button><p className="text-[10px] leading-4 text-destructive">Atenção: se esta senha for perdida, as evoluções criptografadas não poderão ser recuperadas.</p></div>}{message && <p className="mt-3 text-[11px] text-muted-foreground">{message}</p>}</SettingsCard>;
}

function PatientModal({ patient, onClose, onSaved }: { patient: PatientRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const [name, setName] = useState(patient?.full_name ?? ""); const [phone, setPhone] = useState(patient?.phone ?? ""); const [email, setEmail] = useState(patient?.email ?? ""); const [active, setActive] = useState(patient?.active ?? true); const [billing, setBilling] = useState<"session"|"package">(patient?.billing_model ?? "session"); const [amount, setAmount] = useState(patient?.package_amount?.toString() ?? ""); const [timing, setTiming] = useState<"current_month"|"next_month">(patient?.package_timing ?? "current_month"); const [day, setDay] = useState(patient?.billing_day ?? 5); const [notes, setNotes] = useState(patient?.notes_admin ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true); setError("");
    try {
      const patch = { full_name:name.trim(), phone:phone.trim()||null, email:email.trim()||null, active, billing_model:billing, package_amount:billing === "package" ? Number(amount.replace(",",".")) || null : null, package_timing:billing === "package" ? timing : null, billing_day:billing === "package" ? day : null, notes_admin:notes.trim()||null };
      if (patient) await updatePatient(patient.id, patch); else await createPatient(patch as Partial<PatientRow> & Pick<PatientRow,"full_name">, requestId);
      await onSaved();
    } catch { setError("Não foi possível salvar o paciente. Confira os dados e tente novamente."); }
    finally { setSaving(false); }
  };
  return <ModalShell onClose={onClose}><ModalHeader title={patient ? "Editar paciente" : "Novo paciente"} subtitle="Dados administrativos e regra de cobrança." onClose={onClose} /><div className="grid gap-4 p-5 sm:grid-cols-2"><FieldEdit label="Nome completo" value={name} onChange={setName} /><FieldEdit label="WhatsApp" value={phone} onChange={setPhone} /><FieldEdit label="E-mail" value={email} onChange={setEmail} /><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Status</span><select value={active ? "active":"paused"} onChange={(e)=>setActive(e.target.value === "active")} className="input-finance"><option value="active">Ativo</option><option value="paused">Pausado</option></select></label><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Cobrança</span><select value={billing} onChange={(e)=>setBilling(e.target.value as "session"|"package")} className="input-finance"><option value="session">Por sessão</option><option value="package">Pacote mensal</option></select></label>{billing === "package" && <><FieldEdit label="Valor do pacote" value={amount} onChange={setAmount} /><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Quando cobrar</span><select value={timing} onChange={(e)=>setTiming(e.target.value as "current_month"|"next_month")} className="input-finance"><option value="current_month">Início do próprio mês</option><option value="next_month">Início do mês seguinte</option></select></label><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Dia</span><input type="number" min={1} max={28} value={day} onChange={(e)=>setDay(Number(e.target.value))} className="input-finance" /></label></>}<label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] text-muted-foreground">Observações administrativas</span><textarea maxLength={4000} value={notes} onChange={(e)=>setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>{error&&<p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex justify-end gap-2 sm:col-span-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" disabled={saving || !name.trim()} onClick={() => void save()}>{saving ? "Salvando..." : "Salvar"}</Button></div></div></ModalShell>;
}

function AppointmentModal({ patients, appointment, defaultDate, onClose, onSaved }: { patients: PatientRow[]; appointment: AppointmentRow | null; defaultDate: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const requestId = useRef(crypto.randomUUID()).current;
  const initialDateTime = appointment ? new Date(appointment.scheduled_at) : new Date(`${defaultDate}T09:00:00`);
  const localValue = `${isoDateLocal(initialDateTime)}T${String(initialDateTime.getHours()).padStart(2,"0")}:${String(initialDateTime.getMinutes()).padStart(2,"0")}`;
  const [patientId, setPatientId] = useState(appointment?.patient_id ?? ""); const [name, setName] = useState(appointment?.patient_name ?? ""); const [when, setWhen] = useState(localValue); const [duration, setDuration] = useState(appointment?.duration_minutes ?? 50); const [modality, setModality] = useState<"presential"|"online">(appointment?.modality ?? "presential"); const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? "scheduled"); const [kind, setKind] = useState<ServiceKind>(appointment?.service_kind ?? "session"); const [amount, setAmount] = useState(String(appointment?.amount ?? "")); const [notes, setNotes] = useState(appointment?.notes_admin ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const selectPatient = (id: string) => { setPatientId(id); const p = patients.find((x)=>x.id===id); if (p) setName(p.full_name); };
  const save = async () => {
    if (!when || !name.trim()) return;
    setSaving(true); setError("");
    try {
      const parsed = new Date(when);
      if (Number.isNaN(parsed.getTime())) throw new Error("data inválida");
      const payload = { patient_id:patientId||null, patient_name:name.trim(), scheduled_at:parsed.toISOString(), duration_minutes:duration, modality, status, service_kind:kind, amount:Number(amount.replace(",","."))||0, notes_admin:notes.trim()||null };
      if (appointment) {
        await updateAppointment(appointment.id, payload);
      } else {
        await createAppointment(
          payload as Omit<AppointmentRow, "id" | "created_at">,
          requestId,
        );
      }
      await onSaved();
    } catch { setError("Não foi possível salvar. Confira os dados; o horário também pode estar ocupado por outro atendimento."); }
    finally { setSaving(false); }
  };
  return <ModalShell onClose={onClose} width="max-w-2xl"><ModalHeader title={appointment ? "Editar atendimento" : "Novo atendimento"} subtitle="Agenda e sessão usam o mesmo registro para evitar duplicidade." onClose={onClose} /><div className="grid gap-4 p-5 sm:grid-cols-2"><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Paciente cadastrado</span><select value={patientId} onChange={(e)=>selectPatient(e.target.value)} className="input-finance"><option value="">Outro / não cadastrado</option>{patients.map((p)=><option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label><FieldEdit label="Paciente / cliente" value={name} onChange={setName} /><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Data e hora</span><input type="datetime-local" value={when} onChange={(e)=>setWhen(e.target.value)} className="input-finance" /></label><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Duração (min)</span><input type="number" min={10} max={240} value={duration} onChange={(e)=>setDuration(Number(e.target.value))} className="input-finance" /></label><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Modalidade</span><select value={modality} onChange={(e)=>setModality(e.target.value as "presential"|"online")} className="input-finance"><option value="presential">Presencial</option><option value="online">On-line</option></select></label><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Status</span><select value={status} onChange={(e)=>setStatus(e.target.value as AppointmentStatus)} className="input-finance"><option value="scheduled">Agendada</option><option value="confirmed">Confirmada</option><option value="completed">Concluída</option><option value="no_show">Falta</option><option value="cancelled">Cancelada</option></select></label><label><span className="mb-1.5 block text-[10px] text-muted-foreground">Serviço</span><select value={kind} onChange={(e)=>setKind(e.target.value as ServiceKind)} className="input-finance"><option value="session">Sessão</option><option value="psychological_test">Teste psicológico</option><option value="neuropsychology">Neuropsicologia</option><option value="company">Empresa</option><option value="other">Outro</option></select></label><FieldEdit label="Valor" value={amount} onChange={setAmount} /><label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] text-muted-foreground">Observações administrativas</span><textarea maxLength={4000} value={notes} onChange={(e)=>setNotes(e.target.value)} className="min-h-20 w-full rounded-xl border border-border bg-background p-3 text-sm" /></label>{error&&<p className="text-xs text-destructive sm:col-span-2">{error}</p>}<div className="flex flex-wrap justify-between gap-2 sm:col-span-2">{appointment ? <Button variant="ghost" className="text-destructive" onClick={async()=>{ if(confirm("Cancelar este atendimento? O histórico será preservado.")){setError("");try{await deleteAppointment(appointment.id);await onSaved();}catch{setError("Não foi possível cancelar o atendimento.");}} }}><Trash2 /> Cancelar atendimento</Button>:<span/>}<div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="dashboard" disabled={saving || !name.trim() || !when} onClick={() => void save()}>{saving?"Salvando...":"Salvar"}</Button></div></div></div></ModalShell>;
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

function TwoFactorModal({ patient, settings, vaultKey, onVaultKey, onClose, onVerified }: { patient: PatientView; settings: AppSettingsRow | null; vaultKey: CryptoKey | null; onVaultKey: (k: CryptoKey) => void; onClose: () => void; onVerified: () => void }) {
  const [phase, setPhase] = useState<"checking"|"totp"|"vault"|"blocked">("checking");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [granted, setGranted] = useState(false);

  useEffect(()=>{(async()=>{
    if(!supabase){setPhase("blocked");setError("Supabase não configurado.");return;}
    const {data,error}=await supabase.auth.mfa.listFactors();
    if(error){setPhase("blocked");setError("Não foi possível verificar o autenticador.");return;}
    const factor=data.totp.find((x)=>x.status==="verified");
    if(!factor){setPhase("blocked");setError("Configure o Google Authenticator em Configurações antes de abrir prontuários.");return;}
    if(!settings?.vault_salt||!settings.vault_verifier_ciphertext||!settings.vault_verifier_iv){setPhase("blocked");setError("Crie o cofre clínico em Configurações antes de abrir prontuários.");return;}
    setFactorId(factor.id);setPhase("totp");
  })();},[settings]);

  const closeSecure=()=>{
    if(granted) void revokeClinicalAccess(patient.id).catch(()=>undefined);
    onClose();
  };

  const verifyTotp=async()=>{
    if(!supabase||!factorId||!/^\d{6}$/.test(code)){setError("Informe o código de 6 dígitos.");return;}
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
    if(!settings?.vault_salt||!settings.vault_verifier_ciphertext||!settings.vault_verifier_iv)return;
    const key=await unlockVault(pass,settings.vault_salt,settings.vault_verifier_ciphertext,settings.vault_verifier_iv);
    setPass("");
    if(!key){setError("Senha do cofre incorreta.");return;}
    onVaultKey(key);onVerified();
  };

  return <ModalShell onClose={closeSecure}><div className="p-6"><div className="flex items-start justify-between"><span className="grid size-12 place-items-center rounded-2xl bg-accent"><LockKeyhole className="size-5" /></span><Button variant="ghost" size="icon" onClick={closeSecure}><X /></Button></div><h2 className="mt-5 font-display text-xl">Prontuário — {patient.full_name}</h2>{phase==="checking"&&<p className="mt-3 text-sm text-muted-foreground">Verificando proteção...</p>}{phase==="blocked"&&<div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">{error}</div>}{phase==="totp"&&<><p className="mt-2 text-sm text-muted-foreground">Digite o código atual do Google Authenticator. Cada abertura exige uma nova verificação.</p><input autoFocus inputMode="numeric" maxLength={6} value={code} onChange={(e)=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} onKeyDown={(e)=>{if(e.key==="Enter")void verifyTotp();}} className="mt-5 h-12 w-full rounded-xl border border-border bg-background px-4 text-center font-mono text-xl tracking-[0.45em]" placeholder="000000" /><Button variant="dashboard" className="mt-4 w-full" disabled={code.length!==6} onClick={()=>void verifyTotp()}>Verificar código</Button></>}{phase==="vault"&&<><p className="mt-2 text-sm text-muted-foreground">Desbloqueie o cofre clínico. A senha permanece somente na memória desta aba e não é enviada ao Supabase.</p><input autoFocus type="password" value={pass} onChange={(e)=>setPass(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")void unlock();}} className="mt-5 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" placeholder="Senha do cofre" autoComplete="off" /><Button variant="dashboard" className="mt-4 w-full" disabled={!pass} onClick={()=>void unlock()}>Desbloquear cofre</Button></>}{error&&phase!=="blocked"&&<p className="mt-3 text-xs text-destructive">{error}</p>}</div></ModalShell>;
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
