param([string]$Output = "$PSScriptRoot\input-helper.exe")
$ErrorActionPreference = 'Stop'
& gcc -std=c11 -O2 -Wall -Wextra -municode "$PSScriptRoot/input_windows.c" -o $Output -lwlanapi -liphlpapi -lws2_32 -luser32
if ($LASTEXITCODE -ne 0) { throw 'Windows helper compilation failed' }
