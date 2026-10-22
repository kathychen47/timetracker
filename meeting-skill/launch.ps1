# Otter（Meowly 版）：用本机调试通道打开 Otter app，并在后台起 Meowly 会议桥。
# 桌面上的「Otter (Meowly)」快捷方式就是跑这个。
$ErrorActionPreference = 'SilentlyContinue'
# 从 VS Code 里起的话会继承这个变量，Otter（Electron）就会当成普通 Node 跑、一闪就退
Remove-Item Env:ELECTRON_RUN_AS_NODE
Remove-Item Env:ELECTRON_NO_ATTACH_CONSOLE
Add-Type -AssemblyName System.Windows.Forms

$port = 9333
$otter = Join-Path $env:LOCALAPPDATA 'Programs\com.otterai.desktop\Otter.exe'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function PortUp { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$port/json/version" | Out-Null; $true } catch { $false } }
function BridgeUp { try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:47321/ping" | Out-Null; $true } catch { $false } }

if (-not (Test-Path $otter)) { [System.Windows.Forms.MessageBox]::Show("没找到 Otter app：$otter", "Otter (Meowly)") | Out-Null; exit }

if (-not (PortUp)) {
  if (Get-Process Otter -ErrorAction SilentlyContinue) {
    $r = [System.Windows.Forms.MessageBox]::Show(
      "Otter 已经开着（可能在右下角托盘里），但不是从这个快捷方式开的，读不到稿子。`n`n要重启 Otter 吗？`n正在录音时请选「否」，录完再来。",
      "Otter (Meowly)", 'YesNo', 'Question')
    if ($r -ne 'Yes') { exit }
    Stop-Process -Name Otter -Force
    Start-Sleep -Seconds 2
  }
  Start-Process -FilePath $otter -ArgumentList "--remote-debugging-port=$port"
}

if (-not (BridgeUp)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { [System.Windows.Forms.MessageBox]::Show("没找到 Node.js，会议桥起不来（Otter 照常能用）。", "Otter (Meowly)") | Out-Null; exit }
  Start-Process -FilePath $node -ArgumentList "`"$here\bridge.js`"" -WindowStyle Hidden
}
