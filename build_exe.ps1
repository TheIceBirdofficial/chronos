# Build Chronos Voice Daemon EXE
pip install -r voice_engine/requirements_daemon.txt
pip install pyinstaller
pyinstaller chronos_voice_daemon.spec
Copy-Item dist\chronos_voice_daemon.exe frontend\public\ -Force
Write-Host "✅ Daemon built and copied to frontend/public/chronos_voice_daemon.exe"
