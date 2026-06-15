# -*- coding: utf-8 -*-
"""
バーチャルあっとほぉーむカフェ 統合管理アプリ（ローカル版・骨組み）
起動: WezTerm で  streamlit run app.py
"""
import re
from datetime import datetime, date, time
from pathlib import Path

import pandas as pd
import streamlit as st

import core

BASE = Path(__file__).parent
st.set_page_config(page_title="V-Cafe 管理アプリ", page_icon="🎀", layout="wide")

# ---- 秘密情報・環境 ----
secrets = core.load_secrets(BASE)
if "env" not in st.session_state:
    st.session_state.env = "テスト"

# ============================================================
# サイドバー：環境切替 ＋ モジュール選択
# ============================================================
with st.sidebar:
    st.markdown("## 🎀 V-Cafe 管理アプリ")
    st.caption("ローカル版 / 骨組み")

    st.session_state.env = st.radio(
        "環境", ["テスト", "本番"],
        index=0 if st.session_state.env == "テスト" else 1,
        help="本番を選ぶと、本番Firestoreや本番Discordチャンネルが対象になります。",
    )
    if st.session_state.env == "本番":
        st.error("⚠ 本番環境を選択中。書き込み操作は実データに影響します。")
    else:
        st.success("テスト環境を選択中。安全に試せます。")

    st.divider()
    page = st.radio("メニュー", [
        "ホーム",
        "勤怠レポート",
        "お給仕実績",
        "予約通知（準備中）",
        "シフト反映（準備中）",
        "設定",
    ])

IS_PROD = st.session_state.env == "本番"


def prod_banner():
    if IS_PROD:
        st.error("⚠ 本番環境です。実行内容をよく確認してください。")


# ============================================================
# ホーム
# ============================================================
if page == "ホーム":
    st.title("ホーム")
    st.write("各機能はサイドバーから。現在は骨組みで、勤怠レポートの可視化が動きます。")
    c1, c2, c3 = st.columns(3)
    c1.metric("現在の環境", st.session_state.env)
    c2.metric("Discordトークン",
              "設定済み" if secrets.get("discord_bot_token") else "未設定")
    c3.metric("Firebase鍵",
              "設定済み" if secrets.get("firebase_key_path") else "未設定")
    st.info("秘密情報はコードに直書きせず、secrets_local.json または環境変数から読み込みます"
            "（このファイルは Git 管理から除外）。")
    st.subheader("ロードマップ")
    st.markdown(
        "- ✅ 勤怠レポートの可視化（このアプリで完結）\n"
        "- ✅ お給仕実績ダッシュボード（Firestore userRecordVisits / userAlbum）\n"
        "- ⬜ 予約通知（Firestore `reservations` の rsvStatus false→true を検知してDiscord）\n"
        "- ⬜ シフト反映（シフト表 → 本番Firestore、GAS置き換え。dry-run付き）"
    )

# ============================================================
# 勤怠レポート（動作する本体）
# ============================================================
elif page == "勤怠レポート":
    st.title("勤怠レポート")
    st.caption("kintai_report.py が出力した 勤怠レポート_YYYY-MM.xlsx を読み込んで可視化します。")

    up = st.file_uploader("勤怠レポートの .xlsx を選択", type=["xlsx"])
    default = BASE / "data" / "勤怠レポート_2026-06.xlsx"
    src = up if up is not None else (str(default) if default.exists() else None)

    if src is None:
        st.warning("レポートファイルを選択してください（または data/ フォルダに置いてください）。")
        st.stop()

    try:
        summary = core.load_kintai_summary(src)
        detail = core.load_kintai_detail(src)
    except Exception as e:
        st.error(f"読み込みに失敗しました: {e}")
        st.stop()

    kpi = core.summarize_kpis(summary, detail)
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("メイド数", kpi["メイド数"])
    c2.metric("総シフト数", kpi["総シフト数"])
    c3.metric("平均欠勤率", f"{kpi['平均欠勤率']*100:.1f}%")
    c4.metric("当日連絡件数", kpi["当日連絡件数"])

    st.subheader("欠勤率ランキング（シフト数1以上）")
    rank = (summary[summary["シフト数"] > 0]
            .sort_values("欠勤率", ascending=False)
            [["メイド名", "シフト数", "欠勤", "欠勤率"]].head(15))
    chart = rank.set_index("メイド名")["欠勤率"]
    st.bar_chart(chart)

    st.subheader("一覧（クリックで並べ替え）")
    show = summary.copy()
    show["欠勤率"] = (show["欠勤率"] * 100).round(1)
    show["遅刻率"] = (show["遅刻率"] * 100).round(1)
    st.dataframe(show, use_container_width=True, hide_index=True)

    if not detail.empty and "種別" in detail.columns:
        st.subheader("種別ごとの件数")
        st.bar_chart(detail["種別"].value_counts())

    st.download_button(
        "サマリーをCSVで保存", summary.to_csv(index=False).encode("utf-8-sig"),
        file_name="勤怠サマリー.csv", mime="text/csv")

