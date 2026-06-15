# -*- coding: utf-8 -*-
import re
from datetime import datetime, date, time
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

import core

BASE = Path(__file__).parent
st.set_page_config(page_title="Vあっと運営アプリ", page_icon="💜", layout="wide")

# ============================================================
# デザインシステム
# ============================================================
BRAND   = "#6c63ff"   # メインパープル
BRAND2  = "#48c78e"   # アクセントグリーン
BRAND3  = "#f14668"   # アクセントレッド（警告）
BG_PAGE = "#f0f2f9"   # ページ背景（薄ラベンダー）
BG_CARD = "#ffffff"
TEXT_HI = "#1a1a2e"   # 見出し文字
TEXT_MU = "#6b7280"   # ミュート文字

# Plotly グラフ共通テーマ
_PL_LAYOUT = dict(
    paper_bgcolor="white",
    plot_bgcolor="#f7f8fc",
    font=dict(family="'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif", size=12, color=TEXT_HI),
    margin=dict(t=36, b=16, l=16, r=16),
    hoverlabel=dict(bgcolor="white", font_size=12),
    showlegend=False,
)
_PL_AXIS = dict(showgrid=True, gridcolor="#e8eaf6", zeroline=False,
                tickfont=dict(size=12), title="")

# ---- Google Fonts + 包括 CSS ----
st.markdown(f"""
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
<style>
/* ベースフォント */
html, body, [class*="css"], .stApp {{
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif !important;
}}

/* ページ背景 */
.stApp {{ background: {BG_PAGE} !important; }}
.main .block-container {{
    padding: 2rem 2.5rem 3rem !important;
    max-width: 1400px !important;
}}

/* ===== サイドバー ===== */
[data-testid="stSidebar"] > div:first-child {{
    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%) !important;
    border-right: none !important;
}}
[data-testid="stSidebar"] * {{
    color: #c8d0e7 !important;
}}
[data-testid="stSidebar"] hr {{
    border-color: rgba(255,255,255,0.12) !important;
}}
/* ラジオボタンのカーソル行 */
[data-testid="stSidebar"] [data-testid="stRadio"] label:hover {{
    color: #ffffff !important;
}}
[data-testid="stSidebar"] [data-testid="stRadio"] [aria-checked="true"] + div {{
    color: {BRAND} !important;
}}

/* ===== ページタイトル ===== */
h1 {{
    color: {TEXT_HI} !important;
    font-size: 1.9rem !important;
    font-weight: 700 !important;
    letter-spacing: -0.02em !important;
    margin-bottom: 0.1rem !important;
}}
h2 {{
    color: {TEXT_HI} !important;
    font-size: 1.2rem !important;
    font-weight: 700 !important;
    margin-top: 1.6rem !important;
    margin-bottom: 0.6rem !important;
    padding-bottom: 0.4rem !important;
    border-bottom: 2px solid {BRAND} !important;
    display: inline-block !important;
}}
h3 {{
    color: {TEXT_HI} !important;
    font-size: 1.05rem !important;
    font-weight: 600 !important;
}}

/* ===== st.metric (KPIカード) ===== */
[data-testid="stMetric"] {{
    background: {BG_CARD} !important;
    border-radius: 14px !important;
    padding: 1.1rem 1.3rem !important;
    box-shadow: 0 2px 12px rgba(108,99,255,0.10) !important;
    border-left: 4px solid {BRAND} !important;
    transition: box-shadow 0.2s !important;
}}
[data-testid="stMetric"]:hover {{
    box-shadow: 0 4px 20px rgba(108,99,255,0.18) !important;
}}
[data-testid="stMetricLabel"] p {{
    font-size: 0.72rem !important;
    font-weight: 600 !important;
    color: {TEXT_MU} !important;
    letter-spacing: 0.06em !important;
    text-transform: uppercase !important;
    margin-bottom: 0.3rem !important;
}}
[data-testid="stMetricValue"] > div {{
    font-size: 1.75rem !important;
    font-weight: 700 !important;
    color: {TEXT_HI} !important;
    line-height: 1.2 !important;
}}

/* ===== プライマリボタン ===== */
button[kind="primary"], [data-testid="baseButton-primary"] {{
    background: {BRAND} !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 600 !important;
    font-size: 0.9rem !important;
    padding: 0.55rem 1.4rem !important;
    color: white !important;
    box-shadow: 0 2px 8px rgba(108,99,255,0.3) !important;
    transition: all 0.2s !important;
}}
button[kind="primary"]:hover, [data-testid="baseButton-primary"]:hover {{
    background: #5548e0 !important;
    box-shadow: 0 4px 14px rgba(108,99,255,0.4) !important;
    transform: translateY(-1px) !important;
}}

/* ===== データフレーム ===== */
[data-testid="stDataFrame"] {{
    border-radius: 12px !important;
    overflow: hidden !important;
    box-shadow: 0 1px 6px rgba(0,0,0,0.07) !important;
}}

/* ===== タブ ===== */
[data-testid="stTabs"] [role="tablist"] {{
    background: {BG_CARD} !important;
    border-radius: 10px 10px 0 0 !important;
    padding: 0 0.5rem !important;
    gap: 0 !important;
}}
button[role="tab"] {{
    font-weight: 600 !important;
    font-size: 0.88rem !important;
    padding: 0.6rem 1.2rem !important;
    color: {TEXT_MU} !important;
    border-bottom: 3px solid transparent !important;
    border-radius: 0 !important;
}}
button[role="tab"][aria-selected="true"] {{
    color: {BRAND} !important;
    border-bottom: 3px solid {BRAND} !important;
    background: transparent !important;
}}

/* ===== info / warning / success ===== */
[data-testid="stAlert"] {{
    border-radius: 10px !important;
    border: none !important;
}}

/* ===== 区切り線 ===== */
hr {{ border-color: #dde1f0 !important; margin: 1.8rem 0 !important; }}

/* ===== キャプション ===== */
[data-testid="stCaptionContainer"] p {{
    color: {TEXT_MU} !important;
    font-size: 0.8rem !important;
}}

/* ===== expander ===== */
[data-testid="stExpander"] {{
    background: {BG_CARD} !important;
    border-radius: 12px !important;
    border: 1px solid #e0e4f0 !important;
}}
</style>
""", unsafe_allow_html=True)

