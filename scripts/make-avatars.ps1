# Cuts the three family members out of design/icon-source.png as round stickers for the dashboard cards.
#   powershell -ExecutionPolicy Bypass -File scripts/make-avatars.ps1
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path 'design/icon-source.png'))
New-Item -ItemType Directory -Force public/icons | Out-Null

# name, centre x, centre y, square size (in the 1254px source)
$crops = @(
  @('mom', 330, 480, 640),
  @('dad', 825, 340, 540),
  @('kid', 650, 790, 500)
)
foreach ($c in $crops) {
  $name, $cx, $cy, $s = $c
  $out = 192
  $bmp = New-Object System.Drawing.Bitmap $out, $out
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(0, 0, $out - 1, $out - 1)
  $g.SetClip($path)
  $x0 = [Math]::Max(0, [Math]::Min($src.Width - $s, $cx - $s / 2)); $y0 = [Math]::Max(0, [Math]::Min($src.Height - $s, $cy - $s / 2))
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $out, $out), $x0, $y0, $s, $s, [System.Drawing.GraphicsUnit]::Pixel)
  $bmp.Save((Join-Path (Resolve-Path public/icons) "char-$name.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$src.Dispose()
Write-Output 'avatars written'
