import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { redactSecrets } from "../services/audit/redact";

describe("redactSecrets — passthroughs", () => {
  test("primitives passthrough unchanged", () => {
    assert.equal(redactSecrets("hello"), "hello");
    assert.equal(redactSecrets(42), 42);
    assert.equal(redactSecrets(true), true);
    assert.equal(redactSecrets(null), null);
    assert.equal(redactSecrets(undefined), undefined);
  });

  test("plain object with non-secret keys is preserved", () => {
    const input = { name: "demo", age: 30, active: true };
    assert.deepEqual(redactSecrets(input), input);
  });

  test("arrays of primitives passthrough", () => {
    const input = [1, 2, "three"];
    assert.deepEqual(redactSecrets(input), input);
  });
});

describe("redactSecrets — secret keys", () => {
  test("token key is redacted", () => {
    const out = redactSecrets({ token: "abc123" }) as any;
    assert.equal(out.token, "[REDACTED]");
  });

  test("password key is redacted", () => {
    const out = redactSecrets({ password: "hunter2" }) as any;
    assert.equal(out.password, "[REDACTED]");
  });

  test("secret key is redacted", () => {
    const out = redactSecrets({ secret: "s3cr3t" }) as any;
    assert.equal(out.secret, "[REDACTED]");
  });

  test("api_key and apiKey both redacted", () => {
    const out1 = redactSecrets({ api_key: "k1" }) as any;
    const out2 = redactSecrets({ apiKey: "k2" }) as any;
    const out3 = redactSecrets({ "api-key": "k3" }) as any;
    assert.equal(out1.api_key, "[REDACTED]");
    assert.equal(out2.apiKey, "[REDACTED]");
    assert.equal(out3["api-key"], "[REDACTED]");
  });

  test("authorization and bearer keys redacted", () => {
    const out = redactSecrets({ authorization: "Bearer xyz", bearer: "xyz" }) as any;
    assert.equal(out.authorization, "[REDACTED]");
    assert.equal(out.bearer, "[REDACTED]");
  });

  test("access_key and accessKey redacted", () => {
    const out1 = redactSecrets({ access_key: "x" }) as any;
    const out2 = redactSecrets({ accessKey: "y" }) as any;
    assert.equal(out1.access_key, "[REDACTED]");
    assert.equal(out2.accessKey, "[REDACTED]");
  });

  test("key match is case-insensitive", () => {
    const out = redactSecrets({ Token: "abc", PASSWORD: "x" }) as any;
    assert.equal(out.Token, "[REDACTED]");
    assert.equal(out.PASSWORD, "[REDACTED]");
  });

  test("partial matches are NOT redacted (token-id is fine)", () => {
    const out = redactSecrets({ tokenId: 5, mytoken: "x", subtoken: "y" }) as any;
    assert.equal(out.tokenId, 5);
    assert.equal(out.mytoken, "x");
    assert.equal(out.subtoken, "y");
  });
});

describe("redactSecrets — nested structures", () => {
  test("nested object: secret in inner level is redacted", () => {
    const out = redactSecrets({
      user: "amilcar",
      credentials: { password: "x", username: "amilcar" },
    }) as any;
    assert.equal(out.user, "amilcar");
    assert.equal(out.credentials.password, "[REDACTED]");
    assert.equal(out.credentials.username, "amilcar");
  });

  test("array of objects: each object processed", () => {
    const out = redactSecrets([
      { token: "a" },
      { token: "b", name: "x" },
    ]) as any;
    assert.equal(out[0].token, "[REDACTED]");
    assert.equal(out[1].token, "[REDACTED]");
    assert.equal(out[1].name, "x");
  });

  test("deep mix: secret at depth 3", () => {
    const out = redactSecrets({
      a: { b: { c: { token: "xx" } } },
    }) as any;
    assert.equal(out.a.b.c.token, "[REDACTED]");
  });
});

describe("redactSecrets — depth limit", () => {
  test("beyond MAX_DEPTH=10 returns TRUNCATED_DEPTH sentinel", () => {
    // Build a 12-level nested object.
    let leaf: any = { token: "x" };
    for (let i = 0; i < 12; i++) {
      leaf = { wrap: leaf };
    }
    const out = redactSecrets(leaf) as any;
    // Walk down until we hit the truncation marker.
    let cur: any = out;
    let depth = 0;
    while (cur && typeof cur === "object" && cur.wrap !== undefined) {
      cur = cur.wrap;
      depth++;
    }
    // cur should be the truncation sentinel string.
    assert.equal(cur, "[TRUNCATED_DEPTH]");
    assert.ok(depth >= 10, `expected to traverse at least 10 levels, got ${depth}`);
  });
});

describe("redactSecrets — value preservation", () => {
  test("non-secret values keep their types (number, bool, array)", () => {
    const input = {
      uid: "api::page.page",
      filters: { status: "published", count: 5 },
      ids: [1, 2, 3],
      meta: { active: true, pagination: { page: 1, pageSize: 25 } },
    };
    const out = redactSecrets(input);
    assert.deepEqual(out, input);
  });

  test("does NOT mutate the input object", () => {
    const input = { token: "abc", nested: { password: "x" } };
    const before = JSON.parse(JSON.stringify(input));
    redactSecrets(input);
    assert.deepEqual(input, before);
  });
});
