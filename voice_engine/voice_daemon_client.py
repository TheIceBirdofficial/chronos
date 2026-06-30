# Chronos Voice Daemon Client
# Production build - connects to cloud backend only
import os
import sys
import time
import json
import threading
import subprocess
import urllib.request
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

# Production backend only - no localhost
API_URLS = [
    'https://chronos-backend-410257364704.europe-west1.run.app'
]

# Track browser tab heartbeats
last_heartbeat = time.time()

# Kokoro ONNX TTS Setup
home_dir = Path.home()
KOKORO_MODEL_PATH = os.environ.get('KOKORO_MODEL_PATH', str(home_dir / 'kokoro_previews' / 'kokoro-v1.0.onnx'))
KOKORO_VOICES_PATH = os.environ.get('KOKORO_VOICES_PATH', str(home_dir / 'kokoro_previews' / 'voices-v1.0.bin'))

kokoro = None
try:
    from kokoro_onnx import Kokoro
    if os.path.exists(KOKORO_MODEL_PATH) and os.path.exists(KOKORO_VOICES_PATH):
        print(f'[TTS] Loading Kokoro engine from: {KOKORO_MODEL_PATH}')
        kokoro = Kokoro(KOKORO_MODEL_PATH, KOKORO_VOICES_PATH)
        print('[TTS] Kokoro engine initialized successfully.')
    else:
        print('[TTS] Kokoro model files not found. Using PowerShell TTS fallback.')
except Exception as e:
    print(f'[TTS] Kokoro init failed: {e}. Using PowerShell TTS fallback.')


def speak(text):
    clean_text = text.strip()
    if not clean_text:
        return
    print(f'[Speech] Speaking: {clean_text}')
    if kokoro is not None:
        try:
            import sounddevice as sd
            import numpy as np
            # af_sky: cleaner, more neutral tone than af_bella; speed 1.0 = natural pacing
            data, sample_rate = kokoro.create(clean_text, voice='af_sky', speed=1.0, lang='en-us')
            
            # Trim trailing near-silence (< 1% amplitude) to avoid audible cutoff gap
            threshold = np.max(np.abs(data)) * 0.01 if len(data) > 0 else 0
            trimmed = np.trim_zeros(np.where(np.abs(data) > threshold, data, 0), 'b')
            if len(trimmed) == 0:
                trimmed = data
                
            # Add a short natural pause after speech (250ms)
            pad_len = int(sample_rate * 0.25)
            silence_padding = np.zeros(pad_len, dtype=trimmed.dtype)
            padded_data = np.concatenate([trimmed, silence_padding])
            
            sd.play(padded_data, sample_rate)
            sd.wait()
            return
        except Exception as e:
            print(f'[Kokoro error] {e} - falling back to PowerShell TTS')
            
    ps_text = clean_text.replace('"', '').replace("'", '')
    ps_cmd = (
        f"$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"$s.Rate = -1; " # Calm, deliberate pacing
        f"$s.Speak('{ps_text}');"
    )
    subprocess.Popen(['powershell', '-Command', ps_cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ping_backend(url):
    try:
        req = urllib.request.Request(f'{url}/api/voice/ping', data=b'{}', headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=3) as res:
            res.read()
    except Exception:
        pass

def ping_loop():
    print('[Daemon] Pinging production backend...')
    while True:
        for url in API_URLS:
            ping_backend(url)
        time.sleep(5)

def stream_events(url):
    while True:
        try:
            print(f'[Daemon] Connecting to SSE stream at {url}/api/voice/events')
            req = urllib.request.Request(f'{url}/api/voice/events')
            with urllib.request.urlopen(req, timeout=600) as response:
                for line in response:
                    line_str = line.decode('utf-8').strip()
                    if line_str.startswith('data:'):
                        try:
                            data = json.loads(line_str[5:].strip())
                            if data.get('text') and data.get('speak') is not False:
                                speak(data['text'])
                        except Exception as e:
                            print(f'[Daemon] Error parsing event data: {e}')
        except Exception as e:
            print(f'[Daemon] Stream disconnected from {url}: {e}')
            time.sleep(5)

class DaemonRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress noisy HTTP logs
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        global last_heartbeat
        if self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'online', 'service': 'chronos-voice-daemon'}).encode('utf-8'))
        elif self.path == '/heartbeat':
            last_heartbeat = time.time()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'acknowledged'}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run_local_server():
    server = HTTPServer(('127.0.0.1', 43210), DaemonRequestHandler)
    print('[Daemon] Local API server listening on http://127.0.0.1:43210')
    server.serve_forever()

def monitor_browser_presence():
    global last_heartbeat
    # 15s initial grace period for browser to connect/handshake
    time.sleep(15)
    while True:
        if time.time() - last_heartbeat > 10.0:
            print('[Daemon] No browser heartbeat. Shutting down.')
            speak('Chronos voice bridge closed')
            time.sleep(2)
            os._exit(0)
        time.sleep(2)

if __name__ == '__main__':
    print('=== CHRONOS VOICE COORDINATION DAEMON ===')
    speak('Chronos Voice Daemon online')
    
    # Run ping loop in background
    threading.Thread(target=ping_loop, daemon=True).start()
    
    # Run SSE stream listeners in background
    for url in API_URLS:
        threading.Thread(target=stream_events, args=(url,), daemon=True).start()
        
    # Run browser presence monitor
    threading.Thread(target=monitor_browser_presence, daemon=True).start()
    
    # Start local HTTP server
    run_local_server()
