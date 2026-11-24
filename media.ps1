# media.ps1 - SMTC bridge: poll media state, emit JSON lines to stdout,
# poll a command file for control commands. ASCII only (PS 5.1 encoding).
# Commands: toggle/play/pause/next/prev/volup/voldown/mute/exit

param(
  [string]$CmdFile = '',
  [int]$IntervalMs = 400
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

Add-Type -AssemblyName System.Runtime.WindowsRuntime

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class KB {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
'@

function PressKey([int]$vk) {
  [KB]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [KB]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
}

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

$asStreamMethod = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsStreamForRead' -and $_.GetParameters().Count -eq 1
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

try {
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
  $t = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  $script:Manager = Await ($t::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch {
  [Console]::Out.WriteLine('{"active":false,"error":"smtc-init"}')
  [Console]::Out.Flush()
  exit 1
}

$script:Session = $null
$script:LastThumbTitle = ''

function Read-Cmd {
  if ($CmdFile -and (Test-Path -LiteralPath $CmdFile)) {
    try {
      $raw = [System.IO.File]::ReadAllText($CmdFile)
      Remove-Item -LiteralPath $CmdFile -Force -ErrorAction SilentlyContinue
      return ($raw | ConvertFrom-Json)
    } catch {
      try { Remove-Item -LiteralPath $CmdFile -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
  return $null
}

function Invoke-Cmd([string]$c) {
  switch ($c) {
    'volup'   { PressKey 0xAE; return }
    'voldown' { PressKey 0xAF; return }
    'mute'    { PressKey 0xAD; return }
  }
  $vk = 0
  switch ($c) {
    'toggle' { $vk = 0xB3 }
    'play'   { $vk = 0xB3 }
    'pause'  { $vk = 0xB3 }
    'next'   { $vk = 0xB0 }
    'prev'   { $vk = 0xB1 }
    default  { return }
  }
  $s = $script:Session
  if ($null -ne $s) {
    $ok = $false
    try {
      switch ($c) {
        'toggle' { $ok = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
        'play'   { $ok = Await ($s.TryPlayAsync()) ([bool]) }
        'pause'  { $ok = Await ($s.TryPauseAsync()) ([bool]) }
        'next'   { $ok = Await ($s.TrySkipNextAsync()) ([bool]) }
        'prev'   { $ok = Await ($s.TrySkipPreviousAsync()) ([bool]) }
      }
    } catch { $ok = $false }
    if ($ok) { return }
  }
  PressKey $vk
}

$lastJson = ''
$exitLoop = $false

while (-not $exitLoop) {
  $cmd = Read-Cmd
  if ($cmd -and $cmd.cmd) {
    if ($cmd.cmd -eq 'exit') { $exitLoop = $true }
    else { try { Invoke-Cmd ([string]$cmd.cmd) } catch {} }
  }

  if (-not $exitLoop) {
    $json = $null
    try {
      $sess = $null
      try {
        $list = $script:Manager.GetSessions()
        $playingBest = $null
        $playingBestPos = -1
        $first = $null
        foreach ($it in $list) {
          if ($null -eq $first) { $first = $it }
          $st2 = 0
          try { $st2 = [int]($it.GetPlaybackInfo().PlaybackStatus) } catch { $st2 = 0 }
          if ($st2 -eq 4) {
            $pos2 = 0
            try { $pos2 = $it.GetTimelineProperties().Position.TotalSeconds } catch { $pos2 = 0 }
            if ($pos2 -gt $playingBestPos) { $playingBest = $it; $playingBestPos = $pos2 }
          }
        }
        if ($null -ne $playingBest) {
          $sess = $playingBest
        } else {
          try { $sess = $script:Manager.GetCurrentSession() } catch { $sess = $null }
          if ($null -eq $sess) { $sess = $first }
        }
      } catch {
        try { $sess = $script:Manager.GetCurrentSession() } catch { $sess = $null }
      }

      if ($null -eq $sess) {
        $script:Session = $null
        $script:LastThumbTitle = ''
        $json = @{ active = $false }
      } else {
        $script:Session = $sess
        $title = ''; $artist = ''; $album = ''
        $props = $null
        try {
          $props = Await ($sess.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
          $title = [string]$props.Title
          $artist = [string]$props.Artist
          $album = [string]$props.AlbumTitle
        } catch {}

        if ($title -and $title -ne $script:LastThumbTitle) {
          $script:LastThumbTitle = $title
          try {
            if ($null -ne $props -and $null -ne $props.Thumbnail -and $null -ne $asStreamMethod) {
              $tStream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
              $netStream = $asStreamMethod.Invoke($null, @($tStream))
              $ms = New-Object System.IO.MemoryStream
              $netStream.CopyTo($ms)
              $tBytes = $ms.ToArray()
              try { $ms.Dispose() } catch {}
              try { $netStream.Dispose() } catch {}
              try { $tStream.Dispose() } catch {}
              if ($tBytes.Length -gt 0 -and $tBytes.Length -le 500000) {
                $thumbJson = @{ thumb = [Convert]::ToBase64String($tBytes); k = $title } | ConvertTo-Json -Compress
                [Console]::Out.WriteLine($thumbJson)
                [Console]::Out.Flush()
              }
            }
          } catch {}
        }

        $status = 0
        try { $status = [int]($sess.GetPlaybackInfo().PlaybackStatus) } catch { $status = 0 }
        $pos = 0; $dur = 0
        try {
          $tl = $sess.GetTimelineProperties()
          $rawPos = $tl.Position.TotalSeconds
          if ($status -eq 4 -and $tl.LastUpdatedTime.Year -gt 2000) {
            $el = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
            if ($el -ge 0 -and $el -lt 10) { $rawPos += $el }
          }
          $pos = [math]::Round($rawPos, 2)
          $dur = [math]::Round($tl.EndTime.TotalSeconds, 1)
        } catch {}
        $src = ''
        try { $src = [string]$sess.SourceAppUserModelId } catch {}
        $json = @{
          active = $true; title = $title; artist = $artist; album = $album
          status = $status; pos = $pos; dur = $dur; source = $src
        }
      }
    } catch { $json = @{ active = $false } }

    if ($null -ne $json) {
      $out = $json | ConvertTo-Json -Compress
      if ($out -ne $lastJson) {
        $lastJson = $out
        [Console]::Out.WriteLine($out)
        [Console]::Out.Flush()
      }
    }
    Start-Sleep -Milliseconds $IntervalMs
  }
}
