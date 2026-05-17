/**
 * Simple in-process mutex por path absoluto.
 *
 * Uso:
 *   const release = await acquirePathLock(absolutePath);
 *   try { ...read+mutate+write... } finally { release(); }
 *
 * Evita race conditions en operaciones read-modify-write sobre el mismo
 * schema.json (ej: dos add_field_to_schema concurrentes pisándose entre sí).
 *
 * Es in-process, NO distribuido — si tenés múltiples instancias de Strapi
 * detrás de un load balancer, cada una tiene su propio lock map. Para evitar
 * el problema completo en multi-instancia, schema authoring debería hacerse
 * desde una sola instancia (es una operación de dev, no debería ser un caso real).
 */

const locks: Map<string, Promise<void>> = new Map();

export async function acquirePathLock(absolutePath: string): Promise<() => void> {
  // Encolar detrás del lock previo (si existe)
  const previous = locks.get(absolutePath) ?? Promise.resolve();
  let releaseFn!: () => void;
  const myTurn = new Promise<void>((resolve) => {
    releaseFn = () => {
      // Limpiar la entrada solo si soy el último en la cola para este path
      if (locks.get(absolutePath) === myTurn) {
        locks.delete(absolutePath);
      }
      resolve();
    };
  });
  locks.set(absolutePath, previous.then(() => myTurn));
  await previous;
  return releaseFn;
}

export function _getActiveLockCountForTest(): number {
  return locks.size;
}
