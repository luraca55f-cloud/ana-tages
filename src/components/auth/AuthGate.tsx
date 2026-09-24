import type { User } from "@supabase/supabase-js";
import { LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui/button";
import { idleTimeoutMinutes, isSupabaseConfigured, supabase, turnstileSiteKey } from "../../lib/supabase";

type AuthContextValue = {
  user: User | null;
  signOut: () => Promise<void>;
};

type MfaStage = "checking" | "required" | "enroll" | "ready";

type TurnstileApi = {
  render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; theme: "auto" }) => string;
  reset: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  signOut: async () => undefined,
});

export function useAuth() {
  return useContext(AuthContext);
}

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!turnstileSiteKey || !ref.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !ref.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: turnstileSiteKey,
        callback: onToken,
        "expired-callback": () => onToken(""),
        theme: "auto",
      });
    };
    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>('script[data-tages-turnstile="true"]');
      if (existing) existing.addEventListener("load", render, { once: true });
      else {
        const script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.tagesTurnstile = "true";
        script.addEventListener("load", render, { once: true });
        document.head.appendChild(script);
      }
    }
    return () => { cancelled = true; };
  }, [onToken]);

  if (!turnstileSiteKey) return null;
  return <div className="mt-4 min-h-[65px]" ref={ref} />;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [mfaStage, setMfaStage] = useState<MfaStage>("checking");
  const [factorId, setFactorId] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const failedLogins = useRef(0);
  const blockedUntil = useRef(0);

  const resolveMfa = useCallback(async () => {
    if (!supabase) return;
    setMfaStage("checking");
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) {
      setError("Não foi possível validar a autenticação em duas etapas.");
      setMfaStage("required");
      return;
    }
    if (aal.currentLevel === "aal2") {
      setMfaStage("ready");
      return;
    }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) {
      setError("Não foi possível verificar o autenticador.");
      setMfaStage("required");
      return;
    }
    const verified = factors.totp.find((factor) => factor.status === "verified");
    if (verified) {
      setFactorId(verified.id);
      setMfaStage("required");
    } else {
      setFactorId("");
      setMfaStage("enroll");
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const currentUser = data.session?.user ?? null;
      setUser(currentUser);
      setLoading(false);
      if (currentUser) await resolveMfa();
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
      if (!session) setMfaStage("checking");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [resolveMfa]);

  useEffect(() => {
    if (!user || mfaStage !== "ready" || !supabase) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void supabase.auth.signOut(); }, idleTimeoutMinutes * 60_000);
    };
    const events = ["pointerdown", "keydown", "mousemove", "touchstart"] as const;
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [user, mfaStage]);

  useEffect(() => {
    if (!user || mfaStage !== "ready" || !supabase) return;
    let active = true;
    const verifyServerSession = async () => {
      const { data, error: verifyError } = await supabase.auth.getUser();
      if (!active) return;
      if (verifyError || !data.user) await supabase.auth.signOut({ scope: "local" });
    };
    const interval = window.setInterval(() => { void verifyServerSession(); }, 5 * 60_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user, mfaStage]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      signOut: async () => {
        if (supabase) await supabase.auth.signOut({ scope: "local" });
      },
    }),
    [user],
  );

  if (loading) return <CenteredCard icon={<ShieldCheck className="size-5" />} title="Carregando ambiente seguro..." />;

  if (!isSupabaseConfigured) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
        <section className="dashboard-card w-full max-w-lg rounded-3xl p-7">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent"><LockKeyhole className="size-5" /></span>
          <h1 className="mt-5 font-display text-2xl">Configuração do Supabase pendente</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Configure <strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_PUBLISHABLE_KEY</strong> antes de publicar.</p>
        </section>
      </main>
    );
  }

  if (isSupabaseConfigured && !user) {
    const login = async () => {
      if (!supabase || !email.trim() || !password) return;
      if (Date.now() < blockedUntil.current) {
        setError("Muitas tentativas. Aguarde alguns segundos antes de tentar novamente.");
        return;
      }
      if (turnstileSiteKey && !captchaToken) {
        setError("Conclua a verificação anti-robô.");
        return;
      }
      setSubmitting(true);
      setError("");
      const credentials = {
        email: email.trim(),
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      };
      const { data, error: loginError } = await supabase.auth.signInWithPassword(credentials);
      setPassword("");
      setCaptchaToken("");
      window.turnstile?.reset();
      if (loginError || !data.user) {
        failedLogins.current += 1;
        if (failedLogins.current >= 5) blockedUntil.current = Date.now() + 30_000;
        setError("Não foi possível entrar. Confira as credenciais e tente novamente.");
      } else {
        failedLogins.current = 0;
        await resolveMfa();
      }
      setSubmitting(false);
    };

    return (
      <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
        <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
          <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-primary font-display text-sm font-bold text-primary-foreground">AK</span><div><p className="text-sm font-semibold">Anna Karina Dias</p><p className="mt-0.5 text-[11px] text-muted-foreground">Acesso administrativo protegido</p></div></div>
          <h1 className="mt-7 font-display text-2xl">Entrar no consultório</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Após a senha, o autenticador será obrigatório.</p>
          <div className="mt-6 space-y-4">
            <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">E-mail</span><input value={email} onChange={(event) => setEmail(event.target.value.slice(0, 254))} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="email" /></label>
            <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Senha</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void login(); }} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="current-password" /></label>
          </div>
          <TurnstileWidget onToken={setCaptchaToken} />
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          <Button variant="dashboard" className="mt-6 w-full" onClick={() => void login()} disabled={submitting || !email.trim() || !password || Boolean(turnstileSiteKey && !captchaToken)}><LogIn /> {submitting ? "Entrando..." : "Entrar"}</Button>
        </section>
      </main>
    );
  }

  if (isSupabaseConfigured && user && mfaStage !== "ready") {
    const startEnroll = async () => {
      if (!supabase) return;
      setError("");
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "TAGES Consultório" });
      if (enrollError) { setError("Não foi possível iniciar o autenticador."); return; }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    };
    const verify = async () => {
      if (!supabase || !factorId || !/^\d{6}$/.test(mfaCode)) { setError("Informe o código de 6 dígitos."); return; }
      setSubmitting(true);
      setError("");
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: mfaCode });
      setMfaCode("");
      if (verifyError) {
        setError("Código inválido ou expirado.");
        setSubmitting(false);
        return;
      }
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        setError("Não foi possível atualizar a sessão segura. Entre novamente.");
        setSubmitting(false);
        return;
      }
      setQr("");
      setSecret("");
      await resolveMfa();
      setSubmitting(false);
    };
    const qrSrc = qr.startsWith("<svg") ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}` : qr;
    return (
      <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
        <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheck className="size-5" /></span>
          <h1 className="mt-5 font-display text-2xl">Verificação em duas etapas</h1>
          {mfaStage === "checking" && <p className="mt-3 text-sm text-muted-foreground">Verificando o nível de autenticação...</p>}
          {mfaStage === "required" && <><p className="mt-3 text-sm text-muted-foreground">Digite o código atual do aplicativo autenticador.</p><input autoFocus inputMode="numeric" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") void verify(); }} className="mt-5 h-12 w-full rounded-xl border border-border bg-background px-4 text-center font-mono text-xl tracking-[0.45em]" placeholder="000000" /><Button variant="dashboard" className="mt-4 w-full" disabled={submitting || mfaCode.length !== 6} onClick={() => void verify()}>Confirmar código</Button></>}
          {mfaStage === "enroll" && <>{!qr ? <><p className="mt-3 text-sm text-muted-foreground">Por segurança, configure o Google Authenticator antes de usar o sistema.</p><Button variant="dashboard" className="mt-5 w-full" onClick={() => void startEnroll()}>Configurar autenticador</Button></> : <><p className="mt-3 text-sm text-muted-foreground">Escaneie o QR Code e guarde a chave de recuperação em local seguro.</p><img src={qrSrc} alt="QR Code do autenticador" className="mx-auto mt-4 size-44 rounded-xl bg-white p-2" /><p className="mt-3 break-all text-[10px] text-muted-foreground">Chave manual: {secret}</p><input inputMode="numeric" maxLength={6} value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} className="mt-4 h-12 w-full rounded-xl border border-border bg-background px-4 text-center font-mono text-xl tracking-[0.45em]" placeholder="000000" /><Button variant="dashboard" className="mt-4 w-full" disabled={submitting || mfaCode.length !== 6} onClick={() => void verify()}>Ativar e continuar</Button></>}</>}
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          <Button variant="ghost" className="mt-3 w-full" onClick={() => void supabase?.auth.signOut({ scope: "local" })}>Sair</Button>
        </section>
      </main>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function CenteredCard({ icon, title }: { icon: ReactNode; title: string }) {
  return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground"><div className="dashboard-card w-full max-w-sm rounded-3xl p-7 text-center"><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent">{icon}</span><p className="mt-4 font-display text-lg">{title}</p></div></main>;
}
