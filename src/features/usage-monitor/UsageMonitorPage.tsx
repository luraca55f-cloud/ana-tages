import { Activity, Database, FileArchive, HardDrive, LogOut, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../components/auth/AuthGate";
import { Button } from "../../components/ui/button";
import { getSupabaseUsageSnapshot } from "./repository";
import type { SupabaseUsageSnapshot } from "./types";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB`;
  const gb = mb / 1024;
  return `${gb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
}

function UsageCard({ label, value, note, icon }: { label: string; value: string; note: string; icon: ReactNode }) {
  return (
    <div className="dashboard-card rounded-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-2xl">{value}</p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{note}</p>
        </div>
        <span className="grid size-10 place-items-center rounded-xl bg-accent text-primary">{icon}</span>
      </div>
    </div>
  );
}

export function UsageMonitorPage({ embedded = false }: { embedded?: boolean }) {
  const { user, signOut, isTestMode: authTestMode } = useAuth();
  const role = typeof user?.app_metadata?.["tages_role"] === "string" ? user.app_metadata["tages_role"] : "";
  const isTestMode = authTestMode || role === "test_profile";
  const [snapshot, setSnapshot] = useState<SupabaseUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSnapshot(await getSupabaseUsageSnapshot());
    } catch (cause) {
      console.error("Falha ao carregar uso do Supabase", cause);
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar o uso do Supabase.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const content = (
    <div className={embedded ? "animate-rise" : "mx-auto max-w-5xl"}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></span>
          <div>
            <h1 className="font-display text-2xl">Uso do Supabase</h1>
            <p className="text-xs text-muted-foreground">
              {isTestMode
                ? "Consulta somente leitura pelo Cloudflare. Seus dados de homologação continuam locais e separados da Ana."
                : "Acesso técnico restrito. Nenhum dado clínico, paciente ou financeiro é exibido."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="quiet" onClick={() => void reload()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} /> Atualizar</Button>
          {!embedded && <Button variant="ghost" onClick={() => void signOut()}><LogOut /> Sair</Button>}
        </div>
      </header>

      <section className="mt-7 rounded-2xl border border-border bg-card/50 p-4 text-xs text-muted-foreground">
        {isTestMode
          ? <>Perfil de homologação: <strong className="text-foreground">{user?.email ?? "usuário de teste"}</strong>. O token da Management API fica somente no Worker e nunca é enviado ao navegador.</>
          : <>Conta técnica: <strong className="text-foreground">{user?.email ?? "usuário autenticado"}</strong>. Este perfil abre somente este painel.</>}
      </section>

      {error ? <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">{error}</div> : null}

      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <UsageCard label="Banco de dados" value={snapshot ? formatBytes(snapshot.database_bytes) : loading ? "Carregando..." : "—"} note="Tamanho atual do PostgreSQL" icon={<Database />} />
        <UsageCard label="Storage" value={snapshot ? formatBytes(snapshot.storage_bytes) : loading ? "Carregando..." : "—"} note="Espaço ocupado pelos arquivos" icon={<HardDrive />} />
        <UsageCard label="Arquivos" value={snapshot ? snapshot.storage_objects.toLocaleString("pt-BR") : loading ? "Carregando..." : "—"} note="Quantidade de objetos armazenados" icon={<FileArchive />} />
        <UsageCard label="Usuários" value={snapshot ? snapshot.auth_users.toLocaleString("pt-BR") : loading ? "Carregando..." : "—"} note={snapshot ? `${snapshot.active_users_month.toLocaleString("pt-BR")} ativo(s) neste mês` : "Contas do Auth"} icon={<Users />} />
        <UsageCard
          label="Requisições API"
          value={snapshot ? snapshot.api_requests.toLocaleString("pt-BR") : loading ? "Carregando..." : "—"}
          note={snapshot ? `Auth ${snapshot.auth_requests.toLocaleString("pt-BR")} • REST ${snapshot.rest_requests.toLocaleString("pt-BR")} • Storage ${snapshot.storage_requests.toLocaleString("pt-BR")} • Realtime ${snapshot.realtime_requests.toLocaleString("pt-BR")}` : "Uso retornado pela Management API"}
          icon={<Activity />}
        />
        <UsageCard
          label="Disco"
          value={snapshot ? (snapshot.disk_total_bytes > 0 ? `${formatBytes(snapshot.disk_used_bytes)} / ${formatBytes(snapshot.disk_total_bytes)}` : snapshot.disk_size_gb ? `${snapshot.disk_size_gb.toLocaleString("pt-BR")} GB` : "—") : loading ? "Carregando..." : "—"}
          note={snapshot?.disk_usage_percent != null ? `${snapshot.disk_usage_percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% utilizado` : "Capacidade do banco"}
          icon={<HardDrive />}
        />
      </section>

      {snapshot ? <p className="mt-4 text-right text-[10px] text-muted-foreground">Atualizado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(snapshot.generated_at))}</p> : null}
    </div>
  );

  if (embedded) return content;
  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">{content}</main>;
}
