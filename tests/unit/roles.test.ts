import { describe, expect, it } from "vitest";
import { assignableRoles, canAssignRole, hasRole, roleRank } from "@/lib/roles";

describe("roles", () => {
  it("thứ tự owner > admin > editor > viewer", () => {
    expect(roleRank("owner")).toBeGreaterThan(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("editor"));
    expect(roleRank("editor")).toBeGreaterThan(roleRank("viewer"));
  });

  it("hasRole so sánh theo cấp", () => {
    expect(hasRole("admin", "editor")).toBe(true);
    expect(hasRole("editor", "admin")).toBe(false);
    expect(hasRole("viewer", "viewer")).toBe(true);
    expect(hasRole(null, "viewer")).toBe(false);
  });

  it("owner gán được admin/editor/viewer, không gán owner", () => {
    expect(assignableRoles("owner").sort()).toEqual(["admin", "editor", "viewer"]);
  });

  it("admin chỉ gán vai trò thấp hơn mình", () => {
    expect(assignableRoles("admin").sort()).toEqual(["editor", "viewer"]);
    expect(canAssignRole("admin", "admin")).toBe(false);
    expect(canAssignRole("admin", "owner")).toBe(false);
  });

  it("editor/viewer không gán được ai ngang hoặc cao hơn", () => {
    expect(assignableRoles("editor")).toEqual(["viewer"]);
    expect(assignableRoles("viewer")).toEqual([]);
  });
});
