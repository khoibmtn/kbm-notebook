export type Role = "owner" | "admin" | "editor" | "viewer";

/** Thấp → cao: viewer < editor < admin < owner. */
export const ROLE_ORDER: readonly Role[] = ["viewer", "editor", "admin", "owner"] as const;

export function roleRank(role: Role): number {
  return ROLE_ORDER.indexOf(role);
}

export function hasRole(role: Role | null | undefined, min: Role): boolean {
  return role != null && roleRank(role) >= roleRank(min);
}

/** Vai trò mà `actor` được gán cho người khác: owner gán admin trở xuống; admin chỉ gán editor/viewer. */
export function assignableRoles(actor: Role): Role[] {
  return ROLE_ORDER.filter((r) => r !== "owner" && (actor === "owner" || roleRank(r) < roleRank(actor)));
}

export function canAssignRole(actor: Role, target: Role): boolean {
  return assignableRoles(actor).includes(target);
}
