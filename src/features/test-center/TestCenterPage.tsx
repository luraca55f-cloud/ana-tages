import { Activity, CheckCircle2, Database, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import {
  readTestDb,
  writeTestDb,
  testCancelPatientPackagePlan,
  testCreateAppointment,
  testCreateClinicalNote,
  testCreateExpense,
  testCreatePatient,
  testCreateRevenue,
  testCreateServiceWorkEntry,
  testDeleteClinicalNote,
  testDeleteExpense,
  testDeleteManualRevenue,
  testDeleteMaterial,
  testDeletePatient,
  testDeleteRevenueReceipt,
  testDeleteServiceWorkEntry,
  testListAppointmentPayments,
  testListMaterials,
  testListPatients,
  testLoadFinanceBundle,
  testLoadReports,
  testMarkAppointmentPaid,
  testMarkExpensePaid,
  testMarkRevenuePaid,
  testMarkServiceWorkPaid,
  testOpenMaterial,
  testSaveAppSettings,
  testSaveAppointmentBillingPlan,
  testSavePatientPackagePlan,
  testUpdateAppointment,
  testUpdateExpense,
  testUpdateManualRevenue,
  testUpdatePatient,
  testUpdateServiceWorkEntry,
  testUploadMaterial,
} from "../../lib/test-data";

export type TestCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

type ServerDiagnostics = {
  checks?: TestCheck[];
  anti_pause?: {
    configured?: boolean;
    management_query_ok?: boolean;
    rest_query_ok?: boolean;
    generated_at?: string;
  };
  error?: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextDayIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function assertion(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function runLocalSmokeTests(): Promise<TestCheck[]> {
  const snapshot = JSON.parse(JSON.stringify(readTestDb())) as ReturnType<typeof readTestDb>;
  const results: TestCheck[] = [];

  const run = async (id: string, label: string, action: () => void | Promise<void>) => {
    try {
      await action();
      results.push({ id, label, ok: true, detail: "OK" });
    } catch (cause) {
      results.push({ id, label, ok: false, detail: cause instanceof Error ? cause.message : "Falha inesperada" });
    }
  };

  try {
    let patientId = "";
    let secondAppointmentId = "";

    await run("patient", "Pacientes: criar, editar e arquivar", () => {
      const patient = testCreatePatient({ full_name: "Paciente Teste Automático", billing_model: "session", session_amount: 180 });
      patientId = patient.id;
      const edited = testUpdatePatient(patient.id, { phone: "(38) 99999-0000", session_amount: 190 });
      assertion(edited.session_amount === 190, "Edição do paciente não foi persistida.");
      assertion(testListPatients().some((item) => item.id === patient.id), "Paciente não apareceu na listagem.");
    });

    await run("appointment", "Sessões: criar, editar, cobrar e receber", () => {
      assertion(patientId, "Paciente de teste não foi criado.");
      const appointment = testCreateAppointment({
        patient_id: patientId,
        patient_name: "Paciente Teste Automático",
        scheduled_at: `${todayIso()}T15:00:00.000Z`,
        duration_minutes: 50,
        modality: "online",
        status: "scheduled",
        service_kind: "session",
        service_name: "Sessão",
        amount: 190,
        notes_admin: "Teste automático",
      });
      const payments = testListAppointmentPayments([appointment.id]);
      assertion(payments.length === 1 && payments[0]?.status === "pending", "A cobrança da sessão não foi criada.");
      testUpdateAppointment(appointment.id, { modality: "presential", amount: 200 });
      testMarkAppointmentPaid(appointment.id, "pix");
      const paid = testListAppointmentPayments([appointment.id]);
      assertion(paid[0]?.status === "paid", "A baixa da sessão não foi registrada.");

      const installmentAppointment = testCreateAppointment({
        patient_id: patientId,
        patient_name: "Paciente Teste Automático",
        scheduled_at: `${nextDayIso()}T15:00:00.000Z`,
        duration_minutes: 50,
        modality: "online",
        status: "scheduled",
        service_kind: "session",
        service_name: "Sessão parcelada",
        amount: 300,
        notes_admin: null,
      });
      secondAppointmentId = installmentAppointment.id;
      testSaveAppointmentBillingPlan({ appointment_id: installmentAppointment.id, payment_mode: "installments", installment_count: 3, first_due_date: todayIso() });
      const installments = testListAppointmentPayments([installmentAppointment.id]);
      assertion(installments.length === 3, "O parcelamento 3x não gerou três cobranças.");
    });

    await run("package", "Pacotes: criar parcelamento e cancelar", () => {
      const packagePatient = testCreatePatient({ full_name: "Paciente Pacote Teste", billing_model: "package", package_amount: 600 });
      testSavePatientPackagePlan({ patient_id: packagePatient.id, total_amount: 600, payment_mode: "installments", installment_count: 3, first_due_date: todayIso() });
      const db = readTestDb();
      assertion(db.billings.filter((item) => item.patient_id === packagePatient.id && item.package_plan_id && item.status !== "cancelled").length === 3, "Parcelas do pacote não foram criadas.");
      testCancelPatientPackagePlan(packagePatient.id);
      testDeletePatient(packagePatient.id);
    });

    await run("finance", "Financeiro: receita manual, edição, baixa e exclusão", () => {
      const description = `Receita smoke ${Date.now()}`;
      testCreateRevenue({ source_type: "other", client_name: "Teste automático", description, competence_date: todayIso(), issued_at: todayIso(), due_date: todayIso(), amount: 123.45, status: "pending" });
      let db = readTestDb();
      const revenue = db.billings.find((item) => item.description === description);
      assertion(revenue, "Receita manual não foi criada.");
      testUpdateManualRevenue({ id: revenue!.id, source_type: "other", client_name: "Teste automático", description: `${description} editada`, competence_date: todayIso(), issued_at: todayIso(), due_date: todayIso(), amount: 130 });
      testMarkRevenuePaid(revenue!.id);
      db = readTestDb();
      assertion(db.billings.find((item) => item.id === revenue!.id)?.status === "paid", "Receita não foi baixada.");
      testDeleteRevenueReceipt(revenue!.id);
      testDeleteManualRevenue(revenue!.id);
    });

    await run("expense", "Financeiro: despesa criar, editar, pagar e excluir", () => {
      const description = `Despesa smoke ${Date.now()}`;
      testCreateExpense({ category: "Teste", description, competence_date: todayIso(), due_date: todayIso(), amount: 50, recurrence: "variable", status: "pending" });
      let db = readTestDb();
      const expense = db.expenses.find((item) => item.description === description);
      assertion(expense, "Despesa não foi criada.");
      testUpdateExpense({ ...expense!, amount: 55, description: `${description} editada` });
      testMarkExpensePaid(expense!.id);
      db = readTestDb();
      assertion(db.expenses.find((item) => item.id === expense!.id)?.status === "paid", "Despesa não foi marcada como paga.");
      testDeleteExpense(expense!.id);
    });

    await run("materials", "Materiais: enviar, abrir e excluir arquivo", async () => {
      const file = new File(["teste"], "teste-automatico.pdf", { type: "application/pdf" });
      const material = await testUploadMaterial(file, "Material teste automático", "Anamnese", "Gerado pela Central de Testes");
      assertion(testListMaterials().some((item) => item.id === material.id), "Material não apareceu na biblioteca.");
      assertion(Boolean(material.file_path && testOpenMaterial(material.file_path)), "Arquivo de teste não pôde ser aberto.");
      testDeleteMaterial(material.id);
    });

    await run("clinical", "Prontuário: criar e arquivar anotação de teste", () => {
      assertion(patientId, "Paciente de teste não foi criado.");
      const note = testCreateClinicalNote({ patient_id: patientId, appointment_id: null, note_date: todayIso(), title: "Registro teste", content_ciphertext: "teste-cifrado", content_iv: "iv-teste" });
      testDeleteClinicalNote(note.id);
      const archived = readTestDb().clinicalNotes.find((item) => item.id === note.id);
      assertion(Boolean(archived?.archived_at), "Anotação clínica não foi arquivada.");
    });

    await run("service-work", "Prestação de Serviço: criar, editar, pagar e excluir", () => {
      const id = testCreateServiceWorkEntry({ kind: "income", client_name: "Empresa teste", description: "Serviço teste automático", amount: 250, due_date: todayIso(), status: "pending" });
      testUpdateServiceWorkEntry(id, { kind: "income", client_name: "Empresa teste", description: "Serviço teste automático editado", amount: 260, due_date: todayIso(), status: "pending" });
      testMarkServiceWorkPaid(id, todayIso(), "pix");
      testDeleteServiceWorkEntry(id);
    });

    await run("reports", "Relatórios, configurações e consolidação financeira", () => {
      testSaveAppSettings({ city: "Montes Claros" });
      const month = todayIso().slice(0, 7);
      const start = `${month}-01`;
      const next = new Date(`${start}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const end = next.toISOString().slice(0, 10);
      const reports = testLoadReports(start, end);
      const finance = testLoadFinanceBundle(month, true);
      assertion(Array.isArray(reports.appointments) && Array.isArray(finance.billed), "Relatórios financeiros não foram consolidados.");
    });

    await run("cleanup", "Limpeza das simulações automáticas", () => {
      if (secondAppointmentId) {
        const appointment = readTestDb().appointments.find((item) => item.id === secondAppointmentId);
        if (appointment) testUpdateAppointment(secondAppointmentId, { status: "cancelled" });
      }
      if (patientId) testDeletePatient(patientId);
    });
  } finally {
    writeTestDb(snapshot);
  }

  return results;
}

async function getServerDiagnostics(): Promise<ServerDiagnostics> {
  const response = await fetch("/api/test-center/health", { method: "GET", credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as ServerDiagnostics | null;
  if (!response.ok || !payload) throw new Error(payload?.error || "Não foi possível verificar o servidor e o Supabase.");
  return payload;
}

async function triggerKeepAlive() {
  const response = await fetch("/api/test-center/keepalive", { method: "POST", credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as ServerDiagnostics | null;
  if (!response.ok || !payload) throw new Error(payload?.error || "Não foi possível testar o anti-pausa.");
  return payload;
}

function ResultRow({ item }: { item: TestCheck }) {
  return <div className="flex items-start gap-3 rounded-xl border border-border bg-background/45 p-3">
    {item.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
    <div className="min-w-0"><p className="text-xs font-semibold">{item.label}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{item.detail}</p></div>
  </div>;
}

export function TestCenterPage() {
  const [localResults, setLocalResults] = useState<TestCheck[]>([]);
  const [serverResults, setServerResults] = useState<TestCheck[]>([]);
  const [antiPause, setAntiPause] = useState<ServerDiagnostics["anti_pause"] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const runAll = async () => {
    setRunning(true);
    setError("");
    setLocalResults([]);
    setServerResults([]);
    try {
      const [local, remote] = await Promise.all([runLocalSmokeTests(), getServerDiagnostics()]);
      setLocalResults(local);
      setServerResults(remote.checks ?? []);
      setAntiPause(remote.anti_pause ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha inesperada durante os testes.");
    } finally {
      setRunning(false);
    }
  };

  const testKeepAlive = async () => {
    setRunning(true);
    setError("");
    try {
      const result = await triggerKeepAlive();
      setAntiPause(result.anti_pause ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao testar o anti-pausa.");
    } finally {
      setRunning(false);
    }
  };

  const all = [...localResults, ...serverResults];
  const failures = all.filter((item) => !item.ok).length;
  const finished = all.length > 0;

  return <div className="animate-rise">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="font-display text-3xl">Central de Testes</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Roda simulações no perfil de homologação e verifica o banco real somente em leitura, antes de liberar uma atualização para a Ana.</p></div>
      <Button variant="dashboard" onClick={() => void runAll()} disabled={running}><RefreshCw className={running ? "animate-spin" : ""} /> {running ? "Testando..." : "Executar todos os testes"}</Button>
    </header>

    <section className="mt-6 grid gap-4 md:grid-cols-3">
      <div className="dashboard-card rounded-2xl p-5"><ShieldCheck className="size-5 text-primary" /><p className="mt-3 text-[10px] uppercase text-muted-foreground">Resultado geral</p><p className="mt-1 font-display text-2xl">{!finished ? "Não executado" : failures === 0 ? "Tudo OK" : `${failures} falha(s)`}</p><p className="mt-1 text-[10px] text-muted-foreground">As simulações locais são restauradas ao final e não alteram os dados da Ana.</p></div>
      <div className="dashboard-card rounded-2xl p-5"><Database className="size-5 text-primary" /><p className="mt-3 text-[10px] uppercase text-muted-foreground">Banco real</p><p className="mt-1 font-display text-2xl">{serverResults.length ? serverResults.every((item) => item.ok) ? "Compatível" : "Revisar" : "Não verificado"}</p><p className="mt-1 text-[10px] text-muted-foreground">Checagem somente leitura de conexão, tabelas e funções essenciais.</p></div>
      <div className="dashboard-card rounded-2xl p-5"><Activity className="size-5 text-primary" /><p className="mt-3 text-[10px] uppercase text-muted-foreground">Anti-pausa</p><p className="mt-1 font-display text-2xl">{antiPause?.configured ? (antiPause.management_query_ok || antiPause.rest_query_ok ? "Ativo" : "Com falha") : "Não verificado"}</p><p className="mt-1 text-[10px] text-muted-foreground">O Worker faz consultas leves 3 vezes ao dia para manter atividade no projeto gratuito.</p><Button className="mt-3" variant="quiet" size="sm" onClick={() => void testKeepAlive()} disabled={running}>Testar agora</Button></div>
    </section>

    {error ? <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">{error}</div> : null}

    <section className="mt-5 grid gap-5 xl:grid-cols-2">
      <div className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">Funções do perfil de teste</h2><p className="mt-1 text-[11px] text-muted-foreground">Cria, edita e remove dados temporários para validar os fluxos principais.</p><div className="mt-4 space-y-2">{localResults.length ? localResults.map((item) => <ResultRow key={item.id} item={item} />) : <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">Clique em “Executar todos os testes”.</p>}</div></div>
      <div className="dashboard-card rounded-2xl p-5"><h2 className="font-display text-lg">Servidor e Supabase</h2><p className="mt-1 text-[11px] text-muted-foreground">Não grava pacientes, prontuários nem valores reais.</p><div className="mt-4 space-y-2">{serverResults.length ? serverResults.map((item) => <ResultRow key={item.id} item={item} />) : <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">A compatibilidade do banco será conferida junto com os testes.</p>}</div></div>
    </section>

    <div className="mt-5 rounded-2xl border border-amber-300/60 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><strong>Importante:</strong> o anti-pausa reduz bastante o risco de pausa no plano Free, mas não é uma garantia contratual do Supabase. Projeto em plano pago não é pausado automaticamente por inatividade.</div>
  </div>;
}
