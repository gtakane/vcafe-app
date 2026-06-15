# -*- coding: utf-8 -*-
import re
from datetime import datetime, date, time
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

import core

BASE = Path(__file__).parent
st.set_page_config(page_title="Vあっと運営アプリ", page_icon="💻", layout="wide")

# ---- CSS ----
st.markdown("""
<style>
/* サイドバー */
[data-testid="stSidebar"] {
    background: #0f1117;
}
[data-testid="stSidebar"] * {
    color: #e0e0e0 !important;
}
[data-testid="stSidebar"] .stRadio label { color: #e0e0e0 !important; }

/* KPI カード */
[data-testid="stMetric"] {
    background: #ffffff;
    border: 1px solid #e8eaf0;
    border-radius: 12px;
    padding: 1rem 1.2rem !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
[data-testid="stMetricLabel"] > div {
    font-size: 0.78rem !important;
    font-weight: 600 !important;
    color: #6b7280 !important;
    letter-spacing: 0.03em;
}
[data-testid="stMetricValue"] > div {
    font-size: 1.7rem !important;
    font-weight: 700 !important;
    color: #111827 !important;
}

/* セクション見出し */
h2, h3 { color: #111827 !important; font-weight: 700 !important; }

/* データフレーム */
[data-testid="stDataFrame"] { border-radius: 10px; overflow: hidden; }

/* ボタン */
[data-testid="baseButton-primary"] {
    background: #4f46e5 !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    padding: 0.4rem 1.2rem !important;
}
[data-testid="baseButton-primary"]:hover {
    background: #4338ca !important;
}

/* 区切り線 */
hr { border-color: #e8eaf0 !important; margin: 1.5rem 0 !important; }

/* タブ */
[data-testid="stTab"] { font-weight: 600; }
</style>
""", unsafe_allow_html=True)

# ---- 秘密情報・環境 ----
secrets = core.load_secrets(BASE)
if "env" not in st.session_state:
    st.session_state.env = "テスト"

# ============================================================
# サイドバー
# ============================================================
with st.sidebar:
    st.markdown("### Vあっと運営アプリ")
    st.caption("バーチャルあっとほぉーむカフェ")
    st.divider()

    st.session_state.env = st.radio(
        "環境", ["テスト", "本番"],
        index=0 if st.session_state.env == "テスト" else 1,
    )
    if st.session_state.env == "本番":
        st.error("⚠ 本番環境")
    else:
        st.success("テスト環境")

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


# ---- カラーパレット ----
_CLR_PRIMARY = "#4f46e5"
_CLR_MAIDS   = px.colors.qualitative.Pastel


def _bar(df, x, y, title="", color=_CLR_PRIMARY, height=380, text_col=None):
    """横長棒グラフ（全ラベル表示）"""
    fig = px.bar(df, x=x, y=y, title=title,
                 text=text_col or y, height=height,
                 color_discrete_sequence=[color])
    fig.update_traces(textposition="outside", cliponaxis=False)
    fig.update_layout(
        margin=dict(t=40, b=120, l=10, r=10),
        xaxis=dict(tickangle=-45, title=""),
        yaxis=dict(title=""),
        plot_bgcolor="#f9fafb",
        paper_bgcolor="white",
        font=dict(family="sans-serif", size=12),
        title_font_size=14,
        showlegend=False,
    )
    return fig


# ============================================================
# ホーム
# ============================================================
if page == "ホーム":
    st.title("Vあっと運営アプリ")
    st.caption("バーチャルあっとほぉーむカフェ 内部管理ツール")
    c1, c2, c3 = st.columns(3)
    c1.metric("現在の環境", st.session_state.env)
    c2.metric("Discordトークン",
              "設定済み" if secrets.get("discord_bot_token") else "未設定")
    c3.metric("Firebase鍵",
              "設定済み" if secrets.get("firebase_key_path") or secrets.get("firebase_key_json") else "未設定")
    st.divider()
    st.subheader("ロードマップ")
    st.markdown(
        "- ✅ 勤怠レポートの可視化\n"
        "- ✅ お給仕実績ダッシュボード（Firestore）\n"
        "- ⬜ 予約通知（Firestore → Discord）\n"
        "- ⬜ シフト反映（シフト表 → 本番Firestore）"
    )

