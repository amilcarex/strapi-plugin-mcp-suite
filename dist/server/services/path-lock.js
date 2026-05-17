"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquirePathLock = acquirePathLock;
exports._getActiveLockCountForTest = _getActiveLockCountForTest;
const locks = new Map();
async function acquirePathLock(absolutePath) {
    var _a;
    // Encolar detrás del lock previo (si existe)
    const previous = (_a = locks.get(absolutePath)) !== null && _a !== void 0 ? _a : Promise.resolve();
    let releaseFn;
    const myTurn = new Promise((resolve) => {
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
function _getActiveLockCountForTest() {
    return locks.size;
}
