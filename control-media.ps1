param (
    [Parameter(Mandatory=$false)]
    [ValidateSet("pause", "play", "toggle")]
    [string]$Action = "pause"
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$actionSuccess = $false

try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media,ContentType=WindowsRuntime] | Out-Null
    $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
        $_.ToString() -eq 'System.Threading.Tasks.Task`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation`1[TResult])' 
    })[0]

    $asTaskManager = $asTaskGeneric.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $mgrTask = $asTaskManager.Invoke($null, @([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()))
    $mgrTask.Wait() | Out-Null
    $sessionManager = $mgrTask.Result

    $sessions = $sessionManager.GetSessions()
    $asTaskBool = $asTaskGeneric.MakeGenericMethod([bool])

    foreach ($session in $sessions) {
        $info = $session.GetPlaybackInfo()
        $status = $info.PlaybackStatus

        if ($Action -eq "pause" -and $status -eq "Playing") {
            $task = $asTaskBool.Invoke($null, @($session.TryPauseAsync()))
            $task.Wait() | Out-Null
            $actionSuccess = $task.Result
            if ($actionSuccess) { break }
        }
        elseif ($Action -eq "play" -and ($status -eq "Paused" -or $status -eq "Stopped")) {
            $task = $asTaskBool.Invoke($null, @($session.TryPlayAsync()))
            $task.Wait() | Out-Null
            $actionSuccess = $task.Result
            if ($actionSuccess) { break }
        }
        elseif ($Action -eq "toggle") {
            $task = $asTaskBool.Invoke($null, @($session.TryTogglePlayPauseAsync()))
            $task.Wait() | Out-Null
            $actionSuccess = $task.Result
            if ($actionSuccess) { break }
        }
    }

    if (-not $actionSuccess -and $sessions.Count -gt 0) {
        $targetSession = $sessions[0]
        if ($Action -eq "pause") {
            $task = $asTaskBool.Invoke($null, @($targetSession.TryPauseAsync()))
            $task.Wait() | Out-Null
            $actionSuccess = $task.Result
        } elseif ($Action -eq "play") {
            $task = $asTaskBool.Invoke($null, @($targetSession.TryPlayAsync()))
            $task.Wait() | Out-Null
            $actionSuccess = $task.Result
        }
    }
} catch {
}

# Win32 hardware key fallback jika GSMTC tidak berhasil
if (-not $actionSuccess) {
    try {
        $myscript = @'
        using System;
        using System.Runtime.InteropServices;
        public class WinMediaControlAction {
            [DllImport("user32.dll")]
            public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
            public static void TogglePlayPause() {
                // VK_MEDIA_PLAY_PAUSE = 0xCD
                keybd_event(0xCD, 0, 0, 0);
                keybd_event(0xCD, 0, 2, 0);
            }
        }
'@
        Add-Type -TypeDefinition $myscript -ErrorAction SilentlyContinue
        [WinMediaControlAction]::TogglePlayPause()
        Write-Output "SUCCESS_FALLBACK"
        exit 0
    } catch {
        Write-Output "FAILED"
        exit 1
    }
}

Write-Output "SUCCESS"