# ============================================================
# ヘルパー: Plotly グラフ
# ============================================================
def _apply(fig):
    fig.update_layout(**_PL_LAYOUT)
    fig.update_xaxes(**_PL_AXIS)
    fig.update_yaxes(**_PL_AXIS)
    return fig


def hbar(df, y_col, x_col, color=BRAND, title="", height=None):
    """横棒グラフ — メイド名などラベルが長い列に使う"""
    df_s = df.sort_values(x_col, ascending=True).tail(30)
    h = height or max(320, len(df_s) * 34)
    fig = px.bar(df_s, y=y_col, x=x_col, orientation="h",
                 text=x_col, title=title, height=h,
                 color_discrete_sequence=[color])
    fig.update_traces(textposition="outside", cliponaxis=False,
                      marker_line_width=0)
    fig.update_yaxes(tickfont=dict(size=13), title="", automargin=True)
    fig.update_xaxes(title="")
    _apply(fig)
    fig.update_layout(margin=dict(t=36, b=16, l=8, r=60))
    return fig


def vbar(df, x_col, y_col, color=BRAND, title="", text_fmt=None, height=320):
    """縦棒グラフ — 日付・時間帯・曜日など"""
    fig = px.bar(df, x=x_col, y=y_col, title=title,
                 text=y_col, height=height,
                 color_discrete_sequence=[color])
    if text_fmt:
        fig.update_traces(texttemplate=text_fmt, textposition="outside")
    else:
        fig.update_traces(textposition="outside")
    fig.update_traces(marker_line_width=0, cliponaxis=False)
    _apply(fig)
    return fig


# ============================================================
# 秘密情報・環境
# ============================================================
secrets = core.load_secrets(BASE)
if "env" not in st.session_state:
    st.session_state.env = "テスト"

# ============================================================
# サイドバー
# ============================================================
with st.sidebar:
    st.markdown("""
    <div style="padding:1.2rem 0.5rem 0.8rem; text-align:center;">
      <div style="font-size:1.5rem; font-weight:700; color:#ffffff; letter-spacing:-0.02em;">
        Vあっと
      </div>
      <div style="font-size:0.75rem; color:#8892b0; margin-top:2px; letter-spacing:0.08em;">
        OPERATIONS DASHBOARD
      </div>
    </div>
    """, unsafe_allow_html=True)
    st.divider()

    env_choice = st.radio("環境", ["テスト", "本番"],
                          index=0 if st.session_state.env == "テスト" else 1)
    st.session_state.env = env_choice
    if env_choice == "本番":
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
    ], label_visibility="collapsed")

