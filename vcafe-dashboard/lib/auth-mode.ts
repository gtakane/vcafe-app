export type AuthMode = "firebase" | "demo";

/**
 * 認証モードを決定する。**fail-closed** であることがこの関数の存在理由。
 *
 * Cloud Run は --allow-unauthenticated で公開されているため、環境変数の欠落や誤記で
 * 認証が素通りすると全データが無認証で公開される。したがって:
 *   - AUTH_MODE が "firebase" / "demo" のいずれでもなければ**例外を投げて起動を止める**
 *   - "demo" は NODE_ENV が production 以外のときだけ許可する
 * 既定値へのフォールバックは行わない（既定値こそが fail-open の入口になるため）。
 */
export function resolveAuthMode(env: { NODE_ENV?: string; AUTH_MODE?: string }): AuthMode {
  const mode = env.AUTH_MODE;
  const isProduction = env.NODE_ENV === "production";

  if (mode === "firebase") return "firebase";

  if (mode === "demo") {
    if (isProduction) {
      throw new Error("AUTH_MODE=demo は本番環境では使用できません。AUTH_MODE=firebase を設定してください");
    }
    return "demo";
  }

  throw new Error(
    `AUTH_MODE が不正です（受け取った値: ${mode === undefined ? "未設定" : JSON.stringify(mode)}）。` +
    "firebase を設定してください（開発時のみ demo を指定できます）",
  );
}
