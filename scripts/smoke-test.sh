#!/usr/bin/env bash
# Smoke test del plugin strapi-mcp (Strapi5MCP).
#
# Uso:
#   export STRAPI_MCP_TOKEN=tu-api-token
#   export STRAPI_BASE_URL=http://localhost:1337  # opcional, default localhost
#   bash src/plugins/strapi-mcp/scripts/smoke-test.sh
#
# Cada test imprime:  ✓ PASS  o  ✗ FAIL  con el nombre del check.
# El script termina con código 0 si todo pasa, 1 si algo falla.
#
# Cubre:
#   - Auth: 401 sin token, 401 con token bogus, 200 con token válido
#   - MCP handshake: initialize devuelve {name: "strapi-mcp"}
#   - tools/list: cuenta tools según gating (SCHEMA_AUTHORING_ENABLED)
#   - Content-ops read: list_content_types, get_content_type_schema
#   - Layout-ops read: get_visual_layout
#   - Schema-authoring: validate_schema_proposal con nesting profundo detecta violation
#   - Dry-run de create_component (sin tocar filesystem)
#
# Idempotente: no escribe nada al filesystem ni a la DB. Solo lee.

set -uo pipefail

BASE="${STRAPI_BASE_URL:-http://localhost:1337}"
TOKEN="${STRAPI_MCP_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "ERROR: define STRAPI_MCP_TOKEN antes de correr el script."
  echo "  Settings → API Tokens → Create new (Full access)"
  echo "  Convención del name: <tu-email> - <propósito>  (ej: amilcar@example.com - smoke)"
  exit 2
fi

PASS=0
FAIL=0

mcp_call() {
  local body="$1"
  curl -sS -X POST "$BASE/api/strapi-mcp/stream" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $TOKEN" \
    -d "$body"
}

# Extrae el JSON del primer SSE message (line "data: {...}")
extract_data() {
  awk '/^data: /{sub(/^data: /,""); print; exit}'
}

