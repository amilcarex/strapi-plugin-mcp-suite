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
const url_safety_1 = require("../services/url-safety");
(0, node_test_1.describe)("validateUrlSafety — protocol filter", () => {
    (0, node_test_1.test)("acepta http", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://example.com/img.jpg");
        assert.equal(r.safe, true);
    });
    (0, node_test_1.test)("acepta https", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("https://example.com/img.jpg");
        assert.equal(r.safe, true);
    });
    (0, node_test_1.test)("rechaza file://", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("file:///etc/passwd");
        assert.equal(r.safe, false);
        if (r.safe === false) {
            assert.match(r.reason, /Protocolo no permitido/);
        }
    });
    (0, node_test_1.test)("rechaza gopher://", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("gopher://evil.com/_evil");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("rechaza javascript:", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("javascript:alert(1)");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("rechaza data:", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("data:text/plain,hello");
        assert.equal(r.safe, false);
    });
});
(0, node_test_1.describe)("validateUrlSafety — IPv4 blocked ranges (SSRF)", () => {
    (0, node_test_1.test)("bloquea AWS IMDS 169.254.169.254", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://169.254.169.254/latest/meta-data/");
        assert.equal(r.safe, false);
        if (r.safe === false) {
            assert.match(r.reason, /rango bloqueado/);
        }
    });
    (0, node_test_1.test)("bloquea loopback 127.0.0.1", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://127.0.0.1:1337/admin");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea otra IP de loopback (127.x.y.z)", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://127.5.5.5/anything");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea RFC1918 10.0.0.0/8", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://10.0.0.1/internal");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea RFC1918 192.168.0.0/16", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://192.168.1.1/router");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea RFC1918 172.16.0.0/12", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://172.16.0.1/internal");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea Alibaba metadata 100.100.100.200", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://100.100.100.200/metadata");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea CGNAT 100.64.0.0/10", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://100.64.0.1/anything");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea reserved 0.0.0.0/8", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://0.0.0.0/anything");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea multicast 224.0.0.0/4", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://224.1.1.1/anything");
        assert.equal(r.safe, false);
    });
});
(0, node_test_1.describe)("validateUrlSafety — IPv6 blocked ranges", () => {
    (0, node_test_1.test)("bloquea ::1 (loopback)", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://[::1]:8080/anything");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea link-local fe80::", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://[fe80::1]/anything");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea ULA fc00::/7", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://[fc00::1]/anything");
        assert.equal(r.safe, false);
    });
    (0, node_test_1.test)("bloquea IPv4-mapped que apunta a loopback", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("http://[::ffff:127.0.0.1]/anything");
        assert.equal(r.safe, false);
    });
});
(0, node_test_1.describe)("validateUrlSafety — env var allowlist (Capa 3)", () => {
    (0, node_test_1.test)("con allowlist activa, host autorizado pasa", async () => {
        process.env.UPLOAD_URL_ALLOWED_HOSTS = "example.com,placehold.co";
        try {
            const r = await (0, url_safety_1.validateUrlSafety)("https://placehold.co/600x400.png");
            assert.equal(r.safe, true);
        }
        finally {
            delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
        }
    });
    (0, node_test_1.test)("con allowlist activa, host no autorizado se bloquea", async () => {
        process.env.UPLOAD_URL_ALLOWED_HOSTS = "example.com";
        try {
            const r = await (0, url_safety_1.validateUrlSafety)("https://unsplash.com/img.jpg");
            assert.equal(r.safe, false);
            if (r.safe === false) {
                assert.match(r.reason, /Allowlist activa/);
            }
        }
        finally {
            delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
        }
    });
    (0, node_test_1.test)("allowlist por sufijo: matchea subdominio", async () => {
        process.env.UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES = ".amazonaws.com";
        try {
            const r = await (0, url_safety_1.validateUrlSafety)("https://my-bucket.s3.us-east-1.amazonaws.com/file.jpg");
            assert.equal(r.safe, true);
        }
        finally {
            delete process.env.UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES;
        }
    });
    (0, node_test_1.test)("allowlist NO hace bypass de IP bloqueada (defensa adicional)", async () => {
        process.env.UPLOAD_URL_ALLOWED_HOSTS = "169.254.169.254";
        try {
            const r = await (0, url_safety_1.validateUrlSafety)("http://169.254.169.254/latest/meta-data/");
            // Pasa la allowlist (está autorizado) pero la blocklist hardcoded igual rechaza
            assert.equal(r.safe, false);
        }
        finally {
            delete process.env.UPLOAD_URL_ALLOWED_HOSTS;
        }
    });
});
(0, node_test_1.describe)("validateUrlSafety — env var extra blocklist (Capa 2)", () => {
    (0, node_test_1.test)("EXTRA_BLOCKED_HOSTS bloquea host adicional", async () => {
        process.env.UPLOAD_URL_EXTRA_BLOCKED_HOSTS = "example.com";
        try {
            const r = await (0, url_safety_1.validateUrlSafety)("https://example.com/img.jpg");
            assert.equal(r.safe, false);
            if (r.safe === false) {
                assert.match(r.reason, /EXTRA_BLOCKED_HOSTS/);
            }
        }
        finally {
            delete process.env.UPLOAD_URL_EXTRA_BLOCKED_HOSTS;
        }
    });
    (0, node_test_1.test)("EXTRA_BLOCKED_CIDRS bloquea IP en rango custom", async () => {
        process.env.UPLOAD_URL_EXTRA_BLOCKED_CIDRS = "203.0.113.0/24";
        try {
            const r = await (0, url_safety_1.validateUrlSafety)("http://203.0.113.5/anything");
            assert.equal(r.safe, false);
        }
        finally {
            delete process.env.UPLOAD_URL_EXTRA_BLOCKED_CIDRS;
        }
    });
});
(0, node_test_1.describe)("validateUrlSafety — input validation", () => {
    (0, node_test_1.test)("rechaza URL malformada", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("not a url");
        assert.equal(r.safe, false);
        if (r.safe === false) {
            assert.match(r.reason, /URL inválida/);
        }
    });
    (0, node_test_1.test)("rechaza URL vacía", async () => {
        const r = await (0, url_safety_1.validateUrlSafety)("");
        assert.equal(r.safe, false);
    });
});