# ============================================================
# 勤怠レポート
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
        detail  = core.load_kintai_detail(src)
    except Exception as e:
        st.error(f"読み込みに失敗しました: {e}")
        st.stop()

    kpi = core.summarize_kpis(summary, detail)
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("メイド数",       kpi["メイド数"])
    c2.metric("総シフト数",     kpi["総シフト数"])
    c3.metric("平均欠勤率",     f"{kpi['平均欠勤率']*100:.1f}%")
    c4.metric("当日連絡件数",   kpi["当日連絡件数"])

    st.divider()
    st.subheader("欠勤率ランキング")
    rank = (summary[summary["シフト数"] > 0]
            .sort_values("欠勤率", ascending=False)
            [["メイド名", "シフト数", "欠勤", "欠勤率"]].head(15))
    fig = px.bar(rank, x="メイド名", y="欠勤率", text="欠勤率",
                 color_discrete_sequence=[_CLR_PRIMARY], height=360)
    fig.update_traces(texttemplate="%{text:.1%}", textposition="outside")
    fig.update_layout(yaxis_tickformat=".0%", xaxis_tickangle=-45,
                      plot_bgcolor="#f9fafb", paper_bgcolor="white",
                      margin=dict(b=120))
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("一覧")
    show = summary.copy()
    show["欠勤率"] = (show["欠勤率"] * 100).round(1)
    show["遅刻率"] = (show["遅刻率"] * 100).round(1)
    st.dataframe(show, use_container_width=True, hide_index=True)

    if not detail.empty and "種別" in detail.columns:
        st.subheader("種別ごとの件数")
        vc = detail["種別"].value_counts().reset_index()
        vc.columns = ["種別", "件数"]
        fig2 = px.bar(vc, x="種別", y="件数", color_discrete_sequence=[_CLR_PRIMARY])
        fig2.update_layout(plot_bgcolor="#f9fafb", paper_bgcolor="white")
        st.plotly_chart(fig2, use_container_width=True)

    st.download_button(
        "サマリーをCSVで保存",
        summary.to_csv(index=False).encode("utf-8-sig"),
        file_name="勤怠サマリー.csv", mime="text/csv")