# ============================================================
# お給仕実績（Firestore: userRecordVisits / userAlbum）
# ============================================================
elif page == "お給仕実績":
    st.title("お給仕実績ダッシュボード")
    prod_banner()

    # ---- 期間選択 ----
    today = date.today()
    c1, c2 = st.columns(2)
    start_date = c1.date_input("取得開始日", value=today.replace(day=1))
    end_date = c2.date_input("取得終了日", value=today)

    # ---- データ更新ボタン ----
    col_btn, col_info = st.columns([3, 4])
    with col_btn:
        do_fetch = st.button("データ更新（Firestoreから再取得）", type="primary")
    with col_info:
        mt = core.cache_mtime(BASE, "visits", st.session_state.env)
        st.caption(
            f"キャッシュ最終更新: {mt.strftime('%Y-%m-%d %H:%M')}" if mt
            else "キャッシュなし — まずデータ更新を実行してください"
        )

    if do_fetch:
        if not secrets.get("firebase_key_path"):
            st.error("Firebase鍵が未設定です（設定タブ参照）。")
        else:
            with st.spinner("Firestoreからデータを取得中（数秒〜数十秒かかります）..."):
                try:
                    db = core.get_firestore_client(secrets, BASE, st.session_state.env)
                    s_jst = datetime.combine(start_date, time.min).replace(tzinfo=core.JST)
                    e_jst = datetime.combine(end_date, time(23, 59, 59)).replace(tzinfo=core.JST)
                    df_v  = core.fetch_visits(db, s_jst, e_jst)
                    df_c  = core.fetch_cheki(db, s_jst, e_jst)
                    # visits/cheki は先に保存（シフト取得が失敗しても失わない）
                    core.save_cache(df_v, BASE, "visits", st.session_state.env)
                    core.save_cache(df_c, BASE, "cheki",  st.session_state.env)
                    df_ws  = core.fetch_workshifts(db, s_jst, e_jst)
                    df_adm = core.fetch_maid_admissions(db, df_ws)
                    df_sd  = core.calc_shift_detail(df_ws, df_adm)
                    core.save_cache(df_sd, BASE, "shifts", st.session_state.env)
                    st.success(
                        f"取得完了: ご帰宅 {len(df_v):,} 件 / チェキ {len(df_c):,} 件"
                        f" / シフト {len(df_ws):,} 件"
                    )
                    st.rerun()
                except ImportError as e:
                    st.error(str(e))
                except FileNotFoundError as e:
                    st.error(str(e))
                except Exception as e:
                    msg = str(e)
                    url_m = re.search(r"https://console\.firebase\.google\.com\S+", msg)
                    if url_m:
                        st.error(
                            "Firestoreのコレクショングループインデックスが未作成です。"
                            "以下のURLを開いてインデックスを作成してください（反映まで数分かかります）。"
                        )
                        st.code(url_m.group())
                    else:
                        st.error(f"Firestore取得エラー: {msg}")

    # ---- キャッシュ読み込み ----
    df_v  = core.load_cache(BASE, "visits",  st.session_state.env)
    df_c  = core.load_cache(BASE, "cheki",   st.session_state.env)
    df_sd = core.load_cache(BASE, "shifts",  st.session_state.env)

    if df_v is None:
        st.info("「データ更新」ボタンを押してFirestoreからデータを取得してください。")
        st.stop()

    # ---- 日付フィルタ（キャッシュ内を UI の期間に絞る） ----
    dt_col = pd.to_datetime(df_v["enterDateTime"])
    cache_min = dt_col.min().date() if not dt_col.empty else start_date
    cache_max = dt_col.max().date() if not dt_col.empty else end_date
    mask_v = (dt_col.dt.date >= start_date) & (dt_col.dt.date <= end_date)
    df_v = df_v[mask_v].copy()

    df_c = df_c if (df_c is not None and not df_c.empty) else pd.DataFrame(
        columns=["doc_id", "userId", "date", "maidNickname"]
    )
    if not df_c.empty:
        dc_col = pd.to_datetime(df_c["date"])
        mask_c = (dc_col.dt.date >= start_date) & (dc_col.dt.date <= end_date)
        df_c = df_c[mask_c].copy()

    # シフトキャッシュを日付で絞り込んでメイド別に集計
    df_sh = None
    if df_sd is not None and not df_sd.empty:
        ds_col = pd.to_datetime(df_sd["openTime"])
        mask_sd = (ds_col.dt.date >= start_date) & (ds_col.dt.date <= end_date)
        df_sd_f = df_sd[mask_sd].copy()
        df_sh = core.agg_shift_hours(df_sd_f)

    st.caption(
        f"キャッシュ内データ: {cache_min} 〜 {cache_max} ／ "
        f"表示中: {start_date} 〜 {end_date}"
    )

    if df_v.empty:
        st.warning(
            "選択期間にデータがありません。"
            "期間を広げるか、「データ更新」で該当期間を再取得してください。"
        )
        st.stop()

    # ---- visitWeight の後方互換フォールバック ----
    if "visitWeight" not in df_v.columns:
        df_v["visitWeight"] = 1

    # ---- KPI ----
    paid  = df_v[df_v["type"] == "有料"]
    cheki = core.agg_cheki(df_c, df_v)
    visit_revenue = df_v["revenue"].sum()
    cheki_revenue = cheki["total"] * core.CHEKI_PRICE
    total_revenue = visit_revenue + cheki_revenue
    avg_unit      = float(paid["revenue"].mean()) if not paid.empty else 0.0
    total_visits  = int(df_v["visitWeight"].sum())
    paid_visits   = int((df_v["visitWeight"] * (df_v["type"] == "有料").astype(int)).sum())
    rsv_count     = int((df_v["roomType"] == "reservation").sum())

    k1, k2, k3, k4, k5, k6, k7 = st.columns(7)
    k1.metric("総ご帰宅数", f"{total_visits:,}")
    k2.metric("有料ご帰宅数", f"{paid_visits:,}")
    k3.metric("予約数", f"{rsv_count:,}")
    k4.metric("総売上（推計）", f"¥{total_revenue:,.0f}")
    k5.metric("平均単価（有料）", f"¥{avg_unit:,.0f}")
    k6.metric("総チェキ数", f"{cheki['total']:,}")
    k7.metric("チェキ装着率", f"{cheki['rate'] * 100:.1f}%")

    st.divider()

    # ---- 日次推移 ----
    st.subheader("日次推移")
    daily = core.agg_daily(df_v)
    if not daily.empty:
        tab1, tab2 = st.tabs(["ご帰宅数", "売上（推計）"])
        with tab1:
            st.bar_chart(daily.set_index("date")["ご帰宅数"])
        with tab2:
            st.bar_chart(daily.set_index("date")["売上"])

    # ---- メイド別 ----
    st.subheader("メイド別実績")
    maid_df = core.agg_by_maid(df_v, df_c, df_sh)
    ca, cb = st.columns([3, 2])
    with ca:
        st.bar_chart(maid_df.set_index("maidNickname")["ご帰宅数"])
    with cb:
        _yen  = st.column_config.NumberColumn(format="¥%,.0f")
        _col_cfg = {
            "ご帰宅売上": _yen,
            "チェキ売上": _yen,
            "合計売上":   _yen,
            "平均単価":   _yen,
            "予約数":     st.column_config.NumberColumn("予約数"),
        }
        if "稼働時間数" in maid_df.columns:
            _col_cfg["稼働時間数"]   = st.column_config.NumberColumn("稼働時間(h)", format="%.1f")
            _col_cfg["遅刻合計分"]   = st.column_config.NumberColumn("遅刻(分)")
            _col_cfg["平均ご帰宅数"] = st.column_config.NumberColumn("平均(/h)",   format="%.2f")
        st.dataframe(
            maid_df,
            column_config=_col_cfg,
            use_container_width=True,
            hide_index=True,
        )

    # ---- 時間帯・曜日 ----
    st.subheader("時間帯・曜日別ご帰宅数")
    ca, cb = st.columns(2)
    with ca:
        st.caption("時間帯別（JST）")
        st.bar_chart(core.agg_by_hour(df_v).set_index("hour")["ご帰宅数"])
    with cb:
        st.caption("曜日別")
        st.bar_chart(core.agg_by_weekday(df_v).set_index("weekday")["ご帰宅数"])

    # ---- コース別 ----
    st.subheader("コース別（usedTicketItemId）")
    ticket_df = core.agg_by_ticket(df_v)
    ca, cb = st.columns([3, 2])
    with ca:
        st.bar_chart(ticket_df.set_index("usedTicketItemId")["件数"])
    with cb:
        st.dataframe(
            ticket_df,
            column_config={"売上": st.column_config.NumberColumn(format="¥%,.0f")},
            use_container_width=True,
            hide_index=True,
        )

    # ---- チェキ実績 ----
    st.divider()
    st.subheader("チェキ実績")
    if df_c.empty:
        st.info("選択期間のチェキデータがありません（userAlbum 取得結果が 0 件）。")
    else:
        ca, cb = st.columns(2)
        with ca:
            st.caption("メイド別チェキ数")
            if not cheki["by_maid"].empty:
                st.bar_chart(cheki["by_maid"].set_index("maidNickname")["チェキ数"])
        with cb:
            st.caption("日次チェキ数")
            if not cheki["daily"].empty:
                st.bar_chart(cheki["daily"].set_index("date")["チェキ数"])
        st.dataframe(cheki["by_maid"], use_container_width=True, hide_index=True)

