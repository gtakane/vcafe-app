"use client";

import { createContext, useContext } from "react";
import { TEST_USERS_PARAM } from "@/lib/test-users";

/**
 * 「テストユーザーを含める」の切り替え（管理者のみ・既定は含めない）。
 * 画面の各部品が個別に API を呼ぶため、props で受け渡さず context で共有する。
 */
export const TestUserScopeContext = createContext(false);

export function useIncludeTestUsers(): boolean {
  return useContext(TestUserScopeContext);
}

/** API のクエリに切り替えを足す（含めるときだけ ?testUsers=include）。 */
export function withTestUsers(params: URLSearchParams, include: boolean): URLSearchParams {
  if (include) params.set(TEST_USERS_PARAM, "include");
  return params;
}
