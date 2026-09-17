Add-Type -AssemblyName System.Runtime.WindowsRuntime

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
    $skipped = $false

    foreach ($session in $sessions) {
        $info = $session.GetPlaybackInfo()
        if ($info.PlaybackStatus -eq "Playing") {
            $asTaskBool = $asTaskGeneric.MakeGenericMethod([bool])
            $skipTask = $asTaskBool.Invoke($null, @($session.TrySkipNextAsync()))
            $skipTask.Wait() | Out-Null
            $skipped = $true
            break
        }
    }

    if (-not $skipped -and $sessions.Count -gt 0) {
        $asTaskBool = $asTaskGeneric.MakeGenericMethod([bool])
        $skipTask = $asTaskBool.Invoke($null, @($sessions[0].TrySkipNextAsync()))
        $skipTask.Wait() | Out-Null
        $skipped = $true
    }
} catch {
    # Fallback to keybd_event if WinRT fails
}

# Win32 hardware key fallback
try {
    $myscript = @'
    using System;
    using System.Runtime.InteropServices;
    public class WinMediaControl {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, uint dwExtraInfo);
        public static void SkipTrack() {
            keybd_event(0xB0, 0, 0, 0);
            keybd_event(0xB0, 0, 2, 0);
        }
    }
'@
    Add-Type -TypeDefinition $myscript -ErrorAction SilentlyContinue
    [WinMediaControl]::SkipTrack()
    Write-Output "SUCCESS"
} catch {
    Write-Output "FALLBACK_FAILED"
}
