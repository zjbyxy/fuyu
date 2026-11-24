# gen_icons.ps1 - generate 5 icon candidates for FuYu (ASCII only).
param(
  [string]$OutDir = '',
  [string]$Apply = '',
  [string]$ProjDir = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-Canvas {
  param([int]$Size = 512)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  return @($bmp, $g)
}

function Round-RectPath {
  param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
  $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
  $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Solid {
  param([string]$hex, [int]$alpha = 255)
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  return [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

function LGrad {
  param($x, $y, $w, $h, $c1, $c2, [single]$angle = 35)
  return New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF($x, $y, $w, $h)), $c1, $c2, $angle)
}

function Save-Png {
  param($bmp, [string]$path)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Add-Stars {
  param($g, $seed, $count, $w, $h)
  $rnd = New-Object System.Random($seed)
  for ($i = 0; $i -lt $count; $i++) {
    $x = $rnd.NextDouble() * $w
    $y = $rnd.NextDouble() * $h * 0.55
    $s = $rnd.Next(2, 5)
    $a = $rnd.Next(40, 160)
    $b = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a, 255, 255, 255))
    $g.FillEllipse($b, [single]$x, [single]$y, $s, $s)
    $b.Dispose()
  }
}

# ---------- A: neon floating isle on dark squircle ----------
function Icon-A {
  param([string]$path)
  $c = New-Canvas 512
  $bmp = $c[0]; $g = $c[1]
  $sq = Round-RectPath 24 24 464 464 108
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(24, 24, 464, 464)),
    (Solid '#14141F'), (Solid '#0A0A12'), 90)
  $g.FillPath($bg, $sq)
  $edge = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(40, 255, 255, 255)), 2
  $g.DrawPath($edge, $sq)
  $edge.Dispose()
  Add-Stars $g 42 26 464 300
  # glow layers of the isle
  for ($i = 6; $i -ge 1; $i--) {
    $glow = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(14, 0, 229, 255)), (16 * $i)
    $gp = Round-RectPath (256 - 150) 268 300 84 42
    $g.DrawPath($glow, $gp)
    $glow.Dispose(); $gp.Dispose()
  }
  # isle body
  $isle = Round-RectPath 106 268 300 84 42
  $igr = LGrad 106 268 300 84 (Solid '#00E5FF') (Solid '#8A6BFF') 0
  $g.FillPath($igr, $isle)
  $igr.Dispose()
  # underside shadow isle
  $und = Round-RectPath 150 340 212 46 23
  $ub = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 10, 12, 26))
  $g.FillPath($ub, $und)
  $ub.Dispose()
  # moon
  $mb = New-Object System.Drawing.SolidBrush (Solid '#FFD98A')
  $g.FillEllipse($mb, 372, 84, 56, 56)
  $mb.Dispose()
  $mbg = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 255, 217, 138)), 6
  $g.DrawEllipse($mbg, 364, 76, 72, 72)
  $mbg.Dispose()
  $igr2 = LGrad 150 130 212 8 (Solid '#00E5FF') (Solid '#8A6BFF') 0
  $g.FillRectangle($igr2, 150, 130, 212, 6)
  $igr2.Dispose()
  Save-Png $bmp $path
  $g.Dispose(); $bmp.Dispose()
}

# ---------- B: minimal glowing capsule ----------
function Icon-B {
  param([string]$path)
  $c = New-Canvas 512
  $bmp = $c[0]; $g = $c[1]
  $sq = Round-RectPath 24 24 464 464 112
  $bg = New-Object System.Drawing.SolidBrush (Solid '#0B0B10')
  $g.FillPath($bg, $sq)
  $bg.Dispose()
  for ($i = 5; $i -ge 1; $i--) {
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(12, 122, 92, 255)), (14 * $i)
    $cap = Round-RectPath 96 216 320 80 40
    $g.DrawPath($pen, $cap)
    $pen.Dispose(); $cap.Dispose()
  }
  $cap = Round-RectPath 96 216 320 80 40
  $cgr = LGrad 96 216 320 80 (Solid '#00E5FF') (Solid '#B98AFF') 0
  $pen2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 40, 40, 52)), 10
  $g.DrawPath($pen2, $cap)
  $pen2.Dispose()
  $g.DrawPath($cgr, $cap)
  $cgr.Dispose(); $cap.Dispose()
  $dot = New-Object System.Drawing.SolidBrush (Solid '#35E0FF')
  $g.FillEllipse($dot, 372, 244, 24, 24)
  $dot.Dispose()
  Save-Png $bmp $path
  $g.Dispose(); $bmp.Dispose()
}