# ============================================================
# 予約通知（準備中・設計確定済み）
# ============================================================
elif page == "予約通知（準備中）":
    st.title("予約通知")
    st.info("準備中。Firestore `reservations` の rsvStatus が false→true（予約成立）/"
            "true→false（キャンセル）を検知し、メイドへDM（不可ならチャンネル@メンション）を送る設計です。")
    st.subheader("メイド↔Discord ID 対応表")
    st.caption("maidId / nickname / discordUserId の3列CSVをここで管理予定。")
    map_path = BASE / "data" / "maid_discord_map.csv"
    if map_path.exists():
        st.dataframe(pd.read_csv(map_path), use_container_width=True, hide_index=True)
    else:
        st.warning("data/maid_discord_map.csv が未作成です（テンプレを後で生成します）。")

    st.subheader("Discord 送信テスト")
    prod_banner()
    ch = st.text_input("送信先チャンネルID",
                       value=secrets.get("discord_channel_id", ""))
    msg = st.text_input("テストメッセージ", value="【テスト】予約通知の送信確認です")
    if st.button("送信テスト"):
        token = secrets.get("discord_bot_token")
        if not token:
            st.error("Discordトークンが未設定です（設定タブ参照）。")
        elif not ch:
            st.error("チャンネルIDを入力してください。")
        else:
            ok, info = core.send_discord_message(token, ch, msg)
            (st.success if ok else st.error)(info)

