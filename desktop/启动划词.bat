@echo off
rem 用 pythonw 跑 = 没有黑窗口。关掉它：Ctrl+Alt+Q，或者任务管理器结束 pythonw.exe
start "" "C:\ProgramData\anaconda3\pythonw.exe" "%~dp0lookup.py"
