"use client";

import { useState } from "react";

export function AdminLogin({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || state === "loading") return;
    setState("loading");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error();
      window.location.reload();
    } catch {
      setState("error");
    }
  }

  return (
    <form className="admin-login" onSubmit={submit}>
      <div className="al-card">
        <div className="al-emoji">🔒</div>
        <h2>Admin access</h2>
        <p>{configured ? "Enter the admin password to continue." : "Set ADMIN_PASSWORD to enable this page."}</p>
        <input
          className="fb-email"
          type="password"
          placeholder="Password"
          value={password}
          autoFocus
          disabled={!configured}
          onChange={(e) => {
            setPassword(e.target.value);
            if (state === "error") setState("idle");
          }}
        />
        {state === "error" && <div className="fb-err">Wrong password. Try again.</div>}
        <button className="cta" type="submit" disabled={!configured || !password || state === "loading"}>
          {state === "loading" ? "Checking…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}

export function AdminLogout() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/admin/login", { method: "DELETE" });
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }
  return (
    <button className="acct-link" onClick={logout} disabled={busy}>
      {busy ? "…" : "Sign out"}
    </button>
  );
}
