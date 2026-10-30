param(
    [string]$PipePath,
    [switch]$Discover
)
$ErrorActionPreference = 'Stop'
if (-not $Discover -and $PipePath -notmatch '^\\\\\.\\pipe\\codex-(app-tools|browser-use|computer-use)-[A-Za-z0-9-]+$') {
    throw 'Unrecognized Codex App pipe path.'
}
if (-not ('CodexBus.NativePipe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace CodexBus {
    public static class NativePipe {
        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint OPEN_EXISTING = 3;
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetNamedPipeServerProcessId(SafeFileHandle pipe, out uint serverProcessId);
        public static uint GetServerProcessId(string pipePath) {
            using (SafeFileHandle handle = CreateFile(pipePath, GENERIC_READ | GENERIC_WRITE, 0, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the named pipe.");
                uint serverProcessId;
                if (!GetNamedPipeServerProcessId(handle, out serverProcessId)) throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not resolve the named-pipe server PID.");
                return serverProcessId;
            }
        }
    }
}
'@
}
if ($Discover) {
    $paths = @([System.IO.Directory]::GetFiles("\\.\pipe\") | Where-Object { $_ -match '^\\\\\.\\pipe\\codex-(app-tools|browser-use|computer-use)-[A-Za-z0-9-]+$' })
    if ($paths.Count -gt 256) { throw 'Too many Codex App pipe candidates.' }
    $owners = @(foreach ($candidate in $paths) {
        try {
            $serverPid = [int][CodexBus.NativePipe]::GetServerProcessId($candidate)
            $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
            [pscustomobject]@{ pipePath = $candidate; processId = $serverPid; name = [string]$proc.Name; executablePath = [string]$proc.ExecutablePath }
        } catch { }
    })
    ConvertTo-Json -InputObject $owners -Compress
    exit 0
}
$serverPid = [CodexBus.NativePipe]::GetServerProcessId($PipePath)
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid"
if (-not $process) { throw "Pipe server process $serverPid exited before inspection." }
[pscustomobject]@{
    processId       = [int]$process.ProcessId
    name            = [string]$process.Name
    executablePath  = [string]$process.ExecutablePath
} | ConvertTo-Json -Compress
