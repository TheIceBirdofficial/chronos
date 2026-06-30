#!/usr/bin/env bash
# Build Chronos Voice Daemon (macOS/Linux)
set -e
pip install -r voice_engine/requirements_daemon.txt
pip install pyinstaller
pyinstaller chronos_voice_daemon.spec
cp dist/chronos_voice_daemon frontend/public/chronos_voice_daemon
echo "✅ Daemon built and copied to frontend/public/chronos_voice_daemon"