IS_PROD = st.session_state.env == "本番"


def prod_banner():
    if IS_PROD:
        st.error("⚠ 本番環境です。実行内容をよく確認してください。")


# ============================================================
# ホーム
# ============================================================
if page == "ホーム":
    st.title("Vあっと運営アプリ")
    st.caption("バーチャルあっとほぉーむカフェ 内部管理ダッシュボード")
    st.divider()
    c1, c2, c3 = st.columns(3)
    c1.metric("現在の環境", st.session_state.env)
    c2.metric("Discord Bot",
              "設定済み" if secrets.get("discord_bot_token") else "未設定")
    c3.metric("Firebase",
              "設定済み" if secrets.get("firebase_key_path") or secrets.get("firebase_key_json") else "未設定")
    st.divider()
    st.subheader("機能ステータス")
    items = [
        ("✅", "勤怠レポート可視化", "完成"),
        ("✅", "お給仕実績ダッシュボード（Firestore）", "完成"),
        ("🔧", "予約通知（Firestore → Discord）", "開発中"),
        ("🔧", "シフト反映（シフト表 → 本番Firestore）", "開発中"),
    ]
    for icon, name, status in items:
        st.markdown(f"{icon} &nbsp; **{name}** &nbsp; `{status}`", unsafe_allow_html=True)

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
    c1.metric("メイド数",     kpi["メイド数"])
    c2.metric("総シフト数",   kpi["総シフト数"])
    c3.metric("平均欠勤率",   f"{kpi['平均欠勤率']*100:.1f}%")
    c4.metric("当日連絡件数", kpi["当日連絡件数"])

    st.subheader("欠勤率ランキング（上位 15 名）")
    rank = (summary[summary["シフト数"] > 0]
            .sort_values("欠勤率", ascending=False)
            [["メイド名", "シフト数", "欠勤", "欠勤率"]].head(15))
    fig = px.bar(rank, y="メイド名", x="欠勤率", orientation="h",
                 text="欠勤率", color_discrete_sequence=[BRAND3],
                 height=max(300, len(rank) * 34))
    fig.update_traces(texttemplate="%{text:.1%}", textposition="outside",
                      marker_line_width=0)
    fig.update_xaxes(tickformat=".0%", title="")
    fig.update_yaxes(title="", automargin=True)
    _apply(fig)
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("一覧")
    show = summary.copy()
    show["欠勤率"] = (show["欠勤率"] * 100).round(1).astype(str) + "%"
    show["遅刻率"] = (show["遅刻率"] * 100).round(1).astype(str) + "%"
    st.dataframe(show, use_container_width=True, hide_index=True)

    if not detail.empty and "種別" in detail.columns:
        st.subheader("種別ごとの件数")
        vc = detail["種別"].value_counts().reset_index()
        vc.columns = ["種別", "件数"]
        fig2 = vbar(vc, "種別", "件数", title="")
        st.plotly_chart(fig2, use_container_width=True)

    st.download_button(
        "サマリーをCSVで保存",
        summary.to_csv(index=False).encode("utf-8-sig"),
        file_name="勤怠サマリー.csv", mime="text/csv",
        type="primary")

