# Security regression test del plugin strapi-mcp.
#
# Cubre los fixes aplicados: C1 (path traversal), C2 (token impersonation),
# C3 (SSRF), H1 (GraphQL auth context), M1 (find_entries cap + graphql bombs).
#
# Uso:
#   $env:STRAPI_MCP_TOKEN = "<token>"
#   $env:STRAPI_BASE_URL  = "http://localhost:1337"  # opcional
#   pwsh src/plugins/strapi-mcp/scripts/security-test.ps1

param(
  [string]$BaseUrl = $(if ($env:STRAPI_BASE_URL) { $env:STRAPI_BASE_URL } else { "http://localhost:1337" }),
  [string]$Token = $env:STRAPI_MCP_TOKEN
)

if (-not $Token) {
  Write-Host "ERROR: define `$env:STRAPI_MCP_TOKEN antes de correr el script." -ForegroundColor Red
  exit 2
}

$script:Pass = 0
$script:Fail = 0
$Url = "$BaseUrl/api/strapi-mcp/stream"

function Check {
  param([string]$Name, [bool]$Condition, [string]$Detail = "")
  if ($Condition) {
    Write-Host "  PASS: $Name" -ForegroundColor Green
    $script:Pass++
  } else {
    Write-Host "  FAIL: $Name" -ForegroundColor Red
    if ($Detail) { Write-Host "        $Detail" -ForegroundColor DarkRed }
    $script:Fail++
  }
}

function Invoke-Mcp {
  param([string]$BodyJson)
  $headers = @{
    "Content-Type"  = "application/json"
    "Accept"        = "application/json, text/event-stream"
    "Authorization" = "Bearer $Token"
  }
  $body = ""
  $statusCode = -1
  try {
    $resp = Invoke-WebRequest -Method Post -Uri $Url -Headers $headers -Body $BodyJson -UseBasicParsing -ErrorAction Stop
    $body = $resp.Content
    $statusCode = [int]$resp.StatusCode
  } catch [System.Net.WebException] {
    $errResp = $_.Exception.Response
    if ($errResp) {
      try {
        $statusCode = [int]$errResp.StatusCode
        $stream = $errResp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $stream.Close()
      } catch {}
    } else {
      $body = $_.Exception.Message
    }
  } catch {
    $body = $_.Exception.Message
  }

  $data = $null
  $text = $null
  $sseDataLine = ($body -split "`n" | Where-Object { $_ -match '^data: ' } | Select-Object -First 1)
  $payload = if ($sseDataLine) { $sseDataLine -replace '^data: ', '' } else { $body }
  try {
    $data = $payload | ConvertFrom-Json
    if ($data.result -and $data.result.content -and $data.result.content[0].text) {
      $text = $data.result.content[0].text
    } elseif ($data.error) {
      $text = ($data.error | ConvertTo-Json -Depth 10 -Compress)
    }
  } catch {}
  return [pscustomobject]@{ StatusCode = $statusCode; Body = $body; Data = $data; Text = $text }
}

Write-Host "=================================================="
Write-Host "strapi-mcp SECURITY regression test"
Write-Host "Base: $BaseUrl"
Write-Host "=================================================="

# --- C1: Path traversal ---
Write-Host ""
Write-Host "=== C1: Path traversal en add_field_to_schema / delete_field_from_schema ==="
Write-Host "Requiere SCHEMA_AUTHORING_ENABLED=true en .env del proyecto."

$payloads = @(
  @{ uid = "../../../etc/passwd";       desc = "POSIX traversal" },
  @{ uid = "..\..\..\etc\shadow";       desc = "Windows traversal" },
  @{ uid = "api::../../etc.evil";       desc = "traversal dentro de api" },
  @{ uid = "shared.../../etc";          desc = "traversal en categoria" },
  @{ uid = "shared./etc/passwd";        desc = "slash en name" },
  @{ uid = "shared.passwd\0null";       desc = "null byte injection" }
)

foreach ($p in $payloads) {
  $bodyJson = @{
    jsonrpc = "2.0"; id = 1; method = "tools/call"
    params  = @{
      name      = "add_field_to_schema"
      arguments = @{
        uid = $p.uid; field_name = "x"
        field = @{ type = "string" }
      }
    }
  } | ConvertTo-Json -Depth 10 -Compress

  $r = Invoke-Mcp $bodyJson
  $blocked = ($r.Text -match 'INVALID_PATH_SEGMENT|PATH_ESCAPE_DETECTED|WRITE_PATH_OUT_OF_BOUNDS|no es kebab-case')
  Check "C1.$($p.desc) -> rejected" $blocked $r.Text
}

# --- C3: SSRF ---
Write-Host ""
Write-Host "=== C3: SSRF en upload_media_from_url ==="
Write-Host "Requiere UPLOAD_ENABLED=true en .env del proyecto."

