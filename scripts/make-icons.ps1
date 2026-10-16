# Builds the PWA icons from design/icon-source.png (square artwork). Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/make-icons.ps1
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path 'design/icon-source.png'))
New-Item -ItemType Directory -Force public/icons | Out-Null

function New-Icon([int]$size, [string]$name, [bool]$rounded, [double]$scale, [string]$bg) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($rounded) {
    $r = [int]($size * 0.22) * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90); $path.AddArc($size - $r, 0, $r, $r, 270, 90)
    $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90); $path.AddArc(0, $size - $r, $r, $r, 90, 90); $path.CloseFigure()
    $g.SetClip($path)
  }
  if ($bg) { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg)) }
  $d = [int]($size * $scale); $o = [int](($size - $d) / 2)
  $g.DrawImage($src, $o, $o, $d, $d)
  $bmp.Save((Join-Path (Resolve-Path public/icons) $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

New-Icon 192 'icon-192.png' $true 1.0 $null
New-Icon 512 'icon-512.png' $true 1.0 $null
New-Icon 512 'icon-maskable-512.png' $false 0.78 '#f6e9e0'   # artwork inside the maskable safe zone
New-Icon 180 'apple-touch-icon.png' $false 1.0 $null
New-Icon 32 'favicon-32.png' $true 1.0 $null
$src.Dispose()
Write-Output 'icons written'
