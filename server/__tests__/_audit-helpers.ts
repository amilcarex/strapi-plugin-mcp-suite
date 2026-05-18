/**
 * Shared helpers for the audit-system tests. Build a Strapi mock that records
 * every DB call so each test can assert on what was inserted/updated/deleted,
 * and exposes a lifecycle.subscribe capture so the test can invoke the
 * registered hooks directly.
 */

export type DbCall =
  | { uid: string; op: "create"; data: any }
  | { uid: string; op: "findOne"; query: any }
  | { uid: string; op: "findMany"; query: any }
  | { uid: string; op: "updateMany"; query: any }
  | { uid: string; op: "deleteMany"; query: any }
  | { uid: string; op: "count"; query: any };

export interface CapturedLifecycle {
  models: string[];
  afterCreate?: (event: any) => Promise<void> | void;
  beforeDelete?: (event: any) => Promise<void> | void;
  afterDelete?: (event: any) => Promise<void> | void;
}

export interface AuditMockOptions {
  /**
   * Per-UID per-op handler. If absent for a given (uid, op), the call returns
   * a sensible default (empty array, null, etc.) and is still recorded in
   * `dbCalls`. The function can throw to simulate DB errors.
   */
  dbHandlers?: Record<string, Partial<Record<DbCall["op"], (query: any) => any>>>;
  /**
   * Value returned by `strapi.requestContext.get()?.state?.user`. Pass null to
   * simulate "no request context".
   */
  currentUser?: any | null;
}

export function buildAuditMockStrapi(opts: AuditMockOptions = {}) {
  const dbCalls: DbCall[] = [];
  const captured: CapturedLifecycle[] = [];
  const logs: { level: string; args: any[] }[] = [];
  const log = {
    info: (...a: any[]) => logs.push({ level: "info", args: a }),
    warn: (...a: any[]) => logs.push({ level: "warn", args: a }),
    error: (...a: any[]) => logs.push({ level: "error", args: a }),
  };

  function callHandler(uid: string, op: DbCall["op"], query: any): any {
    const handler = opts.dbHandlers?.[uid]?.[op];
    if (handler) return handler(query);
    // Defaults: findMany -> [], findOne -> null, create/update/delete -> ok stub
    switch (op) {
      case "findMany":
        return [];
      case "findOne":
        return null;
      case "count":
        return 0;
      default:
        return { id: 1 };
    }
  }

  const strapi: any = {
    log,
    db: {
      query: (uid: string) => ({
        create: async (q: any) => {
          dbCalls.push({ uid, op: "create", data: q?.data });
          return callHandler(uid, "create", q);
        },
        findOne: async (q: any) => {
          dbCalls.push({ uid, op: "findOne", query: q });
          return callHandler(uid, "findOne", q);
        },
        findMany: async (q: any) => {
          dbCalls.push({ uid, op: "findMany", query: q });
          return callHandler(uid, "findMany", q);
        },
        updateMany: async (q: any) => {
          dbCalls.push({ uid, op: "updateMany", query: q });
          return callHandler(uid, "updateMany", q);
        },
        deleteMany: async (q: any) => {
          dbCalls.push({ uid, op: "deleteMany", query: q });
          return callHandler(uid, "deleteMany", q);
        },
        count: async (q: any) => {
          dbCalls.push({ uid, op: "count", query: q });
          return callHandler(uid, "count", q);
        },
      }),
      lifecycles: {
        subscribe: (sub: CapturedLifecycle) => {
          captured.push(sub);
        },
      },
    },
    requestContext: {
      get: () => (opts.currentUser !== undefined ? { state: { user: opts.currentUser } } : undefined),
    },
  };

  return { strapi, dbCalls, captured, logs };
}

export const FAKE_SUPER_ADMIN = {
  id: 1,
  email: "boss@example.com",
  roles: [{ code: "strapi-super-admin", name: "Super Admin" }],
};

export const FAKE_REGULAR_USER = {
  id: 2,
  email: "user@example.com",
  roles: [{ code: "strapi-editor", name: "Editor" }],
};

export const FAKE_CREATOR_USER = {
  id: 5,
  email: "creator@example.com",
  roles: [{ code: "strapi-editor", name: "Editor" }],
};
