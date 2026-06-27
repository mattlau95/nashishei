#Requires -Version 5.1
# Freeze ml/sidecar_main.py into a Tauri-compatible sidecar binary.
# Run from the ml/ directory: .\build_sidecar.ps1
# Output: ../frontend/src-tauri/binaries/nashishei-ml-x86_64-pc-windows-msvc.exe

$ErrorActionPreference = 'Stop'

$triple  = 'x86_64-pc-windows-msvc'
$outDir  = Join-Path $PSScriptRoot '..\frontend\src-tauri\binaries'
$tmpDir  = Join-Path $env:TEMP 'nashishei-ml-build'

New-Item -ItemType Directory -Force $outDir | Out-Null
New-Item -ItemType Directory -Force $tmpDir | Out-Null

Push-Location $PSScriptRoot
try {
    pyinstaller `
        --onefile `
        --name "nashishei-ml-$triple" `
        --distpath $outDir `
        --workpath $tmpDir `
        --specpath $tmpDir `
        --hidden-import 'uvicorn.logging' `
        --hidden-import 'uvicorn.loops' `
        --hidden-import 'uvicorn.loops.auto' `
        --hidden-import 'uvicorn.protocols' `
        --hidden-import 'uvicorn.protocols.http' `
        --hidden-import 'uvicorn.protocols.http.auto' `
        --hidden-import 'uvicorn.protocols.websockets' `
        --hidden-import 'uvicorn.protocols.websockets.auto' `
        --hidden-import 'uvicorn.lifespan' `
        --hidden-import 'uvicorn.lifespan.on' `
        --hidden-import 'anyio' `
        --hidden-import 'anyio._backends._asyncio' `
        --collect-data 'insightface' `
        sidecar_main.py
} finally {
    Pop-Location
}

Write-Host "`nBuilt: $outDir\nashishei-ml-$triple.exe"
Write-Host "InsightFace models are downloaded to ~/.insightface on first run."
Write-Host "To ship models inside the bundle, copy ~/.insightface/models/buffalo_l"
Write-Host "next to the .exe as insightface_models/models/buffalo_l/ before packaging."
