"use client";

import { useEffect, useState } from "react";
import type { AttendanceSubmission, Viewer, ViewerScopedData } from "@/lib/types";
import type { GrowthMetrics } from "@/lib/growth";

/**
 * ダッシュボードのデータ取得をまとめたフック。
 *
 * UI状態（選択中のタブ・並び順など）は含めない。画面の状態管理と取得処理が
 * 同じ useEffect 群に混在していると、片方を触ったときにもう片方が壊れるため。
 *
 * 現状は AnalyticsData 全件を取得する設計で、データ量に比例して重くなる。
 * 画面別・ページング付きAPIへの移行計画は docs/dashboard-api-plan.md を参照。
 */
export function useAnalyticsData({ initialData, initialStart, initialEnd, viewer, start, end, maidId }: {
  initialData: ViewerScopedData;
  initialStart: string;
  initialEnd: string;
  viewer: Viewer;
  start: string;
  end: string;
  maidId: string;
}) {
  const [remoteData, setRemoteData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const initialMaidId = viewer.role === "maid" ? viewer.maidId || "" : "";
    // 初期表示と同じ条件なら SSR 済みのデータをそのまま使う（無駄な再取得を避ける）。
    if (start === initialStart && end === initialEnd && maidId === initialMaidId) { setRemoteData(initialData); return; }
    const controller = new AbortController();
    // 日付入力の連続変更で毎回叩かないよう 250ms 待つ。
    const timer = window.setTimeout(async () => {
      setLoading(true); setLoadError("");
      try {
        const params = new URLSearchParams({ start, end }); if (maidId) params.set("maidId", maidId);
        const response = await fetch(`/api/analytics?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error((await response.json()).error || "データを取得できませんでした");
        setRemoteData(await response.json());
      } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "データを取得できませんでした"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [start, end, maidId, initialStart, initialEnd, initialData, viewer.role, viewer.maidId]);

  return { remoteData, loading, loadError };
}

/** グロース指標。管理者のみが取得する。 */
export function useGrowthMetrics({ viewer, start, end }: { viewer: Viewer; start: string; end: string }) {
  const [growth, setGrowth] = useState<GrowthMetrics | null>(null);
  const [growthLoading, setGrowthLoading] = useState(false);
  const [growthError, setGrowthError] = useState("");

  useEffect(() => {
    if (viewer.role !== "admin") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGrowthLoading(true); setGrowthError("");
      try {
        const response = await fetch(`/api/growth?${new URLSearchParams({ start, end })}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error((await response.json()).error || "グロース指標を取得できませんでした");
        setGrowth(await response.json());
      } catch (error) { if (!controller.signal.aborted) setGrowthError(error instanceof Error ? error.message : "グロース指標を取得できませんでした"); }
      finally { if (!controller.signal.aborted) setGrowthLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [start, end, viewer.role]);

  return { growth, growthLoading, growthError };
}

/** Discord勤怠申請。確認用一覧で、シフト本体には反映しない。 */
export function useAttendanceSubmissions(viewer: Viewer) {
  const [submissions, setSubmissions] = useState<AttendanceSubmission[]>([]);
  const [submissionError, setSubmissionError] = useState("");

  useEffect(() => {
    if (viewer.role !== "admin") return;
    const controller = new AbortController();
    fetch("/api/attendance-submissions", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Discord勤怠申請を取得できませんでした");
        setSubmissions(body.submissions || []);
      })
      .catch((error) => { if (!controller.signal.aborted) setSubmissionError(error instanceof Error ? error.message : "Discord勤怠申請を取得できませんでした"); });
    return () => controller.abort();
  }, [viewer.role]);

  return { submissions, submissionError };
}
