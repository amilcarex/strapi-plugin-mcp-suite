"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const path_lock_1 = require("../services/path-lock");
(0, node_test_1.test)("path-lock: dos calls sobre el mismo path se serializan", async () => {
    const path = "/tmp/test-schema.json";
    const order = [];
    // Primera operación: bloquea el path, hace algo que tarda, libera
    const op1 = (async () => {
        const release = await (0, path_lock_1.acquirePathLock)(path);
        order.push("op1-acquired");
        await new Promise((r) => setTimeout(r, 50));
        order.push("op1-releasing");
        release();
    })();
    // Microtask delay para asegurar que op1 entra primero al lock
    await new Promise((r) => setImmediate(r));
    // Segunda operación: debería esperar a que op1 libere
    const op2 = (async () => {
        const release = await (0, path_lock_1.acquirePathLock)(path);
        order.push("op2-acquired");
        release();
    })();
    await Promise.all([op1, op2]);
    // Orden esperado: op1 entra → op1 libera → op2 entra
    assert.deepEqual(order, ["op1-acquired", "op1-releasing", "op2-acquired"]);
});
(0, node_test_1.test)("path-lock: calls sobre paths distintos NO se serializan", async () => {
    const order = [];
    const op1 = (async () => {
        const release = await (0, path_lock_1.acquirePathLock)("/tmp/a.json");
        order.push("op1-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("op1-end");
        release();
    })();
    const op2 = (async () => {
        const release = await (0, path_lock_1.acquirePathLock)("/tmp/b.json");
        order.push("op2-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("op2-end");
        release();
    })();
    await Promise.all([op1, op2]);
    // op2 termina antes que op1 porque están en paths distintos = paralelo real
    const op2EndIdx = order.indexOf("op2-end");
    const op1EndIdx = order.indexOf("op1-end");
    assert.ok(op2EndIdx < op1EndIdx, `op2 debería terminar antes que op1 (paralelo). Orden: ${order.join(", ")}`);
});
(0, node_test_1.test)("path-lock: release sin error si se llama más de una vez", async () => {
    const release = await (0, path_lock_1.acquirePathLock)("/tmp/idempotent.json");
    release();
    // Llamar de nuevo no debería tirar
    assert.doesNotThrow(() => release());
});
