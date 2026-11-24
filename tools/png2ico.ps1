# png2ico.ps1 - convert PNG to classic BMP-format ICO (ASCII only).
param(
  [string]$PngPath = '',
  [string]$IcoPath = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-SizeArray {
  return @(256, 48, 32, 16)
}

function Get-BmpEntry {
  param([System.Drawing.Image]$src, [int]$s)
  $bmp = New-Object System.Drawing.Bitmap($s, $s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($s * $s * 4)
  $ptr = $data.Scan0
  for ($row = 0; $row -lt $s; $row++) {
    [System.Runtime.InteropServices.Marshal]::Copy([IntPtr]($ptr.ToInt64() + $row * $stride), $bytes, $row * $s * 4, $s * 4)
  }
  $bmp.UnlockBits($data)
  $bmp.Dispose()
  # XOR data must be bottom-up (BGRA already)
  $xor = New-Object byte[] ($s * $s * 4)
  for ($row = 0; $row -lt $s; $row++) {
    $srcRow = $row * $s * 4
    $dstRow = ($s - 1 - $row) * $s * 4
    [Array]::Copy($bytes, $srcRow, $xor, $dstRow, $s * 4)
  }
  # AND mask: all opaque -> zero bits, rows padded to 4 bytes
  $maskStride = [int]([math]::Ceiling($s / 32.0) * 4)
  $and = New-Object byte[] ($maskStride * $s)
  # BITMAPINFOHEADER (40 bytes), height doubled, built via BinaryWriter
  $ms = New-Object System.IO.MemoryStream
  $hw = New-Object System.IO.BinaryWriter($ms)
  $hw.Write([uint32]40)
  $hw.Write([int32]$s)
  $hw.Write([int32]($s * 2))
  $hw.Write([uint16]1)
  $hw.Write([uint16]32)
  $hw.Write([uint32]0)
  $hw.Write([uint32](40 + $xor.Length + $and.Length))
  $hw.Write([int32]0); $hw.Write([int32]0); $hw.Write([int32]0); $hw.Write([int32]0)
  $hw.Flush()
  $hdr = $ms.ToArray()
  $hw.Dispose(); $ms.Dispose()
  $out = New-Object byte[] (40 + $xor.Length + $and.Length)
  [Array]::Copy($hdr, 0, $out, 0, 40)
  [Array]::Copy($xor, 0, $out, 40, $xor.Length)
  [Array]::Copy($and, 0, $out, 40 + $xor.Length, $and.Length)
  return ,$out
}

$srcImg = [System.Drawing.Image]::FromFile($PngPath)
$sizes = Get-SizeArray
$entries = @()
foreach ($s in $sizes) {
  $entries += , (Get-BmpEntry $srcImg $s)
}
$srcImg.Dispose()

$fs = [System.IO.File]::Create($IcoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$entries.Count)
$offset = 6 + 16 * $entries.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$entries[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $entries[$i].Length
}
foreach ($e in $entries) { $bw.Write($e) }
$bw.Flush(); $bw.Close(); $fs.Close()
Write-Output ("ICO written: " + (Get-Item -LiteralPath $IcoPath).Length + " bytes")