# ============================================================
# お給仕実績
# ============================================================
elif page == "お給仕実績":
    st.title("お給仕実績ダッシュボード")
    prod_banner()

    # ---- 期間選択 + データ更新 ----
    today = date.today()
    with st.expander("期間・データ取得", expanded=True):
        c1, c2, c3 = st.columns([2, 2, 3])
        start_date = c1.date_input("開始日", value=today.replace(day=1))
        end_date   = c2.date_input("終了日", value=today)
        do_fetch   = c3.button("Firestoreから再取得", type="primary",
                               use_container_width=True)
        mt = core.cache_mtime(BASE, "visits", st.session_state.env)
        st.caption(
            f"キャッシュ最終更新: {mt.strftime('%Y-%m-%d %H:%M')}" if mt
            else "キャッシュなし — まずデータ取得を実行してください"
        )

    if do_fetch:
        if not secrets.get("firebase_key_path") and not secrets.get("firebase_key_json"):
            st.error("Firebase鍵が未設定です（設定ページ参照）。")
        else:
            with st.spinner("Firestore からデータを取得中..."):
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
                        f"取得完了: ご帰宅 {len(df_v):,} 件 ／ "
                        f"チェキ {len(df_c):,} 件 ／ シフト {len(df_ws):,} 件"
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
                        st.error("Firestore インデックスが未作成です。下記 URL から作成してください。")
                        st.code(url_m.group())
                    else:
                        st.error(f"Firestore エラー: {msg}")

    # ---- キャッシュ読み込み ----
    df_v  = core.load_cache(BASE, "visits",  st.session_state.env)
    df_c  = core.load_cache(BASE, "cheki",   st.session_state.env)
    df_sd = core.load_cache(BASE, "shifts",  st.session_state.env)

    if df_v is None:
        st.info("「Firestoreから再取得」を押してデータを取得してください。")
        st.stop()

    # ---- 期間フィルタ ----
    dt_col = pd.to_datetime(df_v["enterDateTime"])
    df_v   = df_v[(dt_col.dt.date >= start_date) & (dt_col.dt.date <= end_date)].copy()

    df_c = df_c if (df_c is not None and not df_c.empty) else pd.DataFrame(
        columns=["doc_id", "userId", "date", "maidNickname"])
    if not df_c.empty:
        dc_col = pd.to_datetime(df_c["date"])
        df_c   = df_c[(dc_col.dt.date >= start_date) & (dc_col.dt.date <= end_date)].copy()

    df_sh = None
    if df_sd is not None and not df_sd.empty:
        ds_col  = pd.to_datetime(df_sd["openTime"])
        df_sd_f = df_sd[(ds_col.dt.date >= start_date) & (ds_col.dt.date <= end_date)].copy()
        df_sh   = core.agg_shift_hours(df_sd_f)

    if df_v.empty:
        st.warning("選択期間にデータがありません。")
        st.stop()

    if "visitWeight" not in df_v.columns:
        df_v["visitWeight"] = 1

    # ============================================================
    # KPI バー
    # ============================================================
    paid          = df_v[df_v["type"] == "有料"]
    cheki         = core.agg_cheki(df_c, df_v)
    visit_revenue = df_v["revenue"].sum()
    cheki_revenue = cheki["total"] * core.CHEKI_PRICE
    total_revenue = visit_revenue + cheki_revenue
    avg_unit      = float(paid["revenue"].mean()) if not paid.empty else 0.0
    total_visits  = int(df_v["visitWeight"].sum())
    paid_visits   = int((df_v["visitWeight"] * (df_v["type"] == "有料").astype(int)).sum())
    rsv_count     = int((df_v["roomType"] == "reservation").sum())

    cols = st.columns(7)
    kpis = [
        ("総ご帰宅数",       f"{total_visits:,}"),
        ("有料ご帰宅数",     f"{paid_visits:,}"),
        ("予約数",           f"{rsv_count:,}"),
        ("総売上（推計）",   f"¥{total_revenue:,.0f}"),
        ("平均単価（有料）", f"¥{avg_unit:,.0f}"),
        ("総チェキ数",       f"{cheki['total']:,}"),
        ("チェキ装着率",     f"{cheki['rate']*100:.1f}%"),
    ]
    for col, (label, val) in zip(cols, kpis):
        col.metric(label, val)

    # ============================================================
    # 日次推移
    # ============================================================
    st.subheader("日次推移")
    daily = core.agg_daily(df_v)
    if not daily.empty:
        tab1, tab2 = st.tabs(["ご帰宅数", "売上（推計）"])
        with tab1:
            fig = vbar(daily, "date", "ご帰宅数", color=BRAND, height=300)
            st.plotly_chart(fig, use_container_width=True)
        with tab2:
            fig = vbar(daily, "date", "売上", color=BRAND2,
                       text_fmt="¥%{text:,.0f}", height=300)
            st.plotly_chart(fig, use_container_width=True)

    # ============================================================
    # メイド別実績
    # ============================================================
    st.subheader("メイド別実績")
    maid_df = core.agg_by_maid(df_v, df_c, df_sh)

    tab_chart, tab_table = st.tabs(["グラフ", "テーブル"])
    with tab_chart:
        sub1, sub2 = st.columns(2)
        with sub1:
            fig = hbar(maid_df, "maidNickname", "ご帰宅数", color=BRAND,
                       title="ご帰宅数（加重）")
            st.plotly_chart(fig, use_container_width=True)
        with sub2:
            fig = hbar(maid_df, "maidNickname", "合計売上", color=BRAND2,
                       title="合計売上（推計）")
            fig.update_traces(texttemplate="¥%{x:,.0f}")
            st.plotly_chart(fig, use_container_width=True)

    with tab_table:
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

    # ============================================================
    # 時間帯・曜日
    # ============================================================
    st.subheader("時間帯・曜日別")
    ca, cb = st.columns(2)
    with ca:
        hour_df = core.agg_by_hour(df_v)
        fig = vbar(hour_df, "hour", "ご帰宅数", color=BRAND, title="時間帯別（JST）")
        fig.update_xaxes(dtick=1, title="時")
        st.plotly_chart(fig, use_container_width=True)
    with cb:
        wday_df = core.agg_by_weekday(df_v)
        fig = vbar(wday_df, "weekday", "ご帰宅数", color="#a78bfa", title="曜日別")
        st.plotly_chart(fig, use_container_width=True)

    # ============================================================
    # コース別
    # ============================================================
    st.subheader("コース別（チケット種別）")
    ticket_df = core.agg_by_ticket(df_v)
    ca, cb = st.columns([3, 2])
    with ca:
        fig = hbar(ticket_df, "usedTicketItemId", "件数",
                   color="#f59e0b", title="チケット種別 件数")
        st.plotly_chart(fig, use_container_width=True)
    with cb:
        st.dataframe(
            ticket_df,
            column_config={"売上": st.column_config.NumberColumn(format="¥%,.0f")},
            use_container_width=True, hide_index=True)

    # ============================================================
    # チェキ実績
    # ============================================================
    st.subheader("チェキ実績")
    if df_c.empty:
        st.info("選択期間のチェキデータがありません。")
    else:
        ca, cb = st.columns(2)
        with ca:
            if not cheki["by_maid"].empty:
                fig = hbar(cheki["by_maid"], "maidNickname", "チェキ数",
                           color="#ec4899", title="メイド別チェキ数")
                st.plotly_chart(fig, use_container_width=True)
        with cb:
            if not cheki["daily"].empty:
                dly = cheki["daily"].copy()
                dly["date"] = dly["date"].astype(str)
                fig = vbar(dly, "date", "チェキ数", color="#ec4899", title="日次チェキ数")
                st.plotly_chart(fig, use_container_width=True)

