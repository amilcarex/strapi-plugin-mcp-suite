# Smoke test del plugin strapi-mcp (Windows / PowerShell).
#
# Uso:
#   $env:STRAPI_MCP_TOKEN = "tu-api-token"
#   $env:STRAPI_BASE_URL  = "http://localhost:1337"  # opcional
#   pwsh src/plugins/strapi-mcp/scripts/smoke-test.ps1
#
# Paridad funcional con smoke-test.sh — cubre auth, handshake, tools/list,
# read tools, validate_schema_proposal y dry-run de create_component.
# No escribe nada (filesystem ni DB).

param(
  [string]$BaseUrl = $(if ($env:STRAPI_BASE_URL) { $env:STRAPI_BASE_URL } else { "http://localhost:1337" }),
  [string]$Token = $env:STRAPI_MCP_TOKEN
)

if (-not $Token) {
  Write-Host "ERROR: define `$env:STRAPI_MCP_TOKEN antes de correr el script." -ForegroundColor Red
  Write-Host "  Settings -> API Tokens -> Create new (Full access)"
  Write-Host "  Convención del name: <tu-email> - <propósito>  (ej: amilcar@example.com - smoke)"
  exit 2
}

$script:Pass = 0
$script:Fail = 0
$Url = "$BaseUrl/api/strapi-mcp/stream"

function Check {
  param([string]$Name, [bool]$Condition)
  if ($Condition) {
    Write-Host "  PASS: $Name" -ForegroundColor Green
    $script:Pass++
  } else {
    Write-Host "  FAIL: $Name" -ForegroundColor Red
    $script:Fail++
  }
}

# Ejecuta una llamada MCP. Devuelve [pscustomobject]@{StatusCode, Body, Data}
# Data es el primer objeto parseado del "data: {...}" SSE.
function Invoke-Mcp {
  param([string]$BodyJson, [string]$BearerToken = $Token)
  $headers = @{
    "Content-Type"  = "application/json"
    "Accept"        = "application/json, text/event-stream"
    "Authorization" = "Bearer $BearerToken"
  }
  try {
    $resp = Invoke-WebRequest -Method Post -Uri $Url -Headers $headers -Body $BodyJson -ErrorAction Stop -SkipHttpErrorCheck
  } catch {
    return [pscustomobject]@{ StatusCode = -1; Body = $_.Exception.Message; Data = $null }
  }
  $body = $resp.Content
  $data = $null
  $line = ($body -split "`n" | Where-Object { $_ -match '^data: ' } | Select-Object -First 1)
  if ($line) {
    try { $data = ($line -replace '^data: ', '') | ConvertFrom-Json -Depth 50 } catch {}
  }
  return [pscustomobject]@{ StatusCode = [int]$resp.StatusCode; Body = $body; Data = $data }
}

# Lista de nombres de tools devueltos por tools/list
function Get-ToolNames {
  param($McpResult)
  if (-not $McpResult.Data.result.tools) { return @() }
  return @($McpResult.Data.result.tools | ForEach-Object { $_.name })
}

# Extrae el resultado de tools/call: parsea el text JSON anidado
function Get-CallText {
  param($McpResult)
  if (-not $McpResult.Data.result.content) { return $null }
  return $McpResult.Data.result.content[0].text
}

Write-Host "=========================================="
Write-Host "strapi-mcp smoke test (PowerShell)"
Write-Host "Base: $BaseUrl"
Write-Host "=========================================="

# ─── Auth ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Auth"

$resp = Invoke-WebRequest -Method Post -Uri $Url -Headers @{"Content-Type" = "application/json"} -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' -ErrorAction SilentlyContinue -SkipHttpErrorCheck
Check "sin token -> 401 (got $($resp.StatusCode))" ($resp.StatusCode -eq 401)

$resp = Invoke-WebRequest -Method Post -Uri $Url -Headers @{"Content-Type" = "application/json"; "Authorization" = "Bearer FAKE_TOKEN_THAT_DOES_NOT_EXIST"} -Body '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' -ErrorAction SilentlyContinue -SkipHttpErrorCheck
Check "token bogus -> 401 (got $($resp.StatusCode))" ($resp.StatusCode -eq 401)

$valid = Invoke-Mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
Check "token válido -> 200 (got $($valid.StatusCode))" ($valid.StatusCode -eq 200)

# ─── Handshake ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ MCP handshake"

$init = Invoke-Mcp '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0"}}}'
$serverName = $init.Data.result.serverInfo.name
Check "initialize -> serverInfo.name=strapi-mcp (got $serverName)" ($serverName -eq "strapi-mcp")
Check "initialize -> capabilities.tools presente" ($null -ne $init.Data.result.capabilities.tools)

# ─── tools/list ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ tools/list (refleja SCHEMA_AUTHORING_ENABLED actual)"

