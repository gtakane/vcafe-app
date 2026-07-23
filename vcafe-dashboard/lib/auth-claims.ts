import type { Role } from "./types";

export interface ClaimRequest {
  uid: string;
  role: Role;
  maidId?: string;
}

export function validateClaimRequest(request: ClaimRequest) {
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(request.uid)) throw new Error("UIDの形式が不正です");
  if (request.role !== "admin" && request.role !== "maid") throw new Error("roleはadminまたはmaidを指定してください");
  if (request.role === "maid" && !request.maidId?.trim()) throw new Error("メイド権限にはmaidIdが必要です");
  if (request.maidId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.maidId)) throw new Error("maidIdの形式が不正です");
}

export function buildCustomClaims(existing: Record<string, unknown>, request: ClaimRequest) {
  validateClaimRequest(request);
  const claims: Record<string, unknown> = { ...existing, role: request.role };
  if (request.role === "maid") return { ...claims, maidId: request.maidId!.trim() };
  const { maidId: _removed, ...adminClaims } = claims;
  return adminClaims;
}