# ============================================================
# シフト反映（準備中・GAS置き換え）
# ============================================================
elif page == "シフト反映（準備中）":
    st.title("シフト反映（本番Firestoreへ）")
    st.info("準備中。シフト表.xlsx の日付シート（YYYYMMDD）を読み、内容を確認してから"
            "本番Firestoreへ反映します。GASの置き換えです。")
    prod_banner()

    up = st.file_uploader("シフト表.xlsx を選択", type=["xlsx"])
    default = BASE / "data" / "シフト表.xlsx"
    src = up if up is not None else (str(default) if default.exists() else None)
    if src is None:
        st.warning("シフト表を選択してください。")
        st.stop()
    try:
        sheets = core.list_shift_date_sheets(src)
    except Exception as e:
        st.error(f"読み込み失敗: {e}")
        st.stop()
    if not sheets:
        st.warning("日付シート（YYYYMMDD）が見つかりません。")
        st.stop()

    sheet = st.selectbox("反映する日付シート", sheets)
    df = core.load_shift_sheet(src, sheet)
    st.write(f"プレビュー（{len(df)} 件）")
    st.dataframe(df, use_container_width=True, hide_index=True)

    st.divider()
    st.subheader("本番反映")
    st.caption("※ 実際の書き込み処理は次フェーズで実装します（firebase-admin / dry-run 確認つき）。")
    dry = st.checkbox("ドライラン（書き込まず内容だけ確認）", value=True)
    confirm = st.text_input('本番反映する場合は「反映する」と入力')
    can_run = (not dry) and (not IS_PROD or confirm == "反映する")
    if st.button("反映を実行", disabled=True):
        st.info("未実装：ここで Firestore への createDocument を行います。")
    if IS_PROD and not dry:
        st.warning("本番への書き込みは確認文字の一致が必要です（事故防止）。")

# ============================================================
# 設定
# ============================================================
elif page == "設定":
    st.title("設定")
    st.write("秘密情報は **secrets_local.json**（Git除外）または環境変数から読み込みます。")
    st.code(
        "secrets_local.json の例:\n"
        "{\n"
        '  "discord_bot_token": "（Resetした新しいトークン）",\n'
        '  "discord_channel_id": "1489926976239304734",\n'
        '  "firebase_key_path": "serviceAccountKey.json"\n'
        "}", language="json")
    st.subheader("現在の読み込み状況（マスク表示）")
    st.table({
        "項目": ["Discordトークン", "DiscordチャンネルID", "Firebase鍵パス"],
        "値": [
            core.mask(secrets.get("discord_bot_token", "")),
            secrets.get("discord_channel_id", "(未設定)"),
            secrets.get("firebase_key_path", "(未設定)"),
        ],
    })
    st.warning("漏洩した旧トークン/旧鍵は必ず無効化（Reset/再生成）してから新しい値を入れてください。")
