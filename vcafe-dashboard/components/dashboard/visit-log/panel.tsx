"use client";

import { useEffect, useState } from "react";
import type { MaidVisitLog } from "@/lib/types";
import { downloadCsv } from "@/lib/csv";
import VisitLogTable from "./table";

// 個別ログを取得して表示する（メイド個別／ユーザー個別で共通）。
export default function VisitLogPanel({ start, end, maidId, customerId, hideMaid, hideCustomer, exportName, serveMinutes }: { start: string; end: string; maidId?: string; customerId?: string; hideMaid?: boolean; hideCustomer?: boolean; exportName: string; serveMinutes?: number | null }) {
  const [logs, setLogs] = useState<MaidVisitLog[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!maidId && !customerId) { setLogs(null); return; }
    const controller = new AbortController();
    setLogs(null); setError("");
    const params = new URLSearchParams({ start, end });
    if (maidId) params.set("maidId", maidId);
    if (customerId) params.set("customerId", customerId);
    fetch(`/api/visit-logs?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "ご帰宅明細を取得できませんでした"); setLogs(body.logs || []); })
      .catch((e) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "ご帰宅明細を取得できませんでした"); });
    return () => controller.abort();
  }, [start, end, maidId, customerId]);
  if (error) return <p className="error">{error}</p>;
  if (!maidId && !customerId) return <p className="muted">対象を選択してください</p>;
  if (!logs) return <p className="muted">読込中…</p>;
  return <VisitLogTable logs={logs} hideMaid={hideMaid} hideCustomer={hideCustomer} onExport={downloadCsv} exportName={exportName} serveMinutes={serveMinutes} />;
}
