# stats.ps1 - system stats bridge (ASCII only for PS 5.1).
# Emits one JSON line every tick:
# {"net":{...},"procs":[...],"fs":bool}
# fs = a fullscreen window is covering the island position on the primary screen.
param(
  [int]$IntervalMs = 2000,
  [int]$OwnPid = 0
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$cores = [int]$env:NUMBER_OF_PROCESSORS
if ($cores -lt 1) { $cores = 1 }

$prevProcs = @{}
$lastTick = Get-Date

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class U32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(PT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", SetLastError = true)] public static extern int GetWindowLong(IntPtr hWnd, int idx);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int cb);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
}
'@

# primary screen geometry (island sits top-center of the primary work area)
$script:scrW = 0
$script:scrH = 0
$script:ptX = 0
$script:ptY = 24
# the island strip that must be fully covered by another window
$script:stripL = 0
$script:stripR = 0
$script:stripT = 0
$script:stripB = 0
try {
  $scr = [System.Windows.Forms.Screen]::PrimaryScreen
  $script:scrW = $scr.Bounds.Width
  $script:scrH = $scr.Bounds.Height
  $wa = $scr.WorkingArea
  $script:ptX = [int]($wa.X + $wa.Width / 2)
  $script:ptY = $wa.Y + 24
  $script:stripL = $wa.X + [int]($wa.Width / 2) - 320
  $script:stripR = $wa.X + [int]($wa.Width / 2) + 320
  $script:stripT = $wa.Y + 4
  $script:stripB = $wa.Y + 48
} catch {}

function Test-FullscreenAtIsland {
  # true when the topmost window at the island position fully covers the island
  # strip (fullscreen OR maximized windows both count). Desktop / shell / our
  # own window are excluded.
  try {
    $pt = New-Object 'U32+PT'
    $pt.X = $script:ptX
    $pt.Y = $script:ptY
    $h = [U32]::WindowFromPoint($pt)
    if ($h -eq [IntPtr]::Zero) { return $false }
    $root = [U32]::GetAncestor($h, 2)
    if ($root -eq [IntPtr]::Zero) { $root = $h }
    $wpid = [uint32]0
    [U32]::GetWindowThreadProcessId($root, [ref]$wpid) | Out-Null
    if ($OwnPid -gt 0 -and $wpid -eq $OwnPid) { return $false }
    if (-not [U32]::IsWindowVisible($root)) { return $false }
    $sb = New-Object System.Text.StringBuilder 256
    [U32]::GetClassName($root, $sb, 256) | Out-Null
    $cls = $sb.ToString()
    if ($cls -eq 'Progman' -or $cls -eq 'WorkerW' -or $cls -eq 'Shell_TrayWnd' -or $cls -eq 'Shell_SecondaryTrayWnd') {
      return $false
    }
    $rect = New-Object 'U32+RECT'
    $hr = [U32]::DwmGetWindowAttribute($root, 9, [ref]$rect, 16)
    if ($hr -ne 0) {
      [U32]::GetWindowRect($root, [ref]$rect) | Out-Null
    }
    # the window must fully contain the island strip
    if ($rect.L -le $script:stripL -and $rect.R -ge $script:stripR -and $rect.T -le $script:stripT -and $rect.B -ge $script:stripB) {
      return $true
    }
    return $false
  } catch {
    return $false
  }
}

function Get-NetSnapshot {
  $rx = 0.0; $tx = 0.0; $rxT = 0.0; $txT = 0.0
  try {
    $ifs = Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface -ErrorAction Stop
    foreach ($i in $ifs) {
      if ($i.Name -like '*Loopback*' -or $i.Name -like '*isatap*' -or $i.Name -like '*Teredo*') { continue }
      $rx += [double]$i.BytesReceivedPersec
      $tx += [double]$i.BytesSentPersec
    }
  } catch {}
  try {
    $adapters = Get-NetAdapterStatistics -ErrorAction Stop
    foreach ($a in $adapters) {
      $rxT += [double]$a.ReceivedBytes
      $txT += [double]$a.SentBytes
    }
  } catch {}
  return @{ rx = [math]::Round($rx, 0); tx = [math]::Round($tx, 0); rxTotal = [math]::Round($rxT, 0); txTotal = [math]::Round($txT, 0) }
}

function Get-ProcSnapshot {
  $now = Get-Date
  $dt = ($now - $script:lastTick).TotalSeconds
  $script:lastTick = $now
  if ($dt -le 0.2) { $dt = 2.0 }
  $out = @()
  try {
    $ps = Get-Process -ErrorAction Stop
    foreach ($p in $ps) {
      $cpu = 0.0
      try { $cpu = [double]$p.CPU } catch { $cpu = 0.0 }
      $key = [int]$p.Id
      $pct = 0.0
      if ($script:prevProcs.ContainsKey($key)) {
        $prev = $script:prevProcs[$key]
        $dCpu = $cpu - $prev[0]
        if ($dCpu -gt 0 -and $prev[1] -eq $p.Name) {
          $pct = ($dCpu / $dt / $cores) * 100.0
        }
      }
      $script:prevProcs[$key] = @($cpu, $p.Name)
      $ws = 0.0
      try { $ws = [double]$p.WorkingSet64 } catch {}
      if ($pct -gt 0.03) {
        $out += @{ n = [string]$p.Name; c = [math]::Round($pct, 1); m = [math]::Round($ws / 1MB, 1); p = [string]$p.Path }
      }
    }
    if ($script:prevProcs.Count -gt 900) { $script:prevProcs.Clear() }
  } catch {}
  $out = @($out | Sort-Object { $_.c } -Descending | Select-Object -First 8)
  return $out
}

while ($true) {
  $net = Get-NetSnapshot
  $procs = Get-ProcSnapshot
  $fs = Test-FullscreenAtIsland
  $obj = @{ net = $net; procs = $procs; fs = $fs }
  $out = $obj | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds $IntervalMs
}
