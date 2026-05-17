import { test, describe } from "node:test";
import * as assert from "node:assert/strict";

import { validateUrlSafety } from "../services/url-safety";

describe("validateUrlSafety — protocol filter", () => {
  test("acepta http", async () => {
    const r = await validateUrlSafety("http://example.com/img.jpg");
    assert.equal(r.safe, true);
  });

  test("acepta https", async () => {
    const r = await validateUrlSafety("https://example.com/img.jpg");
    assert.equal(r.safe, true);
  });

  test("rechaza file://", async () => {
    const r = await validateUrlSafety("file:///etc/passwd");
    assert.equal(r.safe, false);
    if (r.safe === false) {
      assert.match(r.reason, /Protocolo no permitido/);
    }
  });

  test("rechaza gopher://", async () => {
    const r = await validateUrlSafety("gopher://evil.com/_evil");
    assert.equal(r.safe, false);
  });

  test("rechaza javascript:", async () => {
    const r = await validateUrlSafety("javascript:alert(1)");
    assert.equal(r.safe, false);
  });

  test("rechaza data:", async () => {
    const r = await validateUrlSafety("data:text/plain,hello");
    assert.equal(r.safe, false);
  });
});

describe("validateUrlSafety — IPv4 blocked ranges (SSRF)", () => {
  test("bloquea AWS IMDS 169.254.169.254", async () => {
    const r = await validateUrlSafety("http://169.254.169.254/latest/meta-data/");
    assert.equal(r.safe, false);
    if (r.safe === false) {
      assert.match(r.reason, /rango bloqueado/);
    }
  });

  test("bloquea loopback 127.0.0.1", async () => {
    const r = await validateUrlSafety("http://127.0.0.1:1337/admin");
    assert.equal(r.safe, false);
  });

  test("bloquea otra IP de loopback (127.x.y.z)", async () => {
    const r = await validateUrlSafety("http://127.5.5.5/anything");
    assert.equal(r.safe, false);
  });

  test("bloquea RFC1918 10.0.0.0/8", async () => {
    const r = await validateUrlSafety("http://10.0.0.1/internal");
    assert.equal(r.safe, false);
  });

  test("bloquea RFC1918 192.168.0.0/16", async () => {
    const r = await validateUrlSafety("http://192.168.1.1/router");
    assert.equal(r.safe, false);
  });

  test("bloquea RFC1918 172.16.0.0/12", async () => {
    const r = await validateUrlSafety("http://172.16.0.1/internal");
    assert.equal(r.safe, false);
  });

  test("bloquea Alibaba metadata 100.100.100.200", async () => {
    const r = await validateUrlSafety("http://100.100.100.200/metadata");
    assert.equal(r.safe, false);
  });

  test("bloquea CGNAT 100.64.0.0/10", async () => {
    const r = await validateUrlSafety("http://100.64.0.1/anything");
    assert.equal(r.safe, false);
  });

  test("bloquea reserved 0.0.0.0/8", async () => {
    const r = await validateUrlSafety("http://0.0.0.0/anything");
    assert.equal(r.safe, false);
  });

  test("bloquea multicast 224.0.0.0/4", async () => {
    const r = await validateUrlSafety("http://224.1.1.1/anything");
    assert.equal(r.safe, false);
  });
});

describe("validateUrlSafety — IPv6 blocked ranges", () => {
  test("bloquea ::1 (loopback)", async () => {
    const r = await validateUrlSafety("http://[::1]:8080/anything");
    assert.equal(r.safe, false);
  });

  test("bloquea link-local fe80::", async () => {
    const r = await validateUrlSafety("http://[fe80::1]/anything");
    assert.equal(r.safe, false);
  });

  test("bloquea ULA fc00::/7", async () => {
    const r = await validateUrlSafety("http://[fc00::1]/anything");
    assert.equal(r.safe, false);
  });

  test("bloquea IPv4-mapped que apunta a loopback", async () => {
    const r = await validateUrlSafety("http://[::ffff:127.0.0.1]/anything");
    assert.equal(r.safe, false);
  });
});

describe("validateUrlSafety — env var allowlist (Capa 3)", () => {
  test("con allowlist activa, host autorizado pasa", async () => {
    process.env.UPLOAD_URL_ALLOWED_HOSTS = "example.com,placehold.co";
    try {
      const r = await validateUrlSafety("https://placehold.co/600x400.png");
      assert.equal(r.safe, true);
    } finally {
      delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
    }
  });

  test("con allowlist activa, host no autorizado se bloquea", async () => {
    process.env.UPLOAD_URL_ALLOWED_HOSTS = "example.com";
    try {
      const r = await validateUrlSafety("https://unsplash.com/img.jpg");
      assert.equal(r.safe, false);
      if (r.safe === false) {
        assert.match(r.reason, /Allowlist activa/);
      }
    } finally {
      delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
    }
  });

  test("allowlist por sufijo: matchea subdominio", async () => {
    process.env.UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES = ".amazonaws.com";
    try {
      const r = await validateUrlSafety("https://my-bucket.s3.us-east-1.amazonaws.com/file.jpg");
      assert.equal(r.safe, true);
    } finally {
      delete process.env.UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES;
    }
  });

  test("allowlist NO hace bypass de IP bloqueada (defensa adicional)", async () => {
    process.env.UPLOAD_URL_ALLOWED_HOSTS = "169.254.169.254";
    try {
      const r = await validateUrlSafety("http://169.254.169.254/latest/meta-data/");
      // Pasa la allowlist (está autorizado) pero la blocklist hardcoded igual rechaza
      assert.equal(r.safe, false);
    } finally {
      delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
    }
  });
});

describe("validateUrlSafety — env var extra blocklist (Capa 2)", () => {
  test("EXTRA_BLOCKED_HOSTS bloquea host adicional", async () => {
    process.env.UPLOAD_URL_EXTRA_BLOCKED_HOSTS = "example.com";
    try {
      const r = await validateUrlSafety("https://example.com/img.jpg");
      assert.equal(r.safe, false);
      if (r.safe === false) {
        assert.match(r.reason, /EXTRA_BLOCKED_HOSTS/);
      }
    } finally {
      delete process.env.UPLOAD_URL_EXTRA_BLOCKED_HOSTS;
    }
  });

  test("EXTRA_BLOCKED_CIDRS bloquea IP en rango custom", async () => {
    process.env.UPLOAD_URL_EXTRA_BLOCKED_CIDRS = "203.0.113.0/24";
    try {
      const r = await validateUrlSafety("http://203.0.113.5/anything");
      assert.equal(r.safe, false);
    } finally {
      delete process.env.UPLOAD_URL_EXTRA_BLOCKED_CIDRS;
    }
  });
});

describe("validateUrlSafety — input validation", () => {
  test("rechaza URL malformada", async () => {
    const r = await validateUrlSafety("not a url");
    assert.equal(r.safe, false);
    if (r.safe === false) {
      assert.match(r.reason, /URL inválida/);
    }
  });

  test("rechaza URL vacía", async () => {
    const r = await validateUrlSafety("");
    assert.equal(r.safe, false);
  });
});
