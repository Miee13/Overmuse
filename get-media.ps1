[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media,ContentType=WindowsRuntime] | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { 
    $_.ToString() -eq 'System.Threading.Tasks.Task`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation`1[TResult])' 
})[0]

Function AwaitAction($WinRtAction) {
    $asTask = $asTaskGeneric.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $netTask = $asTask.Invoke($null, @($WinRtAction))
    $netTask.Wait() | Out-Null
    $netTask.Result
}

$sessionManager = AwaitAction([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
$sessions = $sessionManager.GetSessions()

$results = @()
foreach ($session in $sessions) {
    # Prioritaskan hanya sesi Pear Desktop / YouTube Music jika ada
    $appId = $session.SourceAppUserModelId
    $playback = $session.GetPlaybackInfo()
    $timeline = $session.GetTimelineProperties()
    
    $pos = $timeline.Position.TotalSeconds
    $statusStr = $playback.PlaybackStatus.ToString()
    if ($statusStr -eq "Playing" -and $timeline.LastUpdatedTime) {
        $elapsed = ([DateTime]::UtcNow - $timeline.LastUpdatedTime.UtcDateTime).TotalSeconds
        $pos = $pos + $elapsed
    }
    $duration = $timeline.EndTime.TotalSeconds - $timeline.StartTime.TotalSeconds
    if ($duration -gt 0 -and $pos -gt $duration) { $pos = $duration }
    if ($pos -lt 0) { $pos = 0 }

    $item = @{
        appId = $appId
        status = $statusStr
        position = [math]::Round($pos, 2)
        duration = [math]::Round($duration, 2)
        title = ""
        artist = ""
    }
    
    # Hanya query media props jika diperlukan
    try {
        [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media,ContentType=WindowsRuntime] | Out-Null
        $mediaPropsTask = $session.TryGetMediaPropertiesAsync()
        $asTaskMedia = $asTaskGeneric.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $mediaTask = $asTaskMedia.Invoke($null, @($mediaPropsTask))
        $mediaTask.Wait() | Out-Null
        $media = $mediaTask.Result
        $item.title = $media.Title
        $item.artist = $media.Artist
    } catch {}
    
    $results += $item
}

if ($results.Count -gt 0) {
    $results | ConvertTo-Json -Compress
} else {
    Write-Output "[]"
}