$ssrfTargets = @(
  @{ url = "http://169.254.169.254/latest/meta-data/iam/security-credentials/";    desc = "AWS IMDS metadata" },
  @{ url = "http://127.0.0.1:1337/admin";                                          desc = "loopback IPv4" },
  @{ url = "http://[::1]:1337/admin";                                              desc = "loopback IPv6" },
  @{ url = "http://10.0.0.1/internal";                                             desc = "RFC1918 10/8" },
  @{ url = "http://192.168.1.1/router";                                            desc = "RFC1918 192.168/16" },
  @{ url = "http://172.16.0.1/internal";                                           desc = "RFC1918 172.16/12" },
  @{ url = "http://100.100.100.200/metadata";                                      desc = "Alibaba metadata" },
  @{ url = "file:///etc/passwd";                                                   desc = "file protocol" },
  @{ url = "gopher://attacker.com/_evil";                                          desc = "gopher protocol" },
  @{ url = "javascript:alert(1)";                                                  desc = "javascript protocol" }
)

foreach ($t in $ssrfTargets) {
  $bodyJson = @{
    jsonrpc = "2.0"; id = 1; method = "tools/call"
    params  = @{
      name      = "upload_media_from_url"
      arguments = @{ url = $t.url }
    }
  } | ConvertTo-Json -Depth 10 -Compress

  $r = Invoke-Mcp $bodyJson
  $blocked = ($r.Text -match 'URL_BLOCKED|Protocolo no permitido|rango bloqueado|UPLOAD_DISABLED')
  $disabled = ($r.Text -match 'UPLOAD_DISABLED')
  if ($disabled) {
    Write-Host "  SKIP: C3.$($t.desc) (UPLOAD_ENABLED=false)" -ForegroundColor Yellow
  } else {
    Check "C3.$($t.desc) -> blocked" $blocked $r.Text
  }
}

# --- H1: GraphQL auth context ---
Write-Host ""
Write-Host "=== H1: GraphQL respect token permissions ==="
Write-Host "Requiere GRAPHQL_ENABLED=true en .env y @strapi/plugin-graphql instalado."

$introspect = @{
  jsonrpc = "2.0"; id = 1; method = "tools/call"
  params  = @{
    name      = "graphql_query"
    arguments = @{
      query = 'query { __typename }'
    }
  }
} | ConvertTo-Json -Depth 10 -Compress

$r = Invoke-Mcp $introspect
$graphqlDisabled = ($r.Text -match 'GRAPHQL_TOOLS_DISABLED|GRAPHQL_PLUGIN_NOT_INSTALLED|graphql_query.* no encontrada')
if ($graphqlDisabled) {
  Write-Host "  SKIP: H1.basic_query (GraphQL deshabilitado o plugin no instalado)" -ForegroundColor Yellow
} else {
  $hasData = ($r.Text -match '"data"')
  Check "H1.basic_query responde con state.auth real" $hasData $r.Text
}

$mutQuery = @{
  jsonrpc = "2.0"; id = 2; method = "tools/call"
  params  = @{
    name      = "graphql_query"
    arguments = @{
      query = 'mutation { __typename }'
    }
  }
} | ConvertTo-Json -Depth 10 -Compress

$r = Invoke-Mcp $mutQuery
if ($graphqlDisabled) {
  Write-Host "  SKIP: H1.mutation_without_flag (GraphQL deshabilitado)" -ForegroundColor Yellow
} else {
  $rejected = ($r.Text -match 'MUTATION_REQUIRES_EXPLICIT_FLAG')
  Check "H1.mutation_without_flag -> rejected" $rejected $r.Text
}

# --- M1: find_entries pageSize cap ---
Write-Host ""
Write-Host "=== M1: find_entries hard cap pageSize=200 ==="

$capBody = @{
  jsonrpc = "2.0"; id = 1; method = "tools/call"
  params  = @{
    name      = "find_entries"
    arguments = @{
      uid = "api::article.article"
      pagination = @{ page = 1; pageSize = 100000 }
    }
  }
} | ConvertTo-Json -Depth 10 -Compress

$r = Invoke-Mcp $capBody
$capped = ($r.Text -match 'pagination_capped|cap es 200')
Check "M1.find_entries cap pageSize=100000 -> 200" $capped $r.Text

# --- M1: GraphQL query bombs ---
Write-Host ""
Write-Host "=== M1: GraphQL query bombs (depth + length) ==="

$deepQuery = "query { " + ("a { " * 15) + "x" + (" }" * 15) + " }"
$depthBody = @{
  jsonrpc = "2.0"; id = 1; method = "tools/call"
  params  = @{
    name      = "graphql_query"
    arguments = @{ query = $deepQuery }
  }
} | ConvertTo-Json -Depth 10 -Compress
$r = Invoke-Mcp $depthBody
$graphqlDisabled = ($r.Text -match 'GRAPHQL_TOOLS_DISABLED|GRAPHQL_PLUGIN_NOT_INSTALLED|graphql_query.* no encontrada')
if ($graphqlDisabled) {
  Write-Host "  SKIP: M1.graphql_depth_bomb (graphql deshabilitado)" -ForegroundColor Yellow
} else {
  $rejected = ($r.Text -match 'QUERY_DEPTH_EXCEEDED')
  Check "M1.graphql_depth_bomb (15 niveles) -> rejected" $rejected $r.Text
}