# ---------- C: isle and moon night circle ----------
function Icon-C {
  param([string]$path)
  $c = New-Canvas 512
  $bmp = $c[0]; $g = $c[1]
  $sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(0, 0, 512, 512)),
    (Solid '#0E1B33'), (Solid '#26355F'), 90)
  $g.FillEllipse($sky, 16, 16, 480, 480)
  $sky.Dispose()
  Add-Stars $g 77 40 480 260
  # crescent moon
  $mb = New-Object System.Drawing.SolidBrush (Solid '#FFE9A8')
  $g.FillEllipse($mb, 330, 88, 110, 110)
  $mb.Dispose()
  $cb = New-Object System.Drawing.SolidBrush (Solid '#101A33')
  $g.FillEllipse($cb, 306, 76, 106, 106)
  $cb.Dispose()
  # isle mound
  $isle = New-Object System.Drawing.Drawing2D.GraphicsPath
  $isle.AddEllipse(96, 300, 320, 150)
  $clip = Round-RectPath 96 300 320 96 12
  $g.SetClip($clip)
  $ib = New-Object System.Drawing.SolidBrush (Solid '#0D1526')
  $g.FillPath($ib, $isle)
  $ib.Dispose()
  $g.ResetClip()
  $clip.Dispose(); $isle.Dispose()
  # shoreline glow
  $sp = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(180, 0, 229, 255)), 5
  $g.DrawArc($sp, 96, 300, 320, 150, 200, 140)
  $sp.Dispose()
  # waves
  $wp = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 0, 229, 255)), 4
  $g.DrawLine($wp, 150, 420, 250, 420)
  $g.DrawLine($wp, 280, 444, 380, 444)
  $wp.Dispose()
  $ring = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(50, 255, 255, 255)), 3
  $g.DrawEllipse($ring, 16, 16, 480, 480)
  $ring.Dispose()
  Save-Png $bmp $path
  $g.Dispose(); $bmp.Dispose()
}

# ---------- D: letter F monogram ----------
function Icon-D {
  param([string]$path)
  $c = New-Canvas 512
  $bmp = $c[0]; $g = $c[1]
  $sq = Round-RectPath 24 24 464 464 112
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(24, 24, 464, 464)),
    (Solid '#101019'), (Solid '#0A0A11'), 115)
  $g.FillPath($bg, $sq)
  $bg.Dispose()
  $font = $null
  try { $font = New-Object System.Drawing.Font('Segoe UI Black', 300, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel) }
  catch { $font = New-Object System.Drawing.Font('Arial', 280, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel) }
  $fgr = LGrad 140 60 260 380 (Solid '#00E5FF') (Solid '#8A6BFF') 90
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rectF = New-Object System.Drawing.RectangleF(120, 40, 300, 430)
  for ($i = 4; $i -ge 1; $i--) {
    $glowB = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10, 0, 229, 255))
    $g.DrawString('F', $font, $glowB, $rectF, $fmt)
    $glowB.Dispose()
  }
  $g.DrawString('F', $font, $fgr, $rectF, $fmt)
  $fgr.Dispose(); $font.Dispose(); $fmt.Dispose()
  $ring = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(36, 255, 255, 255)), 2
  $g.DrawPath($ring, $sq)
  $ring.Dispose()
  Save-Png $bmp $path
  $g.Dispose(); $bmp.Dispose()
}

# ---------- E: glass ring with isle dot ----------
function Icon-E {
  param([string]$path)
  $c = New-Canvas 512
  $bmp = $c[0]; $g = $c[1]
  $ebg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.RectangleF(0, 0, 512, 512)),
    (Solid '#1A2444'), (Solid '#0A0E1C'), 100)
  $g.FillRectangle($ebg, 0, 0, 512, 512)
  $ebg.Dispose()
  Add-Stars $g 900 30 512 240
  $ring = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 255, 255, 255)), 20
  $g.DrawEllipse($ring, 96, 96, 320, 320)
  $ring.Dispose()
  $ring2 = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(26, 0, 229, 255)), 26
  $g.DrawArc($ring2, 96, 96, 320, 320, 200, 120)
  $ring2.Dispose()
  $cap = Round-RectPath 176 232 160 52 26
  $cgr = LGrad 176 232 160 52 (Solid '#00E5FF') (Solid '#B98AFF') 0
  $g.FillPath($cgr, $cap)
  $cgr.Dispose(); $cap.Dispose()
  $dot = New-Object System.Drawing.SolidBrush (Solid '#35E0FF')
  $g.FillEllipse($dot, 344, 246, 16, 16)
  $dot.Dispose()
  Save-Png $bmp $path
  $g.Dispose(); $bmp.Dispose()
}

function Write-Ico {
  param([string]$pngPath, [string]$icoPath)
  $sizes = @(256, 64, 48, 32, 16)
  $blobs = @()
  foreach ($s in $sizes) {
    $src = [System.Drawing.Image]::FromFile($pngPath)
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $blobs += , $ms.ToArray()
    $ms.Dispose(); $bmp.Dispose(); $src.Dispose()
  }
  $fs = [System.IO.File]::Create($icoPath)
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$blobs.Count)
  $offset = 6 + 16 * $blobs.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
    $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([uint16]1); $bw.Write([uint16]32)
    $bw.Write([uint32]$blobs[$i].Length)
    $bw.Write([uint32]$offset)
    $offset += $blobs[$i].Length
  }
  foreach ($b in $blobs) { $bw.Write($b) }
  $bw.Flush(); $bw.Close(); $fs.Close()
}

$iconDir = Join-Path $OutDir 'icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

$all = @('A', 'B', 'C', 'D', 'E')
foreach ($k in $all) {
  $png = Join-Path $iconDir ("icon$($k).png")
  & ("Icon-$k") $png
  Write-Ico $png (Join-Path $iconDir ("icon$($k).ico"))
}

if ($Apply -and $ProjDir) {
  $png = Join-Path $iconDir ("icon$($Apply).png")
  $ico = Join-Path $iconDir ("icon$($Apply).ico")
  Copy-Item $png (Join-Path $ProjDir 'assets\icon.png') -Force
  Copy-Item $ico (Join-Path $ProjDir 'assets\icon.ico') -Force
  Write-Output "APPLIED $Apply"
}
Write-Output 'DONE'
