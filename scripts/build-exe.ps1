# Build KRYPTON as a standalone Windows executable
# Creates dist/krypton.exe that can run without installing Bun or Node.js

Write-Host "`nBuilding KRYPTON standalone executable..." -ForegroundColor Cyan

if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Bun is not installed. Install from: https://bun.sh" -ForegroundColor Red
    exit 1
}

Write-Host "Cleaning previous dist folder..." -ForegroundColor Yellow
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
}
New-Item -ItemType Directory -Path "dist" -Force | Out-Null

Write-Host "Compiling src/index.ts -> dist/krypton.exe..." -ForegroundColor Yellow
bun build src/index.ts --compile --outfile dist/krypton.exe

if ($LASTEXITCODE -eq 0) {
    $exeSize = (Get-Item "dist/krypton.exe").Length / 1MB
    Write-Host "`n[OK] Build successful!" -ForegroundColor Green
    Write-Host "  File : dist/krypton.exe" -ForegroundColor White
    Write-Host "  Size : $([math]::Round($exeSize, 2)) MB" -ForegroundColor White
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "  1. Double-click  : KRYPTON.bat" -ForegroundColor White
    Write-Host "  2. Or run in CMD : .\dist\krypton.exe" -ForegroundColor White
} else {
    Write-Host "`n[ERROR] Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
