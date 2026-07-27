"use client";

import { FormEvent, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(""); setSubmitting(true);
    try {
      const firebase = getApps()[0] || initializeApp({ apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID });
      const credential = await signInWithEmailAndPassword(getAuth(firebase), email, password);
      const idToken = await credential.user.getIdToken();
      const response = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
      if (!response.ok) throw new Error("このアプリを利用する権限がありません");
      location.href = "/";
    } catch (e) { setError(e instanceof Error ? e.message : "ログインできませんでした"); setSubmitting(false); }
  }
  return <main className="login-shell"><form className="login-card" onSubmit={submit}><img className="brand-logo" src="/logo.png" alt="Virtual at-home cafe" onError={(e) => { const img = e.currentTarget; img.style.display = "none"; const fb = img.nextElementSibling as HTMLElement | null; if (fb) fb.style.display = "grid"; }} /><div className="brand-mark" style={{ display: "none" }}>at</div><p className="eyebrow">VIRTUAL AT-HOME CAFÉ</p><h1>運営アナリティクス</h1><p className="muted">管理者またはメイドアカウントでログイン</p><label>メールアドレス<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={submitting} required /></label><label>パスワード<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={submitting} required /></label>{error && <p className="error">{error}</p>}<button className="primary full" type="submit" disabled={submitting}>{submitting ? "ログイン中…" : "ログイン"}</button></form></main>;
}