# ============================================================
# 予約通知
# ============================================================
elif page == "予約通知（準備中）":
    st.title("予約通知")
    st.info("準備中。Firestore `reservations` の rsvStatus 変化を検知して Discord へ通知します。")
    prod_banner()
    st.subheader("Discord 送信テスト")
    ch  = st.text_input("送信先チャンネルID", value=secrets.get("discord_channel_id", ""))
    msg = st.text_input("テストメッセージ", value="【テスト】予約通知の送信確認です")
    if st.button("送信テスト", type="primary"):
        token = secrets.get("discord_bot_token")
        if not token:
            st.error("Discord トークンが未設定です。")
        elif not ch:
            st.error("チャンネルIDを入力してください。")
        else:
            ok, info = core.send_discord_message(token, ch, msg)
            (st.success if ok else st.error)(info)

# ============================================================
# シフト反映
# ============================================================
elif page == "シフト反映（準備中）":
    st.title("シフト反映（本番 Firestore へ）")
    st.info("準備中。シフト表.xlsx の日付シートを読み、本番 Firestore へ反映します。")
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
        st.warning("日付シート（YYYYMMDD 形式）が見つかりません。")
        st.stop()

    sheet = st.selectbox("反映する日付シート", sheets)
    df = core.load_shift_sheet(src, sheet)
    st.caption(f"{len(df)} 件")
    st.dataframe(df, use_container_width=True, hide_index=True)

# ============================================================
# 設定
# ============================================================
elif page == "設定":
    st.title("設定")
    st.subheader("秘密情報の読み込み状況")
    rows = {
        "項目": ["Discord Bot トークン", "Discord チャンネルID", "Firebase 鍵パス"],
        "値": [
            core.mask(secrets.get("discord_bot_token", "")),
            secrets.get("discord_channel_id", "(未設定)"),
            secrets.get("firebase_key_path", "(未設定)"),
        ],
    }
    st.table(rows)
    st.info(
        "秘密情報は `secrets_local.json`（ローカル）または "
        "Streamlit Cloud の Secrets（クラウド）から読み込みます。"
    )
