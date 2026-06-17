# -*- coding: utf-8 -*-
import json
import re
from datetime import datetime, date, time
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

import core

BASE = Path(__file__).parent
st.set_page_config(page_title="Vあっと運営アプリ", page_icon="💗", layout="wide")

# ============================================================
# デザイントークン
# ============================================================
PINK       = "#F96CB4"
PINK_LIGHT = "#FFF0F7"
PINK_MID   = "#FFD6EC"
PINK_DARK  = "#d44a8f"
GRAY       = "#888888"
DARK       = "#1A1A2E"
BG         = "#FAFAFA"
WHITE      = "#FFFFFF"

# ============================================================
# CSS
# ============================================================
st.markdown(f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;800&display=swap');

html, body, [class*="css"], .stApp, .stMarkdown, p, label {{
    font-family: 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', sans-serif !important;
}}

/* カレンダーポップアップのフォントを明示指定（span を個別に当てて衝突を防ぐ） */
[data-baseweb="calendar"] span,
[data-baseweb="calendar"] div {{
    font-family: 'Noto Sans JP', 'Yu Gothic UI', 'Hiragino Kaku Gothic ProN', sans-serif !important;
}}

.stApp {{ background-color: {BG} !important; }}

.main .block-container {{
    max-width: 1100px !important;
    margin-left: auto !important;
    margin-right: auto !important;
    padding: 1rem 2rem 4rem !important;
}}

/* ===== KPI カード ===== */
[data-testid="stMetric"] {{
    background: {WHITE} !important;
    border-radius: 16px !important;
    padding: 0.9rem 1rem !important;
    box-shadow: 0 2px 8px rgba(249,108,180,0.10) !important;
    border: 1.5px solid {PINK_MID} !important;
}}
[data-testid="stMetricLabel"] > div {{
    font-size: 0.7rem !important;
    font-weight: 600 !important;
    color: {GRAY} !important;
    letter-spacing: 0.05em !important;
    text-transform: uppercase !important;
}}
[data-testid="stMetricValue"] > div {{
    font-size: 1.5rem !important;
    font-weight: 800 !important;
    color: {DARK} !important;
    line-height: 1.15 !important;
}}

/* ===== ボタン (Streamlit 1.36+) ===== */
[data-testid="stBaseButton-primary"],
[data-testid="baseButton-primary"] {{
    background: {PINK} !important;
    border: none !important;
    border-radius: 10px !important;
    font-weight: 700 !important;
    font-size: 0.88rem !important;
    color: {WHITE} !important;
    letter-spacing: 0.02em !important;
    padding: 0.45rem 1.2rem !important;
}}
[data-testid="stBaseButton-secondary"],
[data-testid="baseButton-secondary"] {{
    background: {WHITE} !important;
    border: 2px solid {PINK} !important;
    border-radius: 10px !important;
    font-weight: 700 !important;
    color: {PINK} !important;
}}

/* ===== タブ ===== */
[data-testid="stTabs"] [data-baseweb="tab-list"] {{
    gap: 4px !important;
    border-bottom: 2px solid {PINK_MID} !important;
}}
[data-testid="stTabs"] button[role="tab"] {{
    font-weight: 600 !important;
    font-size: 0.86rem !important;
    color: {GRAY} !important;
    padding: 0.5rem 1rem !important;
    border-radius: 6px 6px 0 0 !important;
    border-bottom: 3px solid transparent !important;
}}
[data-testid="stTabs"] button[role="tab"][aria-selected="true"] {{
    color: {PINK} !important;
    border-bottom: 3px solid {PINK} !important;
    background: {PINK_LIGHT} !important;
}}

/* ===== データフレーム ===== */
[data-testid="stDataFrame"] {{
    border-radius: 12px !important;
    border: 1.5px solid {PINK_MID} !important;
    overflow: hidden !important;
}}

/* ===== expander ===== */
[data-testid="stExpander"] {{
    background: {WHITE} !important;
    border-radius: 12px !important;
    border: 1.5px solid {PINK_MID} !important;
}}

/* ===== 区切り線・caption ===== */
hr {{ border-color: {PINK_MID} !important; margin: 1rem 0 !important; }}
[data-testid="stCaptionContainer"] p {{
    color: {GRAY} !important;
    font-size: 0.78rem !important;
}}

/* ===== selectbox / input ===== */
[data-testid="stSelectbox"] > div,
[data-baseweb="input"] input {{
    border-radius: 8px !important;
}}

/* ===== pills（環境切り替え）===== */
[data-testid="stPills"] button {{
    font-size: 0.78rem !important;
    font-weight: 600 !important;
    border-radius: 20px !important;
    padding: 0.2rem 0.8rem !important;
}}

/* ===== アプリヘッダー ===== */
.vcafe-header {{
    display: flex;
    align-items: flex-end;
    padding: 0.5rem 0 0.8rem;
    border-bottom: 2px solid {PINK_MID};
    margin-bottom: 0.2rem;
}}
.vcafe-header-title {{
    font-size: 1.4rem;
    font-weight: 800;
    color: {DARK};
    letter-spacing: -0.02em;
    line-height: 1.2;
}}
.vcafe-header-sub {{
    font-size: 0.65rem;
    color: {GRAY};
    letter-spacing: 0.1em;
    margin-top: 2px;
}}
.vcafe-data-ts {{
    background: {PINK_LIGHT};
    border-radius: 8px;
    padding: 0.3rem 0.8rem;
    font-size: 0.75rem;
    color: {GRAY};
    text-align: center;
    margin: 0.6rem 0 1rem;
}}
.vcafe-section {{
    font-size: 0.92rem;
    font-weight: 700;
    color: {DARK};
    padding: 0.7rem 0 0.35rem;
    border-bottom: 2px solid {PINK_LIGHT};
    margin-bottom: 0.6rem;
}}
</style>
""", unsafe_allow_html=True)


# ============================================================
# ヘルパー UI
# ============================================================
def page_header(title: str, sub: str = "", mt=None):
    ts = mt.strftime("%Y/%m/%d %H:%M") if mt else datetime.now().strftime("%Y/%m/%d %H:%M")
    sub_html = f'<div style="font-size:.8rem;color:{GRAY};margin-top:3px;">{sub}</div>' if sub else ""
    st.markdown(f"""
<div style="text-align:center;padding:1rem 0 0.2rem">
  <div style="font-size:1.45rem;font-weight:800;color:{DARK};letter-spacing:-0.02em;">{title}</div>
  {sub_html}
  <div style="height:3px;background:{PINK};border-radius:2px;width:56px;margin:.4rem auto 0;"></div>
</div>
<div class="vcafe-data-ts">{ts} 時点のデータ</div>
""", unsafe_allow_html=True)


def section_header(title: str):
    st.markdown(f'<div class="vcafe-section">{title}</div>', unsafe_allow_html=True)


def make_donut(paid: int, total: int) -> go.Figure:
    free = max(0, total - paid)
    rate = paid / total if total > 0 else 0
    fig = go.Figure(go.Pie(
        values=[max(paid, 0.001), max(free, 0.001)],
        hole=0.72,
        marker_colors=[PINK, "#F0F0F0"],
        textinfo="none",
        hoverinfo="skip",
        sort=False,
    ))
    fig.add_annotation(text=f"<b>{rate*100:.0f}%</b>",
                       x=0.5, y=0.58,
                       font=dict(size=28, color=DARK), showarrow=False)
    fig.add_annotation(text="有料率",
                       x=0.5, y=0.38,
                       font=dict(size=11, color=GRAY), showarrow=False)
    fig.update_layout(showlegend=False,
                      margin=dict(t=0, b=0, l=0, r=0),
                      height=190,
                      paper_bgcolor="rgba(0,0,0,0)")
    return fig


_PL = dict(
    paper_bgcolor="white",
    plot_bgcolor="#FFF8FC",
    font=dict(family="Noto Sans JP, sans-serif", size=11, color=DARK),
    margin=dict(t=28, b=8, l=8, r=8),
    showlegend=False,
)
_AX = dict(showgrid=True, gridcolor=PINK_LIGHT, zeroline=False, title="")


def hbar(df, y_col, x_col, color=PINK, title="", height=None):
    df_s = df.sort_values(x_col, ascending=True).tail(25)
    h = height or max(280, len(df_s) * 30)
    fig = px.bar(df_s, y=y_col, x=x_col, orientation="h",
                 text=x_col, title=title, height=h,
                 color_discrete_sequence=[color])
    fig.update_traces(textposition="outside", cliponaxis=False, marker_line_width=0)
    fig.update_yaxes(tickfont=dict(size=12), title="", automargin=True)
    fig.update_xaxes(title="")
    fig.update_layout(**_PL)
    fig.update_layout(margin=dict(t=28, b=8, l=8, r=48))
    return fig


def vbar(df, x_col, y_col, color=PINK, title="", text_fmt=None, height=260):
    fig = px.bar(df, x=x_col, y=y_col, title=title,
                 text=y_col, height=height,
                 color_discrete_sequence=[color])
    if text_fmt:
        fig.update_traces(texttemplate=text_fmt, textposition="outside")
    else:
        fig.update_traces(textposition="outside")
    fig.update_traces(marker_line_width=0, cliponaxis=False)
    fig.update_layout(**_PL)
    fig.update_xaxes(**_AX)
    fig.update_yaxes(**_AX)
    return fig


# ============================================================
# 秘密情報・セッション初期化
#   優先順位: 環境変数 > secrets_local.json > Streamlit Cloud の Secrets
#   ※ Streamlit Cloud では secrets_local.json を配置できないため、
#     ここで st.secrets の値を補完する（core.py は Streamlit に依存させない）。
# ============================================================
secrets = core.load_secrets(BASE)
try:
    cloud_secrets = st.secrets
    for _k in ("discord_bot_token", "discord_channel_id", "firebase_key_path"):
        if not secrets.get(_k) and _k in cloud_secrets:
            secrets[_k] = cloud_secrets[_k]
    if not secrets.get("firebase_key_json") and "firebase_key_json" in cloud_secrets:
        raw = cloud_secrets["firebase_key_json"]
        # [firebase_key_json] テーブル形式・JSON文字列形式のどちらでも読めるようにする
        secrets["firebase_key_json"] = json.loads(raw) if isinstance(raw, str) else dict(raw)
except Exception:
    pass

if "env" not in st.session_state:
    st.session_state.env = "テスト"


# ============================================================
# アプリヘッダー
# ============================================================
col_hd, col_env = st.columns([5, 1])
with col_hd:
    st.markdown(f"""
<div class="vcafe-header">
  <div>
    <div class="vcafe-header-title">💗 Vあっと運営アプリ</div>
    <div class="vcafe-header-sub">VIRTUAL AT-HOME CAFÉ OPERATIONS</div>
  </div>
</div>""", unsafe_allow_html=True)
with col_env:
    env_choice = st.pills(
        "環境", ["テスト", "本番"],
        default=st.session_state.env,
        key="env_pills",
        label_visibility="collapsed",
    )
    if env_choice:
        st.session_state.env = env_choice

IS_PROD = st.session_state.env == "本番"
if IS_PROD:
    st.error("⚠ 本番環境です。実行内容をよく確認してください。")


def prod_banner():
    if IS_PROD:
        st.error("⚠ 本番環境です。実行内容をよく確認してください。")


# ============================================================
# タブナビゲーション
# ============================================================
tab_home, tab_kintai, tab_visits, tab_rsv, tab_shift, tab_settings = st.tabs([
    "ホーム", "勤怠レポート", "お給仕実績", "予約通知", "シフト反映", "設定",
])


# ============================================================
# ホーム
# ============================================================
with tab_home:
    page_header("Vあっと運営アプリ", "バーチャルあっとほぉーむカフェ 内部管理")

    c1, c2, c3 = st.columns(3)
    c1.metric("環境", st.session_state.env)
    c2.metric("Discord Bot", "設定済み" if secrets.get("discord_bot_token") else "未設定")
    c3.metric("Firebase",    "設定済み" if secrets.get("firebase_key_path") or secrets.get("firebase_key_json") else "未設定")

    st.divider()
    section_header("機能ステータス")
    for icon, name, status, color in [
        ("✅", "勤怠レポート可視化",            "完成",  "#48c78e"),
        ("✅", "お給仕実績ダッシュボード",       "完成",  "#48c78e"),
        ("🔧", "予約通知（Firestore → Discord）", "開発中", PINK),
        ("🔧", "シフト反映（本番Firestore）",     "開発中", PINK),
    ]:
        st.markdown(
            f'<div style="display:flex;align-items:center;gap:.6rem;padding:.45rem 0;">'
            f'{icon} <span style="flex:1;font-size:.9rem;">{name}</span>'
            f'<span style="font-size:.72rem;font-weight:700;color:{color};">{status}</span></div>',
            unsafe_allow_html=True)

    st.markdown(
        f'<div style="margin-top:2rem;font-size:.68rem;color:{GRAY};text-align:center;">'
        f'build 2026-06-16</div>',
        unsafe_allow_html=True)


# ============================================================
# 勤怠レポート
# ============================================================
with tab_kintai:
    page_header("勤怠レポート", "kintai_report.py 出力の .xlsx を可視化")

    up = st.file_uploader("勤怠レポート .xlsx を選択", type=["xlsx"])
    default = BASE / "data" / "勤怠レポート_2026-06.xlsx"
    src = up if up is not None else (str(default) if default.exists() else None)

    if src is None:
        st.warning("レポートファイルを選択してください（または data/ に置いてください）。")
    else:
        try:
            summary = core.load_kintai_summary(src)
            detail  = core.load_kintai_detail(src)
        except Exception as e:
            st.error(f"読み込み失敗: {e}")
        else:
            kpi = core.summarize_kpis(summary, detail)
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("メイド数",     kpi["メイド数"])
            c2.metric("総シフト数",   kpi["総シフト数"])
            c3.metric("平均欠勤率",   f"{kpi['平均欠勤率']*100:.1f}%")
            c4.metric("当日連絡件数", kpi["当日連絡件数"])

            st.divider()
            section_header("欠勤率ランキング（上位 15 名）")
            rank = (summary[summary["シフト数"] > 0]
                    .sort_values("欠勤率", ascending=False)
                    [["メイド名", "シフト数", "欠勤", "欠勤率"]].head(15))
            fig_rank = px.bar(rank, y="メイド名", x="欠勤率", orientation="h", text="欠勤率",
                              color_discrete_sequence=[PINK_DARK],
                              height=max(280, len(rank) * 30))
            fig_rank.update_traces(texttemplate="%{text:.1%}", textposition="outside",
                                   marker_line_width=0)
            fig_rank.update_xaxes(tickformat=".0%", title="")
            fig_rank.update_yaxes(title="", automargin=True)
            fig_rank.update_layout(**_PL)
            st.plotly_chart(fig_rank, use_container_width=True)

            section_header("一覧")
            show = summary.copy()
            show["欠勤率"] = (show["欠勤率"] * 100).round(1).astype(str) + "%"
            show["遅刻率"] = (show["遅刻率"] * 100).round(1).astype(str) + "%"
            st.dataframe(show, use_container_width=True, hide_index=True)

            if not detail.empty and "種別" in detail.columns:
                section_header("種別ごとの件数")
                vc = detail["種別"].value_counts().reset_index()
                vc.columns = ["種別", "件数"]
                st.plotly_chart(vbar(vc, "種別", "件数"), use_container_width=True)

            st.download_button(
                "サマリーをCSVで保存",
                summary.to_csv(index=False).encode("utf-8-sig"),
                file_name="勤怠サマリー.csv", mime="text/csv", type="primary",
            )


# ============================================================
# お給仕実績
# ============================================================
with tab_visits:
    mt = core.cache_mtime(BASE, "visits", st.session_state.env)
    page_header("お給仕実績", "Vあっとほぉーむカフェ ご帰宅データ", mt)
    prod_banner()

    # ---- 期間選択・データ取得 ----
    today = date.today()
    with st.expander("期間・データ取得", expanded=not bool(mt)):
        c1, c2 = st.columns(2)
        start_date = c1.date_input("開始日", value=today.replace(day=1))
        end_date   = c2.date_input("終了日", value=today)
        do_fetch   = st.button("Firestoreから再取得", type="primary",
                               use_container_width=True)
        if mt:
            st.caption(f"キャッシュ最終更新: {mt.strftime('%Y-%m-%d %H:%M')}")
        else:
            st.caption("キャッシュなし — まずデータ取得を実行してください")

    if do_fetch:
        if not secrets.get("firebase_key_path") and not secrets.get("firebase_key_json"):
            st.error("Firebase鍵が未設定です（設定タブ参照）。")
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
    else:
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
        else:
            if "visitWeight" not in df_v.columns:
                df_v["visitWeight"] = 1

            # ---- 集計 ----
            paid          = df_v[df_v["type"] == "有料"]
            cheki         = core.agg_cheki(df_c, df_v)
            visit_revenue = df_v["revenue"].sum()
            cheki_revenue = cheki["total"] * core.CHEKI_PRICE
            total_revenue = visit_revenue + cheki_revenue
            avg_unit      = float(paid["revenue"].mean()) if not paid.empty else 0.0
            total_visits  = int(df_v["visitWeight"].sum())
            paid_visits   = int((df_v["visitWeight"] * (df_v["type"] == "有料").astype(int)).sum())
            free_visits   = total_visits - paid_visits
            rsv_count     = int((df_v["roomType"] == "reservation").sum())

            # ---- KPI ----
            section_header("サマリー")
            c1, c2, c3 = st.columns(3)
            c1.metric("総ご帰宅数",   f"{total_visits:,}")
            c2.metric("有料ご帰宅数", f"{paid_visits:,}")
            c3.metric("予約数",       f"{rsv_count:,}")

            c4, c5, c6, c7 = st.columns(4)
            c4.metric("総売上（推計）",   f"¥{total_revenue:,.0f}")
            c5.metric("平均単価（有料）", f"¥{avg_unit:,.0f}")
            c6.metric("総チェキ数",       f"{cheki['total']:,}")
            c7.metric("チェキ装着率",     f"{cheki['rate']*100:.1f}%")

            # ---- ドーナツ + 内訳 ----
            st.divider()
            dc, ic = st.columns([1, 1])
            with dc:
                st.plotly_chart(make_donut(paid_visits, total_visits),
                                use_container_width=True)
            with ic:
                st.markdown(f"""
<div style="padding:.6rem 0">
  <div style="font-size:.72rem;color:{GRAY};font-weight:600;text-transform:uppercase;
       letter-spacing:.06em;margin-bottom:.7rem;">ご帰宅 内訳</div>
  <div style="display:flex;align-items:center;margin-bottom:.55rem;">
    <span style="width:10px;height:10px;border-radius:2px;background:{PINK};
          display:inline-block;flex-shrink:0;"></span>
    <span style="margin-left:.5rem;font-size:.88rem;flex:1;">有料</span>
    <span style="font-size:1rem;font-weight:800;color:{DARK};">{paid_visits:,} 件</span>
  </div>
  <div style="display:flex;align-items:center;margin-bottom:.55rem;">
    <span style="width:10px;height:10px;border-radius:2px;background:#F0F0F0;
          display:inline-block;flex-shrink:0;"></span>
    <span style="margin-left:.5rem;font-size:.88rem;flex:1;">無料・テスト</span>
    <span style="font-size:1rem;font-weight:800;color:{DARK};">{free_visits:,} 件</span>
  </div>
  <div style="display:flex;align-items:center;margin-bottom:.55rem;">
    <span style="width:10px;height:10px;border-radius:2px;background:#48c78e;
          display:inline-block;flex-shrink:0;"></span>
    <span style="margin-left:.5rem;font-size:.88rem;flex:1;">予約</span>
    <span style="font-size:1rem;font-weight:800;color:{DARK};">{rsv_count:,} 件</span>
  </div>
  <div style="height:1px;background:{PINK_LIGHT};margin:.7rem 0;"></div>
  <div style="display:flex;align-items:center;">
    <span style="font-size:.88rem;flex:1;font-weight:600;">合計売上（推計）</span>
    <span style="font-size:1.1rem;font-weight:800;color:{PINK};">¥{total_revenue:,.0f}</span>
  </div>
</div>
""", unsafe_allow_html=True)

            # ---- 日次推移 ----
            st.divider()
            section_header("日次推移")
            daily = core.agg_daily(df_v)
            if not daily.empty:
                tab1, tab2 = st.tabs(["ご帰宅数", "売上（推計）"])
                with tab1:
                    st.plotly_chart(vbar(daily, "date", "ご帰宅数", color=PINK),
                                    use_container_width=True)
                with tab2:
                    st.plotly_chart(vbar(daily, "date", "売上", color="#48c78e",
                                         text_fmt="¥%{text:,.0f}"),
                                    use_container_width=True)

            # ---- メイド別実績 ----
            st.divider()
            section_header("メイド別実績")
            maid_df = core.agg_by_maid(df_v, df_c, df_sh)

            tab_g, tab_t = st.tabs(["グラフ", "テーブル"])
            with tab_g:
                sub1, sub2 = st.columns(2)
                with sub1:
                    st.plotly_chart(hbar(maid_df, "maidNickname", "ご帰宅数",
                                         color=PINK, title="ご帰宅数"),
                                    use_container_width=True)
                with sub2:
                    fig_ms = hbar(maid_df, "maidNickname", "合計売上",
                                  color="#48c78e", title="合計売上")
                    fig_ms.update_traces(texttemplate="¥%{x:,.0f}")
                    st.plotly_chart(fig_ms, use_container_width=True)
            with tab_t:
                _yen = st.column_config.NumberColumn(format="¥%,.0f")
                _col_cfg = {
                    "maidNickname": st.column_config.TextColumn("メイド名", width="medium"),
                    "ご帰宅数":     st.column_config.NumberColumn("ご帰宅数"),
                    "有料数":       st.column_config.NumberColumn("有料数"),
                    "予約数":       st.column_config.NumberColumn("予約数"),
                    "ご帰宅売上":   _yen, "チェキ売上": _yen,
                    "合計売上":     _yen, "平均単価":   _yen,
                }
                if "稼働時間数" in maid_df.columns:
                    _col_cfg["稼働時間数"]   = st.column_config.NumberColumn("稼働時間(h)", format="%.1f")
                    _col_cfg["遅刻合計分"]   = st.column_config.NumberColumn("遅刻(分)")
                    _col_cfg["平均ご帰宅数"] = st.column_config.NumberColumn("平均(/h)", format="%.2f")
                st.dataframe(maid_df, column_config=_col_cfg,
                             use_container_width=True, hide_index=True)

            # ---- 時間帯・曜日 ----
            st.divider()
            section_header("時間帯・曜日別")
            ca, cb = st.columns(2)
            with ca:
                hour_df = core.agg_by_hour(df_v)
                fig_h = vbar(hour_df, "hour", "ご帰宅数", color=PINK, title="時間帯別（JST）")
                fig_h.update_xaxes(dtick=2, title="時")
                st.plotly_chart(fig_h, use_container_width=True)
            with cb:
                wday_df = core.agg_by_weekday(df_v)
                st.plotly_chart(vbar(wday_df, "weekday", "ご帰宅数",
                                     color=PINK_DARK, title="曜日別"),
                                use_container_width=True)

            # ---- コース別 ----
            st.divider()
            section_header("コース別（チケット種別）")
            ticket_df = core.agg_by_ticket(df_v)
            ca, cb = st.columns([3, 2])
            with ca:
                st.plotly_chart(hbar(ticket_df, "usedTicketItemId", "件数",
                                     color="#f59e0b", title="チケット種別"),
                                use_container_width=True)
            with cb:
                st.dataframe(ticket_df,
                             column_config={"売上": st.column_config.NumberColumn(format="¥%,.0f")},
                             use_container_width=True, hide_index=True)

            # ---- チェキ実績 ----
            st.divider()
            section_header("チェキ実績")
            if df_c.empty:
                st.info("選択期間のチェキデータがありません。")
            else:
                ca, cb = st.columns(2)
                with ca:
                    if not cheki["by_maid"].empty:
                        st.plotly_chart(hbar(cheki["by_maid"], "maidNickname", "チェキ数",
                                             color=PINK_DARK, title="メイド別チェキ数"),
                                        use_container_width=True)
                with cb:
                    if not cheki["daily"].empty:
                        dly = cheki["daily"].copy()
                        dly["date"] = dly["date"].astype(str)
                        st.plotly_chart(vbar(dly, "date", "チェキ数",
                                             color=PINK, title="日次チェキ数"),
                                        use_container_width=True)


# ============================================================
# 予約通知
# ============================================================
with tab_rsv:
    page_header("予約通知", "Firestore → Discord 通知（開発中）")
    prod_banner()
    st.info("準備中。Firestore `reservations` の rsvStatus 変化を検知して Discord へ通知します。")

    section_header("Discord 送信テスト")
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
with tab_shift:
    page_header("シフト反映", "シフト表.xlsx → 本番 Firestore（開発中）")
    prod_banner()
    st.info("準備中。シフト表.xlsx の日付シートを読み、本番 Firestore へ反映します。")

    up_s = st.file_uploader("シフト表.xlsx を選択", type=["xlsx"])
    default_s = BASE / "data" / "シフト表.xlsx"
    src_s = up_s if up_s is not None else (str(default_s) if default_s.exists() else None)

    if src_s is None:
        st.warning("シフト表を選択してください。")
    else:
        try:
            sheets = core.list_shift_date_sheets(src_s)
        except Exception as e:
            st.error(f"読み込み失敗: {e}")
        else:
            if not sheets:
                st.warning("日付シート（YYYYMMDD 形式）が見つかりません。")
            else:
                sheet = st.selectbox("反映する日付シート", sheets)
                df_sh2 = core.load_shift_sheet(src_s, sheet)
                st.caption(f"{len(df_sh2)} 件")
                st.dataframe(df_sh2, use_container_width=True, hide_index=True)


# ============================================================
# 設定
# ============================================================
with tab_settings:
    page_header("設定", "秘密情報・接続設定")

    section_header("秘密情報の読み込み状況")
    st.table({
        "項目": ["Discord Bot トークン", "Discord チャンネルID", "Firebase 鍵パス"],
        "値": [
            core.mask(secrets.get("discord_bot_token", "")),
            secrets.get("discord_channel_id", "(未設定)"),
            secrets.get("firebase_key_path", "(未設定)"),
        ],
    })
    st.info("秘密情報は `secrets_local.json`（ローカル）または Streamlit Cloud の Secrets（クラウド）から読み込みます。")
