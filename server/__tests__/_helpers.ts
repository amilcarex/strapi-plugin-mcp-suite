/**
 * Helpers compartidos por todos los tests.
 *
 * Mock factory para Strapi v5: emula los campos que el plugin lee
 * (contentTypes, components, db, plugin, service, log).
 */

export type MockStrapi = {
  contentTypes: Record<string, any>;
  components: Record<string, any>;
  log: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
  db: {
    query: (uid: string) => {
      findOne: (q: any) => Promise<any>;
      findMany: (q: any) => Promise<any[]>;
    };
  };
  documents: (uid: string) => any;
  plugin: (name: string) => any;
  service: (uid: string) => any;
  config: any;
};

export function makeMockStrapi(opts: {
  contentTypes?: Record<string, any>;
  components?: Record<string, any>;
  apiTokenService?: any;
  contentManagerService?: any;
  uploadService?: any;
  graphqlPlugin?: any;
  documentsImpl?: (uid: string) => any;
  dbQueryImpl?: (uid: string) => any;
  strapiVersion?: string;
} = {}): MockStrapi {
  const logs: { level: string; args: any[] }[] = [];
  const log = {
    info: (...a: any[]) => logs.push({ level: "info", args: a }),
    warn: (...a: any[]) => logs.push({ level: "warn", args: a }),
    error: (...a: any[]) => logs.push({ level: "error", args: a }),
  };

  const defaultPlugins: Record<string, any> = {};
  if (opts.contentManagerService) {
    defaultPlugins["content-manager"] = {
      service: (svc: string) =>
        svc === "content-types" || svc === "components" ? opts.contentManagerService : null,
    };
  }
  if (opts.uploadService) {
    defaultPlugins["upload"] = { service: () => opts.uploadService };
  }
  if (opts.graphqlPlugin) {
    defaultPlugins["graphql"] = opts.graphqlPlugin;
  }

  return {
    contentTypes: opts.contentTypes ?? {},
    components: opts.components ?? {},
    log,
    db: {
      query: opts.dbQueryImpl ?? ((uid: string) => ({
        findOne: async () => null,
        findMany: async () => [],
      })),
    } as any,
    documents:
      opts.documentsImpl ??
      ((_uid: string) => ({
        findMany: async () => [],
        findOne: async () => null,
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        publish: async () => ({}),
        unpublish: async () => ({}),
        count: async () => 0,
      })),
    plugin: (name: string) => defaultPlugins[name] ?? null,
    service: (uid: string) => {
      if (uid === "admin::api-token") return opts.apiTokenService ?? null;
      return null;
    },
    config: {
      info: { strapi: opts.strapiVersion ?? "5.46.0" },
    },
  };
}

/** Captura los logs en orden para que los tests puedan assertear sobre ellos. */
export function captureLogs(strapi: MockStrapi): { level: string; args: any[] }[] {
  return (strapi.log as any).__captured ?? [];
}

/** Wrapper para esperar varias promesas en paralelo y devolver sus settle states. */
export async function settleAll<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(promises);
}
