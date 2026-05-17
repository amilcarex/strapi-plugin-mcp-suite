import { test } from "node:test";
import * as assert from "node:assert/strict";

import { acquirePathLock } from "../services/path-lock";

test("path-lock: dos calls sobre el mismo path se serializan", async () => {
  const path = "/tmp/test-schema.json";
  const order: string[] = [];

  // Primera operación: bloquea el path, hace algo que tarda, libera
  const op1 = (async () => {
    const release = await acquirePathLock(path);
    order.push("op1-acquired");
    await new Promise((r) => setTimeout(r, 50));
    order.push("op1-releasing");
    release();
  })();

  // Microtask delay para asegurar que op1 entra primero al lock
  await new Promise((r) => setImmediate(r));

  // Segunda operación: debería esperar a que op1 libere
  const op2 = (async () => {
    const release = await acquirePathLock(path);
    order.push("op2-acquired");
    release();
  })();

  await Promise.all([op1, op2]);

  // Orden esperado: op1 entra → op1 libera → op2 entra
  assert.deepEqual(order, ["op1-acquired", "op1-releasing", "op2-acquired"]);
});

test("path-lock: calls sobre paths distintos NO se serializan", async () => {
  const order: string[] = [];

  const op1 = (async () => {
    const release = await acquirePathLock("/tmp/a.json");
    order.push("op1-start");
    await new Promise((r) => setTimeout(r, 30));
    order.push("op1-end");
    release();
  })();

  const op2 = (async () => {
    const release = await acquirePathLock("/tmp/b.json");
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

test("path-lock: release sin error si se llama más de una vez", async () => {
  const release = await acquirePathLock("/tmp/idempotent.json");
  release();
  // Llamar de nuevo no debería tirar
  assert.doesNotThrow(() => release());
});
