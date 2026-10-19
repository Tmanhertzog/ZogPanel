# Rebuilds <BACKGROUND_IMAGES_DIR>/images.json after you add or remove photos.
# The folder name comes from BACKGROUND_IMAGES_DIR in .env (default: basic_bkg_images).
# Right-click this file > "Run with PowerShell", then reload ZogPanel in chrome://extensions.

$dirName = "basic_bkg_images"
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*BACKGROUND_IMAGES_DIR\s*=\s*"?([^"#]+?)"?\s*(#.*)?$') { $dirName = $Matches[1].Trim() }
  }
}

$folder = Join-Path $PSScriptRoot $dirName
if (-not (Test-Path $folder)) {
  New-Item -ItemType Directory -Path $folder | Out-Null
  Write-Host "Created $dirName/ - put your photos in it and run this again."
}

$names = Get-ChildItem -Path $folder -File |
  Where-Object { $_.Extension -match '^\.(jpe?g|png|webp|gif|avif)$' } |
  Sort-Object Name |
  ForEach-Object { $_.Name }
ConvertTo-Json -InputObject @($names) | Set-Content -Path (Join-Path $folder "images.json") -Encoding UTF8
Write-Host "Listed $($names.Count) photos in $dirName/images.json"