# ============================================================
# お給仕実績
# ============================================================
elif page == "お給仕実績":
    st.title("お給仕実績ダッシュボード")
    prod_banner()

    # ---- 期間選択 ----
    today = date.today()
    c1, c2 = st.columns(2)
    start_date = c1.date_input("取得開始日", value=today.replace(day=1))
    end_date   = c2.date_input("取得終了日", value=today)

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
        if not secrets.get("firebase_key_path") and not secrets.get("firebase_key_json"):
            st.error("Firebase鍵が未設定です（設定タブ参照）。")
        else:
            with st.spinner("Firestoreからデータを取得中..."):
                try:
                    db    = core.get_firestore_client(secrets, BASE, st.session_state.env)
                    s_jst = datetime.combine(start_date, time.min).replace(tzinfo=core.JST)
                    e_jst = datetime.combine(end_date, time(23, 59, 59)).replace(tzinfo=core.JST)
                    df_v  = core.fetch_visits(db, s_jst, e_jst)
                    df_c  = core.fetch_cheki(db, s_jst, e_jst)
                    core.save_cache(df_v, BASE, "visits", st.session_state.env)
                    core.save_cache(df_c, BASE, "cheki",  st.session_state.env)
                    df_ws = core.fetch_workshifts(db, s_jst, e_jst)
                    df_sd = core.calc_shift_detail(df_ws)
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
                        st.error("Firestoreのインデックスが未作成です。以下のURLからインデックスを作成してください。")
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

    # ---- 期間フィルタ ----
    dt_col = pd.to_datetime(df_v["enterDateTime"])
    cache_min = dt_col.min().date() if not dt_col.empty else start_date
    cache_max = dt_col.max().date() if not dt_col.empty else end_date
    df_v = df_v[(dt_col.dt.date >= start_date) & (dt_col.dt.date <= end_date)].copy()

    df_c = df_c if (df_c is not None and not df_c.empty) else pd.DataFrame(
        columns=["doc_id", "userId", "date", "maidNickname"])
    if not df_c.empty:
        dc_col = pd.to_datetime(df_c["date"])
        df_c = df_c[(dc_col.dt.date >= start_date) & (dc_col.dt.date <= end_date)].copy()

    df_sh = None
    if df_sd is not None and not df_sd.empty:
        ds_col = pd.to_datetime(df_sd["openTime"])
        df_sd_f = df_sd[(ds_col.dt.date >= start_date) & (ds_col.dt.date <= end_date)].copy()
        df_sh = core.agg_shift_hours(df_sd_f)

    st.caption(
        f"キャッシュ: {cache_min} 〜 {cache_max} ／ 表示中: {start_date} 〜 {end_date}"
    )

    if df_v.empty:
        st.warning("選択期間にデータがありません。期間を変更するか、データ更新してください。")
        st.stop()

    if "visitWeight" not in df_v.columns:
        df_v["visitWeight"] = 1

    # ---- KPI ----
    paid          = df_v[df_v["type"] == "有料"]
    cheki         = core.agg_cheki(df_c, df_v)
    visit_revenue = df_v["revenue"].sum()
    cheki_revenue = cheki["total"] * core.CHEKI_PRICE
    total_revenue = visit_revenue + cheki_revenue
    avg_unit      = float(paid["revenue"].mean()) if not paid.empty else 0.0
    total_visits  = int(df_v["visitWeight"].sum())
    paid_visits   = int((df_v["visitWeight"] * (df_v["type"] == "有料").astype(int)).sum())
    rsv_count     = int((df_v["roomType"] == "reservation").sum())

    k1, k2, k3, k4, k5, k6, k7 = st.columns(7)
    k1.metric("総ご帰宅数",       f"{total_visits:,}")
    k2.metric("有料ご帰宅数",     f"{paid_visits:,}")
    k3.metric("予約数",           f"{rsv_count:,}")
    k4.metric("総売上（推計）",   f"¥{total_revenue:,.0f}")
    k5.metric("平均単価（有料）", f"¥{avg_unit:,.0f}")
    k6.metric("総チェキ数",       f"{cheki['total']:,}")
    k7.metric("チェキ装着率",     f"{cheki['rate']*100:.1f}%")

    st.divider()

    # ---- 日次推移 ----
    st.subheader("日次推移")
    daily = core.agg_daily(df_v)
    if not daily.empty:
        tab1, tab2 = st.tabs(["ご帰宅数", "売上（推計）"])
        with tab1:
            fig = px.bar(daily, x="date", y="ご帰宅数", text="ご帰宅数",
                         color_discrete_sequence=[_CLR_PRIMARY], height=320)
            fig.update_traces(textposition="outside")
            fig.update_layout(xaxis_title="", yaxis_title="",
                              plot_bgcolor="#f9fafb", paper_bgcolor="white",
                              margin=dict(t=20, b=40))
            st.plotly_chart(fig, use_container_width=True)
        with tab2:
            fig = px.bar(daily, x="date", y="売上", text="売上",
                         color_discrete_sequence=["#10b981"], height=320)
            fig.update_traces(texttemplate="¥%{text:,.0f}", textposition="outside")
            fig.update_layout(xaxis_title="", yaxis_title="",
                              plot_bgcolor="#f9fafb", paper_bgcolor="white",
                              margin=dict(t=20, b=40))
            st.plotly_chart(fig, use_container_width=True)

    # ---- メイド別実績 ----
    st.subheader("メイド別実績")
    maid_df = core.agg_by_maid(df_v, df_c, df_sh)

    # 棒グラフ（全メイド名・回転ラベル）
    fig = _bar(maid_df, x="maidNickname", y="ご帰宅数", title="メイド別ご帰宅数")
    st.plotly_chart(fig, use_container_width=True)

    # テーブル
    _yen = st.column_config.NumberColumn(format="¥%,.0f")
    _col_cfg = {
        "maidNickname": st.column_config.TextColumn("メイド名", width="medium"),
        "ご帰宅数":     st.column_config.NumberColumn("ご帰宅数"),
        "有料数":       st.column_config.NumberColumn("有料数"),
        "予約数":       st.column_config.NumberColumn("予約数"),
        "ご帰宅売上":   _yen,
        "チェキ売上":   _yen,
        "合計売上":     _yen,
        "平均単価":     _yen,
    }
    if "稼働時間数" in maid_df.columns:
        _col_cfg["稼働時間数"]   = st.column_config.NumberColumn("稼働時間(h)", format="%.1f")
        _col_cfg["遅刻合計分"]   = st.column_config.NumberColumn("遅刻(分)")
        _col_cfg["平均ご帰宅数"] = st.column_config.NumberColumn("平均(/h)", format="%.2f")
    st.dataframe(maid_df, column_config=_col_cfg,
                 use_container_width=True, hide_index=True)

    # ---- 時間帯・曜日 ----
    st.divider()
    st.subheader("時間帯・曜日別ご帰宅数")
    ca, cb = st.columns(2)
    with ca:
        hour_df = core.agg_by_hour(df_v)
        fig = px.bar(hour_df, x="hour", y="ご帰宅数", text="ご帰宅数",
                     color_discrete_sequence=[_CLR_PRIMARY], height=320,
                     title="時間帯別（JST）")
        fig.update_traces(textposition="outside")
        fig.update_layout(xaxis_title="時", yaxis_title="",
                          plot_bgcolor="#f9fafb", paper_bgcolor="white",
                          margin=dict(t=40, b=40))
        st.plotly_chart(fig, use_container_width=True)
    with cb:
        wday_df = core.agg_by_weekday(df_v)
        fig = px.bar(wday_df, x="weekday", y="ご帰宅数", text="ご帰宅数",
                     color_discrete_sequence=["#8b5cf6"], height=320,
                     title="曜日別")
        fig.update_traces(textposition="outside")
        fig.update_layout(xaxis_title="", yaxis_title="",
                          plot_bgcolor="#f9fafb", paper_bgcolor="white",
                          margin=dict(t=40, b=40))
        st.plotly_chart(fig, use_container_width=True)

    # ---- コース別 ----
    st.subheader("コース別（チケット種別）")
    ticket_df = core.agg_by_ticket(df_v)
    ca, cb = st.columns([3, 2])
    with ca:
        fig = px.bar(ticket_df, x="usedTicketItemId", y="件数", text="件数",
                     color_discrete_sequence=["#f59e0b"], height=320)
        fig.update_traces(textposition="outside")
        fig.update_layout(xaxis_title="", yaxis_title="",
                          plot_bgcolor="#f9fafb", paper_bgcolor="white",
                          margin=dict(b=80))
        st.plotly_chart(fig, use_container_width=True)
    with cb:
        st.dataframe(
            ticket_df,
            column_config={"売上": st.column_config.NumberColumn(format="¥%,.0f")},
            use_container_width=True, hide_index=True)

    # ---- チェキ実績 ----
    st.divider()
    st.subheader("チェキ実績")
    if df_c.empty:
        st.info("選択期間のチェキデータがありません。")
    else:
        ca, cb = st.columns(2)
        with ca:
            if not cheki["by_maid"].empty:
                fig = _bar(cheki["by_maid"], x="maidNickname", y="チェキ数",
                           title="メイド別チェキ数", color="#ec4899")
                st.plotly_chart(fig, use_container_width=True)
        with cb:
            if not cheki["daily"].empty:
                fig = px.bar(cheki["daily"], x="date", y="チェキ数", text="チェキ数",
                             color_discrete_sequence=["#ec4899"], height=380,
                             title="日次チェキ数")
                fig.update_traces(textposition="outside")
                fig.update_layout(xaxis_title="", plot_bgcolor="#f9fafb",
                                  paper_bgcolor="white", margin=dict(b=40))
                st.plotly_chart(fig, use_container_width=True)
        st.dataframe(cheki["by_maid"], use_container_width=True, hide_index=True)

