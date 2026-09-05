import { LoaderCircle, Radio, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useAuthMutations } from "../use-auth-mutations";

export function AuthScreen() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { signIn, signUp } = useAuthMutations();
  const busy = signIn.isPending || signUp.isPending;
  const activeMutation = mode === "sign-up" ? signUp : signIn;
  const error = activeMutation.error?.message;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "sign-up") signUp.mutate({ name, email, password });
    else signIn.mutate({ email, password });
  }

  return (
    <main className="auth-screen">
      <section className="auth-intro">
        <a className="brand brand-light" href="/" aria-label="Liner Radio home">
          <Radio />
          <span>liner</span>
          <strong>RADIO</strong>
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
          <h2>{mode === "sign-in" ? "Welcome back" : "Create your account"}</h2>
          <p className="auth-copy">
            {mode === "sign-in"
              ? "Sign in to host a room or make a request."
              : "Start a room and invite the people whose taste you trust."}
          </p>

          {error && (
            <div className="inline-error" role="alert">
              {error}
              <button type="button" onClick={() => activeMutation.reset()} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}

          {mode === "sign-up" && (
            <label>
              Display name
              <input
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          <button className="primary-button" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={17} />}
            {mode === "sign-in" ? "Sign in" : "Create account"}
          </button>
          <button
            className="text-action"
            type="button"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              signIn.reset();
              signUp.reset();
            }}
          >
            {mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