$toolsResult = Invoke-Mcp '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
$toolNames = Get-ToolNames $toolsResult
Write-Host "  Tools expuestas: $($toolNames.Count)"

Check "tools/list incluye list_content_types" ($toolNames -contains "list_content_types")
Check "tools/list incluye find_entries"       ($toolNames -contains "find_entries")
Check "tools/list incluye create_entry"       ($toolNames -contains "create_entry")
Check "tools/list incluye get_visual_layout"  ($toolNames -contains "get_visual_layout")
Check "tools/list incluye set_field_layout"   ($toolNames -contains "set_field_layout")
Check "tools/list incluye set_field_metadata" ($toolNames -contains "set_field_metadata")

$authoringIn = $toolNames -contains "create_content_type"
Write-Host "  schema-authoring tools visibles: $authoringIn (debe matchear SCHEMA_AUTHORING_ENABLED del .env)"

# ─── Content ops ─────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Content ops — read tools"

$r = Invoke-Mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_content_types","arguments":{}}}'
$text = Get-CallText $r
Check "list_content_types devuelve content_types"  ($text -match '"content_types"')
Check "list_content_types devuelve components"     ($text -match '"components"')

$r = Invoke-Mcp '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_content_type_schema","arguments":{"uid":"api::article.article"}}}'
$text = Get-CallText $r
Check "get_content_type_schema(api::article.article) -> fields" ($text -match '"fields"')

# ─── Layout ops ──────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Layout ops — read tools"

$r = Invoke-Mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_visual_layout","arguments":{"uid":"api::article.article"}}}'
$text = Get-CallText $r
Check "get_visual_layout devuelve layouts"           ($text -match '"layouts"')
Check "get_visual_layout devuelve grid_size 12"      ($text -match '"grid_size": 12')

# ─── validate_schema_proposal ────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Schema authoring — validate_schema_proposal (read-only)"

if ($toolNames -contains "validate_schema_proposal") {
  $r = Invoke-Mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"validate_schema_proposal","arguments":{"uid":"test-smoke.atom-button","kind":"component","schema":{"collectionName":"components_test_smoke_atom_buttons","info":{"displayName":"Smoke Button"},"attributes":{"label":{"type":"string","required":true}}}}}}'
  $text = Get-CallText $r
  Check "validate componente plano -> valid:true"  ($text -match '"valid":\s*true')

  $r = Invoke-Mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"validate_schema_proposal","arguments":{"uid":"test-smoke.bad","kind":"component","schema":{"info":{"displayName":"Bad"},"attributes":{"createdAt":{"type":"string"}}}}}}'
  $text = Get-CallText $r
  Check "validate campo 'createdAt' -> RESERVED_ATTRIBUTE_NAME" ($text -match 'RESERVED_ATTRIBUTE_NAME')

  $r = Invoke-Mcp '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"validate_schema_proposal","arguments":{"uid":"api::demo.demo","kind":"content-type","schema":{"info":{"singularName":"demo","pluralName":"demos","displayName":"Demo"},"attributes":{"thing":{"type":"relation","relation":"oneToMany"}}}}}}'
  $text = Get-CallText $r
  Check "validate relation sin target -> MISSING_REQUIRED_PROP" ($text -match 'MISSING_REQUIRED_PROP')
} else {
  Write-Host "  skip: validate_schema_proposal no expuesta (SCHEMA_AUTHORING_ENABLED=false en runtime)"
}

# ─── Dry-run create_component ────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Schema authoring — dry-run (no escribe filesystem)"

if ($toolNames -contains "create_component") {
  $body = '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"create_component","arguments":{"category":"smoke","name":"test-button","schema":{"collectionName":"components_smoke_test_buttons","info":{"displayName":"Smoke Test Button"},"attributes":{"label":{"type":"string","required":true}}},"dry_run":true}}}'
  $r = Invoke-Mcp $body
  $text = Get-CallText $r
  Check "create_component dry_run -> files_to_write" ($text -match 'files_to_write')
  Check "create_component dry_run -> restart_required:true" ($text -match '"restart_required":\s*true')
  Check "create_component dry_run NO escribe (no 'written':[path,...])" (-not ($text -match '"written":\s*\[\s*"[^"]'))
} else {
  Write-Host "  skip: create_component no expuesta (SCHEMA_AUTHORING_ENABLED=false en runtime)"
}

# ─── Tool inexistente ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "→ Error handling"

$r = Invoke-Mcp '{"jsonrpc":"2.0","id":99,"method":"tools/call","params":{"name":"nonexistent_tool_xyz","arguments":{}}}'
$text = Get-CallText $r
Check "tool inexistente -> mensaje claro" ($text -match 'no encontrada')

# ─── Resultado ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================="
Write-Host "Resultado: $script:Pass passed, $script:Fail failed"
Write-Host "=========================================="

if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
