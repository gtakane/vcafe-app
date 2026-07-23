"use client";

import { useState } from "react";
import { getApps } from "firebase/app";
import { getAuth, signOut } from "firebase/auth";

export default function LogoutButton() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" });
      const firebase = getApps()[0];
      if (firebase) await signOut(getAuth(firebase));
    } finally {
      window.location.assign("/login");
    }
  }

  return <button className="secondary" type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? "終了中…" : "ログアウト"}</button>;
}
