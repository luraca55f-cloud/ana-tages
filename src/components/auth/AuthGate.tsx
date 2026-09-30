import type { User } from "@supabase/supabase-js";
import { CheckCircle2, Circle, Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
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

function PasswordRequirements({
  password,
  confirmPassword,
  temporaryPassword,
}: {
  password: string;
  confirmPassword: string;
  temporaryPassword?: string;
}) {
  const checks = [
    { label: "Pelo menos 8 caracteres", ok: password.length >= 8 },
    { label: "Pelo menos 1 letra", ok: /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(password) },
    { label: "Pelo menos 1 número", ok: /\d/.test(password) },
    ...(temporaryPassword ? [{ label: "Diferente da senha temporária", ok: password.length > 0 && password !== temporaryPassword }] : []),
    { label: "As duas senhas são iguais", ok: confirmPassword.length > 0 && password === confirmPassword },
  ];

  return (
    <div className="rounded-2xl border border-border/70 bg-muted/25 p-3">
      <p className="text-[11px] font-semibold text-foreground">Requisitos da senha</p>
      <div className="mt-2 space-y-1.5">
        {checks.map((check) => (
          <div key={check.label} className={`flex items-center gap-2 text-xs ${check.ok ? "text-primary" : "text-muted-foreground"}`}>
            {check.ok ? <CheckCircle2 className="size-3.5 shrink-0" /> : <Circle className="size-3.5 shrink-0" />}
            <span>{check.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
        script.dataset["tagesTurnstile"] = "true";
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "forgot" | "reset" | "vault-recovery">("login");
  const [notice, setNotice] = useState("");
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
  // Mantém a senha temporária somente em memória durante o primeiro acesso.
  // Nunca é persistida em storage ou enviada ao banco além do login normal do Supabase.
  const temporaryPasswordRef = useRef("");

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

    const client = supabase;
    let active = true;
    const recoveryUrl = new URL(window.location.href);
    const recoveryMode = recoveryUrl.searchParams.get("mode");
    const recoveryRequested = recoveryMode === "recovery" || recoveryMode === "vault-recovery";
    const vaultRecoveryRequested = recoveryMode === "vault-recovery";
    const recoveryCode = recoveryUrl.searchParams.get("code");

    const clearRecoveryUrl = () => {
      const clean = new URL(window.location.href);
      clean.searchParams.delete("code");
      clean.searchParams.delete("mode");
      clean.hash = "";
      window.history.replaceState({}, "", `${clean.pathname}${clean.search}`);
    };

    // A recuperação usa PKCE com detectSessionInUrl=false. Portanto o código retornado
    // pelo Supabase precisa ser trocado explicitamente por uma sessão. Como o projeto
    // exige MFA/AAL2 para alteração de senha, a sessão de recuperação entra primeiro na
    // confirmação do Google Authenticator e só depois libera "Definir nova senha".
    const initialize = async () => {
      if (recoveryRequested && recoveryCode) {
        const { data: recovered, error: exchangeError } = await client.auth.exchangeCodeForSession(recoveryCode);
        if (!active) return;

        if (exchangeError || !recovered.user) {
          console.error("Password recovery exchange failed", exchangeError);
          clearRecoveryUrl();
          setUser(null);
          setAuthMode("forgot");
          setError("Este link de recuperação é inválido ou expirou. Solicite um novo link.");
          setLoading(false);
          return;
        }

        clearRecoveryUrl();
        setUser(recovered.user);
        setAuthMode(vaultRecoveryRequested ? "vault-recovery" : "reset");
        setError("");
        setNotice("");
        setLoading(false);
        await resolveMfa();
        return;
      }

      const { data } = await client.auth.getSession();
      if (!active) return;
      const currentUser = data.session?.user ?? null;
      setUser(currentUser);
      setLoading(false);
      if (currentUser) await resolveMfa();
    };

    const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("reset");
        setError("");
        setNotice("");
        void resolveMfa();
        return;
      }

      if (!session) {
        setMfaStage("checking");
        setAuthMode((current) => (current === "reset" || current === "vault-recovery") ? "login" : current);
      }
    });

    void initialize();

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [resolveMfa]);

  useEffect(() => {
    if (!user || mfaStage !== "ready" || !supabase) return;
    const client = supabase;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void client.auth.signOut(); }, idleTimeoutMinutes * 60_000);
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
    const client = supabase;
    let active = true;
    const verifyServerSession = async () => {
      const { data, error: verifyError } = await client.auth.getUser();
      if (!active) return;
      if (verifyError || !data.user) await client.auth.signOut({ scope: "local" });
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
          <h1 className="mt-5 font-display text-2xl">Configuração do sistema pendente</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">Configure <strong>VITE_SUPABASE_URL</strong> e <strong>VITE_SUPABASE_PUBLISHABLE_KEY</strong> antes de publicar.</p>
        </section>
      </main>
    );
  }

  if (isSupabaseConfigured && user && (authMode === "reset" || authMode === "vault-recovery")) {
    const verifyRecoveryMfa = async () => {
      if (!supabase || !factorId || !/^\d{6}$/.test(mfaCode)) {
        setError("Informe o código de 6 dígitos do Google Authenticator.");
        return;
      }
      setSubmitting(true);
      setError("");
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: mfaCode });
      setMfaCode("");
      if (verifyError) {
        setError("Código do Google Authenticator inválido ou expirado.");
        setSubmitting(false);
        return;
      }
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        setError("Não foi possível elevar a sessão para o nível seguro exigido. Solicite um novo link de recuperação.");
        setSubmitting(false);
        return;
      }
      await resolveMfa();
      setSubmitting(false);
    };

    const cancelRecovery = async () => {
      if (supabase) await supabase.auth.signOut({ scope: "local" });
      setPassword("");
      setConfirmPassword("");
      setMfaCode("");
      setError("");
      setNotice("");
      setAuthMode("login");
      setMfaStage("checking");
    };

    const saveNewPassword = async () => {
      if (!supabase || mfaStage !== "ready") {
        setError("Confirme o Google Authenticator antes de definir a nova senha.");
        return;
      }
      if (!password || password !== confirmPassword) {
        setError("Informe a nova senha e repita exatamente o mesmo valor.");
        return;
      }
      if (password.length < 8 || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(password) || !/\d/.test(password)) {
        setError("A senha ainda não cumpre todos os requisitos indicados abaixo.");
        return;
      }
      setSubmitting(true);
      setError("");
      setNotice("");
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        const normalized = updateError.message.toLowerCase();
        if (normalized.includes("aal2") || normalized.includes("mfa")) {
          setError("A confirmação do Google Authenticator expirou. Confirme o código novamente e tente salvar.");
          await resolveMfa();
        } else {
          setError(updateError.message || "Não foi possível atualizar a senha.");
        }
        setSubmitting(false);
        return;
      }
      window.history.replaceState({}, "", window.location.pathname);
      await supabase.auth.signOut({ scope: "local" });
      setPassword("");
      setConfirmPassword("");
      setMfaCode("");
      setAuthMode("login");
      setMfaStage("checking");
      setNotice("Senha alterada. Entre novamente com a nova senha e confirme o Google Authenticator.");
      setSubmitting(false);
    };

    if (mfaStage !== "ready") {
      return (
        <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
          <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheck className="size-5" /></span>
            <h1 className="mt-5 font-display text-2xl">Confirmar identidade</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {authMode === "vault-recovery"
                ? "O link recebido no e-mail confirmou a conta. Para liberar a recuperação do cofre, confirme também o código atual do Google Authenticator."
                : "O link de recuperação já identifica a conta cadastrada. Para autorizar a troca da senha, confirme também o código atual do Google Authenticator."}
            </p>
            {user.email && <p className="mt-3 text-xs text-muted-foreground">Conta: <strong>{user.email}</strong></p>}
            {mfaStage === "checking" && <p className="mt-5 text-sm text-muted-foreground">Verificando a autenticação em duas etapas...</p>}
            {mfaStage === "required" && (
              <>
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))}
                  onKeyDown={(event) => { if (event.key === "Enter") void verifyRecoveryMfa(); }}
                  className="mt-5 h-12 w-full rounded-xl border border-border bg-background px-4 text-center font-mono text-xl tracking-[0.45em]"
                  placeholder="000000"
                />
                <Button variant="dashboard" className="mt-4 w-full" disabled={submitting || mfaCode.length !== 6} onClick={() => void verifyRecoveryMfa()}>
                  {submitting ? "Confirmando..." : "Confirmar código"}
                </Button>
              </>
            )}
            {mfaStage === "enroll" && (
              <p className="mt-5 text-sm text-destructive">
                Esta conta não possui um autenticador verificado. Por segurança, a redefinição de senha não pode continuar por este fluxo.
              </p>
            )}
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <Button variant="ghost" className="mt-3 w-full" onClick={() => void cancelRecovery()}>Cancelar recuperação</Button>
          </section>
        </main>
      );
    }

    if (authMode === "vault-recovery") {
      const continueVaultRecovery = () => {
        window.sessionStorage.setItem("tages:vault-email-recovery-authorized", "1");
        setAuthMode("login");
        setError("");
        setNotice("");
      };
      return (
        <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
          <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheck className="size-5" /></span>
            <h1 className="mt-5 font-display text-2xl">Recuperação do cofre autorizada</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">E-mail e Google Authenticator confirmados. Continue para definir uma nova senha do cofre clínico.</p>
            {user.email && <p className="mt-3 text-xs text-muted-foreground">Conta: <strong>{user.email}</strong></p>}
            <Button variant="dashboard" className="mt-6 w-full" onClick={continueVaultRecovery}>Continuar para o cofre</Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => void cancelRecovery()}>Cancelar</Button>
          </section>
        </main>
      );
    }

    return (
      <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
        <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent"><LockKeyhole className="size-5" /></span>
          <h1 className="mt-5 font-display text-2xl">Definir nova senha</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            E-mail e Google Authenticator confirmados. Agora crie a nova senha de acesso.
          </p>
          {user.email && <p className="mt-3 text-xs text-muted-foreground">Conta: <strong>{user.email}</strong></p>}
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Nova senha</span>
              <span className="relative block">
                <input autoFocus type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="new-password" />
                <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Repita a nova senha</span>
              <span className="relative block">
                <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveNewPassword(); }} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="new-password" />
                <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition hover:text-foreground" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? "Ocultar confirmação da senha" : "Mostrar confirmação da senha"} title={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}>{showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </span>
            </label>
            <PasswordRequirements password={password} confirmPassword={confirmPassword} />
          </div>
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          <Button variant="dashboard" className="mt-6 w-full" onClick={() => void saveNewPassword()} disabled={submitting || !password || !confirmPassword}>{submitting ? "Salvando..." : "Salvar nova senha"}</Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => void cancelRecovery()}>Cancelar</Button>
        </section>
      </main>
    );
  }

  // Contas criadas a partir desta versão recebem `must_change_password=true` por trigger
  // no Supabase. Assim o responsável pode entregar uma senha temporária para a Ana sem
  // deixar essa senha como credencial definitiva. A troca ocorre antes do uso do sistema.
  if (isSupabaseConfigured && user && authMode === "login" && user.user_metadata?.["must_change_password"] === true) {
    const verifyExistingFirstAccessMfa = async () => {
      if (!supabase || !factorId || !/^\d{6}$/.test(mfaCode)) {
        setError("Informe o código de 6 dígitos do Google Authenticator.");
        return;
      }
      setSubmitting(true);
      setError("");
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: mfaCode });
      setMfaCode("");
      if (verifyError) {
        setError("Código do Google Authenticator inválido ou expirado.");
        setSubmitting(false);
        return;
      }
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        setError("Não foi possível atualizar a sessão segura. Entre novamente e tente outra vez.");
        setSubmitting(false);
        return;
      }
      await resolveMfa();
      setSubmitting(false);
    };

    // Uma conta realmente nova ainda não possui fator MFA verificado e pode trocar a senha
    // temporária primeiro, seguindo depois para o cadastro do Google Authenticator. Já uma
    // conta antiga usada para homologar o primeiro acesso pode possuir TOTP verificado; nesse
    // caso o Supabase exige AAL2 antes de permitir updateUser(password). Confirmamos o fator
    // existente aqui sem alterar a experiência das contas novas.
    if (mfaStage === "checking" || mfaStage === "required") {
      return (
        <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
          <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent"><ShieldCheck className="size-5" /></span>
            <h1 className="mt-5 font-display text-2xl">Confirmar primeiro acesso</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Esta conta já possui Google Authenticator cadastrado. Confirme o código atual para autorizar a troca da senha temporária.</p>
            {user.email && <p className="mt-3 text-xs text-muted-foreground">Conta: <strong>{user.email}</strong></p>}
            {mfaStage === "checking" ? (
              <p className="mt-5 text-sm text-muted-foreground">Verificando o autenticador...</p>
            ) : (
              <>
                <input autoFocus inputMode="numeric" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ""))} onKeyDown={(event) => { if (event.key === "Enter") void verifyExistingFirstAccessMfa(); }} className="mt-5 h-12 w-full rounded-xl border border-border bg-background px-4 text-center font-mono text-xl tracking-[0.45em]" placeholder="000000" />
                <Button variant="dashboard" className="mt-4 w-full" disabled={submitting || mfaCode.length !== 6} onClick={() => void verifyExistingFirstAccessMfa()}>{submitting ? "Confirmando..." : "Confirmar código"}</Button>
              </>
            )}
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <Button variant="ghost" className="mt-3 w-full" onClick={() => { if (supabase) void supabase.auth.signOut({ scope: "local" }); }}>Sair</Button>
          </section>
        </main>
      );
    }

    const saveFirstPassword = async () => {
      if (!supabase) return;
      if (!password || password !== confirmPassword) {
        setError("Digite a nova senha e repita exatamente o mesmo valor.");
        return;
      }
      if (password.length < 8 || !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(password) || !/\d/.test(password)) {
        setError("A senha ainda não cumpre todos os requisitos indicados abaixo.");
        return;
      }
      if (temporaryPasswordRef.current && password === temporaryPasswordRef.current) {
        setError("A nova senha deve ser diferente da senha temporária usada para entrar.");
        return;
      }
      setSubmitting(true);
      setError("");
      const nextMetadata = { ...user.user_metadata, must_change_password: false, password_changed_at: new Date().toISOString() };
      const { data, error: updateError } = await supabase.auth.updateUser({ password, data: nextMetadata });
      if (updateError || !data.user) {
        const message = updateError?.message?.toLowerCase() ?? "";
        if (message.includes("aal2") || message.includes("mfa")) {
          setError("Confirme o Google Authenticator para autorizar a troca desta senha temporária.");
          await resolveMfa();
        } else {
          setError(message.includes("password") ? "Não foi possível salvar a nova senha. Use uma senha diferente e tente novamente." : "Não foi possível concluir a troca obrigatória de senha.");
        }
        setSubmitting(false);
        return;
      }
      temporaryPasswordRef.current = "";
      setPassword("");
      setConfirmPassword("");
      setUser(data.user);
      setNotice("Senha pessoal criada. Agora conclua a proteção da conta com o Google Authenticator.");
      await resolveMfa();
      setSubmitting(false);
    };

    return (
      <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
        <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent"><LockKeyhole className="size-5" /></span>
          <h1 className="mt-5 font-display text-2xl">Crie sua nova senha</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Este é o primeiro acesso desta conta. A senha usada para entrar é temporária e deve ser substituída antes de usar o sistema.</p>
          {user.email && <p className="mt-3 text-xs text-muted-foreground">Conta: <strong>{user.email}</strong></p>}
          <div className="mt-6 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Nova senha</span>
              <span className="relative block">
                <input autoFocus type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="new-password" />
                <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Repita a nova senha</span>
              <span className="relative block">
                <input type={showConfirmPassword ? "text" : "password"} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveFirstPassword(); }} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="new-password" />
                <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition hover:text-foreground" onClick={() => setShowConfirmPassword((current) => !current)} aria-label={showConfirmPassword ? "Ocultar confirmação da senha" : "Mostrar confirmação da senha"} title={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}>{showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </span>
            </label>
            <PasswordRequirements
              password={password}
              confirmPassword={confirmPassword}
              {...(temporaryPasswordRef.current ? { temporaryPassword: temporaryPasswordRef.current } : {})}
            />
          </div>
          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
          <Button variant="dashboard" className="mt-6 w-full" disabled={submitting || !password || !confirmPassword} onClick={() => void saveFirstPassword()}>{submitting ? "Salvando..." : "Definir minha senha"}</Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => { if (supabase) void supabase.auth.signOut({ scope: "local" }); }}>Sair</Button>
        </section>
      </main>
    );
  }

  if (isSupabaseConfigured && !user) {
    const requestPasswordReset = async () => {
      if (!supabase || !email.trim()) {
        setError("Informe o e-mail de acesso.");
        return;
      }
      setSubmitting(true);
      setError("");
      setNotice("");
      const redirectTo = `${window.location.origin}${window.location.pathname}?mode=recovery`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
      if (resetError) setError(resetError.message || "Não foi possível iniciar a recuperação de senha.");
      else setNotice("Se este for o e-mail cadastrado na conta, um link seguro de recuperação será enviado. Outros endereços não recebem acesso à redefinição.");
      setSubmitting(false);
    };

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
      temporaryPasswordRef.current = password;
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

    if (authMode === "forgot") {
      return (
        <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
          <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent"><LockKeyhole className="size-5" /></span>
            <h1 className="mt-5 font-display text-2xl">Recuperar senha de acesso</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Informe o e-mail cadastrado na conta. Somente o endereço registrado no Supabase recebe um link válido de redefinição.</p>
            <label className="mt-6 block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">E-mail</span><input autoFocus value={email} onChange={(event) => setEmail(event.target.value.slice(0, 254))} onKeyDown={(event) => { if (event.key === "Enter") void requestPasswordReset(); }} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="email" /></label>
            {notice && <p className="mt-3 text-xs text-primary">{notice}</p>}
            {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
            <Button variant="dashboard" className="mt-6 w-full" onClick={() => void requestPasswordReset()} disabled={submitting || !email.trim()}>{submitting ? "Enviando..." : "Enviar link de recuperação"}</Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => { setAuthMode("login"); setError(""); setNotice(""); }}>Voltar ao login</Button>
          </section>
        </main>
      );
    }

    return (
      <main className="grid min-h-screen place-items-center bg-background p-5 text-foreground">
        <section className="dashboard-card w-full max-w-md rounded-3xl p-7 sm:p-8">
          <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-primary font-display text-sm font-bold text-primary-foreground">AK</span><div><p className="text-sm font-semibold">Anna Karina Dias</p><p className="mt-0.5 text-[11px] text-muted-foreground">Acesso administrativo protegido</p></div></div>
          <h1 className="mt-7 font-display text-2xl">Entrar no consultório</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Após a senha, o autenticador será obrigatório.</p>
          <div className="mt-6 space-y-4">
            <label className="block"><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">E-mail</span><input value={email} onChange={(event) => setEmail(event.target.value.slice(0, 254))} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="email" /></label>
            <label className="block">
              <span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">Senha</span>
              <span className="relative block">
                <input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void login(); }} className="h-11 w-full rounded-xl border border-border bg-background/70 px-3 pr-11 text-sm outline-none focus:ring-2 focus:ring-ring/30" autoComplete="current-password" />
                <button type="button" className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground transition hover:text-foreground" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
              </span>
            </label>
          </div>
          <button type="button" className="mt-3 text-xs font-medium text-primary underline-offset-4 hover:underline" onClick={() => { setAuthMode("forgot"); setError(""); setNotice(""); }}>Esqueci minha senha</button>
          <TurnstileWidget onToken={setCaptchaToken} />
          {notice && <p className="mt-3 text-xs text-primary">{notice}</p>}
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
