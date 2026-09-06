import { CheckCircle2, LoaderCircle, Radio, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { useAuthMutations } from "../use-auth-mutations";
import { authProvidersQueryOptions } from "../queries";

type Mode = "sign-in" | "sign-up" | "forgot" | "reset" | "verify";

export function AuthScreen() {
  const resetToken = useMemo(() => new URLSearchParams(location.search).get("token"), []);
  const initialError = useMemo(() => {
    const params = new URLSearchParams(location.search);
    if (params.has("oauth_error")) return "That social sign-in could not be completed. Try again.";
    if (params.has("error")) return "That email link is invalid or has expired.";
    return null;
  }, []);
  const [mode, setMode] = useState<Mode>(location.pathname === "/reset-password" ? "reset" : "sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(
    new URLSearchParams(location.search).has("verified") ? "Email verified. Welcome to Liner Radio." : null,
  );
  const [clientError, setClientError] = useState<string | null>(initialError);
  const auth = useAuthMutations();
  const providers = useQuery(authProvidersQueryOptions());
  const activeMutation =
    mode === "sign-up"
      ? auth.signUp
      : mode === "forgot"
        ? auth.requestPasswordReset
        : mode === "reset"
          ? auth.resetPassword
          : mode === "verify"
            ? auth.sendVerification
            : auth.signIn;
  const busy = activeMutation.isPending || auth.socialSignIn.isPending;
  const error = activeMutation.error?.message || auth.socialSignIn.error?.message || clientError;

  function clearFeedback() {
    activeMutation.reset();
    auth.socialSignIn.reset();
    setNotice(null);
    setClientError(null);
  }

  function changeMode(next: Mode) {
    clearFeedback();
    setMode(next);
    setPassword("");
    setConfirmPassword("");
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    clearFeedback();
    if (mode === "sign-up") {
      auth.signUp.mutate(
        { name: name.trim(), email: email.trim(), password },
        { onSuccess: () => setMode("verify") },
      );
    } else if (mode === "forgot") {
      auth.requestPasswordReset.mutate(email.trim(), {
        onSuccess: () => setNotice("If that address has an account, a reset link is on its way."),
      });
    } else if (mode === "verify") {
      auth.sendVerification.mutate(email.trim(), {
        onSuccess: () => setNotice("A fresh verification link is on its way."),
      });
    } else if (mode === "reset") {
      if (!resetToken) return setClientError("This reset link is invalid or has expired.");
      if (password !== confirmPassword) return setClientError("The new passwords do not match.");
      auth.resetPassword.mutate(
        { token: resetToken, newPassword: password },
        {
          onSuccess: () => {
            history.replaceState(null, "", "/");
            setMode("sign-in");
            setPassword("");
            setConfirmPassword("");
            setNotice("Password changed. You can sign in now.");
          },
        },
      );
    } else {
      auth.signIn.mutate(
        { email: email.trim(), password },
        { onError: (signInError) => /verif/i.test(signInError.message) && setMode("verify") },
      );
    }
  }

  const title = {
    "sign-in": "Welcome back",
    "sign-up": "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password",
    verify: "Check your inbox",
  }[mode];

  return (
    <main className="auth-screen">
      <section className="auth-intro">
        <a className="brand brand-light" href="/" aria-label="Liner Radio home">
          <Radio /><span>liner</span><strong>RADIO</strong>
        </a>
        <div>
          <p className="eyebrow">THE LISTENING ROOM</p>
          <h1>Pass the music around.</h1>
          <p>One host, one programme, and a room full of good recommendations.</p>
        </div>
        <small>Independent listening rooms</small>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <p className="eyebrow">YOUR SEAT IN THE ROOM</p>
          <h2>{title}</h2>
          <p className="auth-copy">
            {mode === "sign-in" && "Sign in to host a room or make a request."}
            {mode === "sign-up" && "Start a room and invite the people whose taste you trust."}
            {mode === "forgot" && "Enter your email and we’ll send a secure reset link."}
            {mode === "reset" && "Use at least eight characters for your new password."}
            {mode === "verify" && `We sent a verification link to ${email || "your email address"}.`}
          </p>

          {error && (
            <div className="inline-error" role="alert">
              {error}<button type="button" onClick={clearFeedback} aria-label="Dismiss error"><X size={16} /></button>
            </div>
          )}
          {notice && <div className="inline-success" role="status"><CheckCircle2 size={17} />{notice}</div>}

          {(mode === "sign-in" || mode === "sign-up") && providers.data?.google && (
            <>
              <div className="provider-buttons">
                {providers.data.google && <button type="button" onClick={() => auth.socialSignIn.mutate("google")} disabled={busy}>
                  <span className="provider-mark provider-google" aria-hidden="true">G</span>Continue with Google
                </button>}
              </div>
              <div className="auth-divider"><span>or continue with email</span></div>
            </>
          )}

          {mode === "sign-up" && <label>Display name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label>}
          {(mode === "sign-in" || mode === "sign-up" || mode === "forgot" || mode === "verify") && <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>}
          {(mode === "sign-in" || mode === "sign-up" || mode === "reset") && <label>Password<input type="password" autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></label>}
          {mode === "reset" && <label>Confirm password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} required /></label>}

          <button className="primary-button" disabled={busy || (mode === "reset" && !resetToken)}>
            {busy && <LoaderCircle className="spin" size={17} />}
            {mode === "sign-in" && "Sign in"}{mode === "sign-up" && "Create account"}{mode === "forgot" && "Send reset link"}{mode === "reset" && "Save new password"}{mode === "verify" && "Resend verification email"}
          </button>
          {mode === "sign-in" && <button className="text-action" type="button" onClick={() => changeMode("forgot")}>Forgot your password?</button>}
          <button className="text-action" type="button" onClick={() => changeMode(mode === "sign-up" ? "sign-in" : mode === "sign-in" ? "sign-up" : "sign-in")}>
            {mode === "sign-up" ? "Already have an account? Sign in" : mode === "sign-in" ? "New here? Create an account" : "Back to sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