$longQuery = "query { " + ("a:b " * 5000) + " }"
$lengthBody = @{
  jsonrpc = "2.0"; id = 1; method = "tools/call"
  params  = @{
    name      = "graphql_query"
    arguments = @{ query = $longQuery }
  }
} | ConvertTo-Json -Depth 10 -Compress
$r = Invoke-Mcp $lengthBody
if ($graphqlDisabled) {
  Write-Host "  SKIP: M1.graphql_length_bomb (graphql deshabilitado)" -ForegroundColor Yellow
} else {
  $rejected = ($r.Text -match 'QUERY_TOO_LONG|QUERY_TOO_MANY_ALIASES')
  Check "M1.graphql_length_bomb (25KB) -> rejected" $rejected $r.Text
}

# --- Rate limit (automatico, ojo: consume tu cuota actual) ---
Write-Host ""
Write-Host "=== Rate limit: 429 cuando se excede MCP_RATE_LIMIT_PER_MIN ==="
Write-Host "  Disparamos 70 requests rapidas (>60 default). Esperamos al menos 1 con 429."
Write-Host "  Si MCP_RATE_LIMIT_PER_MIN esta seteado muy alto en .env, este test puede no disparar."

$rateBody = @{
  jsonrpc = "2.0"; id = 1; method = "tools/call"
  params  = @{
    name      = "__health"
    arguments = @{}
  }
} | ConvertTo-Json -Depth 10 -Compress

$got429 = $false
$first429At = -1
$lastStatus = -1
for ($i = 1; $i -le 70; $i++) {
  $r = Invoke-Mcp $rateBody
  $lastStatus = $r.StatusCode
  if ($r.StatusCode -eq 429) {
    $got429 = $true
    $first429At = $i
    break
  }
}
if ($got429) {
  Check "RateLimit.70_requests -> 429 disparo en req #$first429At" $true ""
} else {
  Check "RateLimit.70_requests -> al menos 1 con 429" $false "Ninguna devolvio 429. Ultima status: $lastStatus. Posibles causas: Strapi no reiniciado tras agregar middleware, o MCP_RATE_LIMIT_PER_MIN >= 70 en .env."
}

# --- SSRF env-var defense (manual) ---
Write-Host ""
Write-Host "=== SSRF env-var defense (extra blocklist + allowlist) ==="
Write-Host "  Tests requieren reiniciar Strapi con las env vars seteadas."
Write-Host ""
Write-Host "  Caso 1 - Extra blocklist:"
Write-Host "    Setea en .env: UPLOAD_URL_EXTRA_BLOCKED_HOSTS=example.com"
Write-Host "    Reinicia Strapi y proba upload_media_from_url con url=https://example.com/img.jpg"
Write-Host "    Esperado: URL_BLOCKED con mention de EXTRA_BLOCKED_HOSTS."
Write-Host ""
Write-Host "  Caso 2 - Allowlist strict:"
Write-Host "    Setea en .env: UPLOAD_URL_ALLOWED_HOSTS=placehold.co"
Write-Host "    Reinicia Strapi."
Write-Host "    Proba upload con url=https://placehold.co/600x400.png -> deberia funcionar."
Write-Host "    Proba upload con url=https://unsplash.com/img.jpg -> URL_BLOCKED por allowlist."
Write-Host ""
Write-Host "  Caso 3 - Domain suffix:"
Write-Host "    Setea: UPLOAD_URL_ALLOWED_DOMAIN_SUFFIXES=.amazonaws.com,.cloudfront.net"
Write-Host "    Cualquier subdominio de esos pasa, el resto se bloquea."

# --- H3: backups location (manual) ---
Write-Host ""
Write-Host "=== H3: backups location ==="
Write-Host "  Verificar manualmente que tras modificar un schema existente (ej add_field) los .bak"
Write-Host "  no quedan junto al .json original, sino bajo .strapi-mcp-backups/"

# --- M4: NODE_ENV fail-closed (manual) ---
Write-Host ""
Write-Host "=== M4: NODE_ENV fail-closed ==="
Write-Host "  Test completo requiere reiniciar Strapi con NODE_ENV unset o = staging."
Write-Host "  En Docker sin NODE_ENV o con NODE_ENV=production, los writers tiran"
Write-Host "  SCHEMA_AUTHORING_DISABLED_IN_PRODUCTION con mensaje que menciona fail-closed."

# --- C2: Token impersonation (manual) ---
Write-Host ""
Write-Host "=== C2: Token impersonation (manual setup) ==="
Write-Host "  Crear token con name que contenga email de OTRO admin user."
Write-Host "  Reemplazar STRAPI_MCP_TOKEN y hacer tools/list. Esperado: 401 Token name email mismatch."

# --- Resultado ---
Write-Host ""
Write-Host "=================================================="
Write-Host "Resultado: $script:Pass passed, $script:Fail failed"
Write-Host "=================================================="

if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
