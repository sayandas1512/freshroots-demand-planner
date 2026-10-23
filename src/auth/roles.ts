export const ROLES = ["planner", "sponsor", "data", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { planner: "Planner", sponsor: "Sponsor", data: "Data analyst", admin: "Admin" };

/** What each role may do. `stop` is deliberately open to everyone signed in. */
export const PERMISSIONS = {
  view: ["planner", "sponsor", "data", "admin"],
  decide: ["planner", "admin"],
  run: ["planner", "data", "sponsor", "admin"],
  upload: ["data", "admin"],
  editRules: ["planner", "admin"],
  editSwitches: ["sponsor", "admin"],
  editKill: ["sponsor", "admin"],
  clearKill: ["sponsor", "admin"],
  stop: ["planner", "sponsor", "data", "admin"],
  outcomes: ["data", "sponsor", "admin"],
  export: ["planner", "admin"],
  backtest: ["planner", "sponsor", "admin"],
  manageUsers: ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role !== null && role !== undefined && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