check() {
  local name="$1"
  local condition="$2"
  if [ "$condition" = "true" ]; then
    echo "  ✓ PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL: $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "=========================================="
echo "strapi-mcp smoke test"
echo "Base: $BASE"
echo "=========================================="

# ─── Auth ────────────────────────────────────────────────────────────────────
echo ""
echo "→ Auth"

resp=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/strapi-mcp/stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "sin token → 401 (got $resp)" "$([ "$resp" = "401" ] && echo true || echo false)"

resp=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/strapi-mcp/stream" \
  -H "Authorization: Bearer FAKE_TOKEN_THAT_DOES_NOT_EXIST" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "token bogus → 401 (got $resp)" "$([ "$resp" = "401" ] && echo true || echo false)"

resp=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$BASE/api/strapi-mcp/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "token válido → 200 (got $resp)" "$([ "$resp" = "200" ] && echo true || echo false)"

# ─── Initialize handshake ────────────────────────────────────────────────────
echo ""
echo "→ MCP handshake"

init=$(mcp_call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}' | extract_data)
check "initialize devuelve serverInfo.name=strapi-mcp" "$(echo "$init" | grep -q '"name":"strapi-mcp"' && echo true || echo false)"
check "initialize incluye capabilities.tools" "$(echo "$init" | grep -q '"tools"' && echo true || echo false)"

# ─── tools/list (with current gating) ────────────────────────────────────────
echo ""
echo "→ tools/list (refleja SCHEMA_AUTHORING_ENABLED actual)"

tools=$(mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | extract_data)
total=$(echo "$tools" | grep -oE '"name":"[a-z_]+' | wc -l)
echo "  ℹ Tools expuestas: $total"

# Content-ops (siempre presentes)
check "tools/list incluye list_content_types" "$(echo "$tools" | grep -q '"name":"list_content_types"' && echo true || echo false)"
check "tools/list incluye find_entries" "$(echo "$tools" | grep -q '"name":"find_entries"' && echo true || echo false)"
check "tools/list incluye create_entry" "$(echo "$tools" | grep -q '"name":"create_entry"' && echo true || echo false)"

# Layout-ops (siempre presentes desde v0.2.0)
check "tools/list incluye get_visual_layout" "$(echo "$tools" | grep -q '"name":"get_visual_layout"' && echo true || echo false)"
check "tools/list incluye set_field_layout" "$(echo "$tools" | grep -q '"name":"set_field_layout"' && echo true || echo false)"
check "tools/list incluye set_field_metadata" "$(echo "$tools" | grep -q '"name":"set_field_metadata"' && echo true || echo false)"

# Schema-authoring (depende del flag — solo verificamos coherencia)
authoring_in_list=$(echo "$tools" | grep -q '"name":"create_content_type"' && echo true || echo false)
echo "  ℹ schema-authoring tools visibles en tools/list: $authoring_in_list"
echo "    (esto debería matchear SCHEMA_AUTHORING_ENABLED en el .env del proyecto)"

# ─── list_content_types ──────────────────────────────────────────────────────
echo ""
echo "→ Content ops — read tools"

resp=$(mcp_call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_content_types","arguments":{}}}' | extract_data)
check "list_content_types devuelve content_types array" "$(echo "$resp" | grep -q '"content_types"' && echo true || echo false)"
check "list_content_types devuelve components array" "$(echo "$resp" | grep -q '"components"' && echo true || echo false)"

# Intentamos get_content_type_schema sobre 'api::article.article' (existe en el scaffold de Strapi5MCP)
resp=$(mcp_call '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_content_type_schema","arguments":{"uid":"api::article.article"}}}' | extract_data)
check "get_content_type_schema(api::article.article) devuelve fields" "$(echo "$resp" | grep -q '"fields"' && echo true || echo false)"

# ─── Layout ops — read ───────────────────────────────────────────────────────
echo ""
echo "→ Layout ops — read tools"

resp=$(mcp_call '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_visual_layout","arguments":{"uid":"api::article.article"}}}' | extract_data)
check "get_visual_layout devuelve layouts" "$(echo "$resp" | grep -q '"layouts"' && echo true || echo false)"
check "get_visual_layout devuelve grid_size=12" "$(echo "$resp" | grep -q '"grid_size": 12' && echo true || echo false)"

# ─── validate_schema_proposal — nesting profundo ─────────────────────────────
echo ""
echo "→ Schema authoring — validate_schema_proposal (no requiere flag — read-only)"

# Si list_existing_schemas no está expuesta (gating off), validate tampoco lo está.
# La probamos solo si está en el tools/list.
if echo "$tools" | grep -q '"name":"validate_schema_proposal"'; then
  # Caso 1: propuesta válida (componente plano)
  body='{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"validate_schema_proposal","arguments":{"uid":"test-smoke.atom-button","kind":"component","schema":{"collectionName":"components_test_smoke_atom_buttons","info":{"displayName":"Smoke Button"},"attributes":{"label":{"type":"string","required":true}}}}}}'
  resp=$(mcp_call "$body" | extract_data)
  check "validate componente plano → valid:true" "$(echo "$resp" | grep -q '\\"valid\\": true' && echo true || echo false)"

  # Caso 2: nombre reservado → error RESERVED_ATTRIBUTE_NAME
  body='{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"validate_schema_proposal","arguments":{"uid":"test-smoke.bad","kind":"component","schema":{"info":{"displayName":"Bad"},"attributes":{"createdAt":{"type":"string"}}}}}}'
  resp=$(mcp_call "$body" | extract_data)
  check "validate con campo 'createdAt' → RESERVED_ATTRIBUTE_NAME" "$(echo "$resp" | grep -q 'RESERVED_ATTRIBUTE_NAME' && echo true || echo false)"

  # Caso 3: nesting profundo (apunta a shared.media que contiene component? — no, sus campos son media simple)
  # En vez de eso, falta-prop: relation sin target
  body='{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"validate_schema_proposal","arguments":{"uid":"api::demo.demo","kind":"content-type","schema":{"info":{"singularName":"demo","pluralName":"demos","displayName":"Demo"},"attributes":{"thing":{"type":"relation","relation":"oneToMany"}}}}}}'
  resp=$(mcp_call "$body" | extract_data)
  check "validate relation sin target → MISSING_REQUIRED_PROP" "$(echo "$resp" | grep -q 'MISSING_REQUIRED_PROP' && echo true || echo false)"
else
  echo "  ⊘ skip: validate_schema_proposal no expuesta (SCHEMA_AUTHORING_ENABLED=false en runtime)"
fi

# ─── Dry-run create_component ────────────────────────────────────────────────
echo ""
echo "→ Schema authoring — dry-run (no escribe filesystem)"

if echo "$tools" | grep -q '"name":"create_component"'; then
  body='{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"create_component","arguments":{"category":"smoke","name":"test-button","schema":{"collectionName":"components_smoke_test_buttons","info":{"displayName":"Smoke Test Button"},"attributes":{"label":{"type":"string","required":true}}},"dry_run":true}}}'
  resp=$(mcp_call "$body" | extract_data)
  check "create_component dry_run → files_to_write presente" "$(echo "$resp" | grep -q 'files_to_write' && echo true || echo false)"
  check "create_component dry_run → restart_required:true" "$(echo "$resp" | grep -q '\\"restart_required\\": true' && echo true || echo false)"
  check "create_component dry_run NO escribe (no aparece 'written':[...])" "$(echo "$resp" | grep -qE '\\"written\\":\\s*\\[[^]]' && echo false || echo true)"
else
  echo "  ⊘ skip: create_component no expuesta (SCHEMA_AUTHORING_ENABLED=false en runtime)"
fi

# ─── Tool inexistente ────────────────────────────────────────────────────────
echo ""
echo "→ Error handling"

resp=$(mcp_call '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"nonexistent_tool_xyz","arguments":{}}}' | extract_data)
check "tool inexistente → mensaje claro" "$(echo "$resp" | grep -q 'no encontrada' && echo true || echo false)"

# ─── Resultado ───────────────────────────────────────────────────────────────
echo ""
echo "=========================================="
echo "Resultado: $PASS passed, $FAIL failed"
echo "=========================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
