# Builds dist\FightcordSetup.exe
#   1. collects the modules, the Discord-status plugin and the loader
#   2. syntax-checks every .js with node and runs the unit tests
#   3. zips them into build\payload.zip
#   4. compiles installer\FightcordSetup.cs with the .NET Framework 4 C# compiler,
#      the zip embedded as a resource -> one self-contained .exe
# With -Release it also runs the harness smoke test (when snapshots are there) and writes the
# in-app update for GitHub Releases:
#   dist\fightcord-<version>-update.zip   (inject.js + fightcord\*.js, no node_modules)
#   dist\latest.json                      ({version, zip, sha256, notes})
# Run:  powershell -ExecutionPolicy Bypass -File build.ps1 [-Release] [-Notes "what changed"]
# Works in both layouts:
#   repo:  build.ps1 next to src\ (modules, tests, dev-harness), rpc\, loader\, installer\
#   dev:   fightcord\build.ps1 next to ..\fightcade-fontstyle and ..\fightcade-discord-rpc
# (ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.)

param([switch]$Release, [string]$Notes = '')

$ErrorActionPreference = 'Stop'
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $here 'src\fightcord-core.js')) {
    $src = Join-Path $here 'src'
    $rpc = Join-Path $here 'rpc'
} else {
    $mama = Split-Path -Parent $here
    $src  = Join-Path $mama 'fightcade-fontstyle'
    $rpc  = Join-Path $mama 'fightcade-discord-rpc'
}
$build = Join-Path $here 'build'
$stage = Join-Path $build 'stage'
$dist  = Join-Path $here 'dist'

$plugins = @('fightcord-core.js', 'analytics.js', 'goals.js', 'progress.js', 'feed.js', 'welcome.js', 'events.js', 'i18n-pt.js', 'i18n-es.js', 'backgrounds.js', 'branding.js', 'challenge-card.js', 'context-menu.js', 'inbox.js', 'music.js', 'profile-card.js', 'splash-art.js', 'challenge-filters.js', 'channel-banner.js', 'hover-cards.js', 'notes.js', 'chat-extras.js', 'discord-theme.js', 'discover.js', 'emoji.js', 'fightcord.js', 'friends.js',
             'fontstyle.js', 'match-screens.js', 'member-list.js', 'scout.js', 'snapshot.js', 'stats.js', 'translate.js')

# discord-rpc's optional native helper (register-scheme) is never used: discord-rpc loads it in a
# try/catch, and we never register a URL scheme. Leaving it out keeps the payload pure JavaScript.
$skipPackages = @('register-scheme', 'bindings', 'file-uri-to-path', 'node-addon-api')

# the version lives in one place: the installer source
$cs = Get-Content (Join-Path $here 'installer\FightcordSetup.cs') -Raw
$version = [regex]::Match($cs, 'const string Version = "([0-9.]+)"').Groups[1].Value
if (-not $version) { throw 'could not read Version from FightcordSetup.cs' }
Write-Host "Fightcord $version"

if (Test-Path $build) { Remove-Item -Recurse -Force $build }
New-Item -ItemType Directory -Force (Join-Path $stage 'fightcord') | Out-Null
New-Item -ItemType Directory -Force $dist | Out-Null

$rpcModules = Join-Path $rpc 'node_modules'
if (-not (Test-Path (Join-Path $rpcModules 'discord-rpc'))) {
    Write-Host 'Installing the Discord-status dependencies (npm)'
    Push-Location $rpc
    try { & npm install --omit=optional --no-audit --no-fund | Out-Null } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw ('npm install failed in ' + $rpc) }
}

Write-Host 'Collecting files'
Copy-Item (Join-Path $here 'loader\inject.js') (Join-Path $stage 'inject.js')
foreach ($p in $plugins) { Copy-Item (Join-Path $src $p) (Join-Path $stage "fightcord\$p") }
Copy-Item (Join-Path $rpc 'plugin\discord-rpc.js') (Join-Path $stage 'fightcord\discord-rpc.js')
$nm = Join-Path $stage 'fightcord\node_modules'
New-Item -ItemType Directory -Force $nm | Out-Null
Get-ChildItem $rpcModules -Directory | Where-Object { $skipPackages -notcontains $_.Name -and -not $_.Name.StartsWith('.') } |
    ForEach-Object { Copy-Item -Recurse $_.FullName (Join-Path $nm $_.Name) }