# ============================================================
# 予約通知
# ============================================================
elif page == "予約通知（準備中）":
    st.title("予約通知")
    st.info("準備中。Firestore `reservations` の rsvStatus 変化を検知してDiscordへ通知します。")
    st.subheader("Discord 送信テスト")
    prod_banner()
    ch  = st.text_input("送信先チャンネルID", value=secrets.get("discord_channel_id", ""))
    msg = st.text_input("テストメッセージ", value="【テスト】予約通知の送信確認です")
    if st.button("送信テスト"):
        token = secrets.get("discord_bot_token")
        if not token:
            st.error("Discordトークンが未設定です。")
        elif not ch:
            st.error("チャンネルIDを入力してください。")
        else:
            ok, info = core.send_discord_message(token, ch, msg)
            (st.success if ok else st.error)(info)

# ============================================================
# シフト反映
# ============================================================
elif page == "シフト反映（準備中）":
    st.title("シフト反映（本番Firestoreへ）")
    st.info("準備中。シフト表.xlsx の日付シートを読み、本番Firestoreへ反映します。")
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

# ============================================================
# 設定
# ============================================================
elif page == "設定":
    st.title("設定")
    st.subheader("秘密情報の読み込み状況")
    st.table({
        "項目": ["Discordトークン", "DiscordチャンネルID", "Firebase鍵パス"],
        "値": [
            core.mask(secrets.get("discord_bot_token", "")),
            secrets.get("discord_channel_id", "(未設定)"),
            secrets.get("firebase_key_path", "(未設定)"),
        ],
    })
    st.info("秘密情報は `secrets_local.json`（ローカル）または Streamlit Cloud の Secrets（クラウド）から読み込みます。")