Write-Host 'Checking syntax'
$js = @(Get-Item (Join-Path $stage 'inject.js')) + @(Get-ChildItem (Join-Path $stage 'fightcord') -Filter *.js)
foreach ($f in $js) {
    & node --check $f.FullName
    if ($LASTEXITCODE -ne 0) { throw "syntax error in $($f.Name)" }
}
# the Discord-status plugin must still load its library from what we ship
& node -e "require(process.argv[1]); require(process.argv[2])" (Join-Path $nm 'discord-rpc') (Join-Path $nm 'ws')
if ($LASTEXITCODE -ne 0) { throw 'discord-rpc does not load from the staged node_modules' }

Write-Host 'Running tests'
& node --test (Get-ChildItem (Join-Path $src 'tests') -Filter *.test.js | ForEach-Object { $_.FullName }) | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'tests failed - run: node --test src/tests/*.test.js' }

if ($Release) {
    $snaps = Join-Path $src 'dev-harness\snapshots'
    if ((Test-Path $snaps) -and (Get-ChildItem $snaps -Directory | Select-Object -First 1)) {
        Write-Host 'Harness smoke test'
        & node (Join-Path $src 'dev-harness\smoke.js') | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'smoke test failed' }
    } else { Write-Host 'Harness smoke test skipped (no snapshots - see src\dev-harness)' }
}

# Zip with forward slashes: .NET Framework's CreateFromDirectory writes backslashes into entry
# names, which other zip tools treat as part of the file name.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-Zip([string]$dir, [string]$zipPath) {
    if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
    $root = (Resolve-Path $dir).Path.TrimEnd('\') + '\'
    $fsz = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
    $zip = New-Object System.IO.Compression.ZipArchive($fsz, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem $dir -Recurse -File | ForEach-Object {
            $entry = $_.FullName.Substring($root.Length).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose(); $fsz.Dispose() }
}

Write-Host 'Zipping payload'
$zip = Join-Path $build 'payload.zip'
New-Zip $stage $zip

Write-Host 'Installer translations'
& node (Join-Path $here 'installer\make_i18n.js') | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'installer translations incomplete - see installer\i18n.json' }

Write-Host 'Compiling installer'
$fw  = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
$out = Join-Path $dist 'FightcordSetup.exe'
& $csc /nologo /target:winexe /optimize+ "/out:$out" `
    "/win32icon:$(Join-Path $here 'installer\fightcord.ico')" `
    "/win32manifest:$(Join-Path $here 'installer\app.manifest')" `
    "/resource:$zip,Fightcord.payload.zip" `
    "/resource:$(Join-Path $here 'installer\logo.png'),Fightcord.logo.png" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll `
    "/r:$(Join-Path $fw 'System.IO.Compression.dll')" "/r:$(Join-Path $fw 'System.IO.Compression.FileSystem.dll')" `
    (Join-Path $here 'installer\FightcordSetup.cs')
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
$kb = [math]::Round((Get-Item $out).Length / 1KB)
Write-Host "Built $out ($kb KB)"

if ($Release) {
    Write-Host 'Writing the in-app update'
    $upStage = Join-Path $build 'update'
    New-Item -ItemType Directory -Force (Join-Path $upStage 'fightcord') | Out-Null
    Copy-Item (Join-Path $stage 'inject.js') (Join-Path $upStage 'inject.js')
    Get-ChildItem (Join-Path $stage 'fightcord') -Filter *.js | ForEach-Object { Copy-Item $_.FullName (Join-Path $upStage "fightcord\$($_.Name)") }
    $upName = "fightcord-$version-update.zip"
    $upZip = Join-Path $dist $upName
    New-Zip $upStage $upZip
    $sha = (Get-FileHash -Algorithm SHA256 $upZip).Hash.ToLower()
    $latest = [ordered]@{ version = $version; zip = $upName; sha256 = $sha; notes = $Notes; setup = 'FightcordSetup.exe' }
    $json = $latest | ConvertTo-Json
    [System.IO.File]::WriteAllText((Join-Path $dist 'latest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Wrote $upName and latest.json (sha256 $sha)"
}
