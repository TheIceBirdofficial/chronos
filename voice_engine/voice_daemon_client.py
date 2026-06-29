# Chronos Voice Daemon Client
import os
import sys
import time
import json
import threading
import subprocess
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

# API URLs to ping and stream
API_URLS = [
    'http://localhost:5000',
    'https://chronos-backend-410257364704.europe-west1.run.app'
]

def speak(text):
    print(f'[Speech] Speaking: {text}')
    # Clean text to avoid quotes breaking powershell
    clean_text = text.replace('"', '').replace("'", '')
    ps_cmd = f"Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{clean_text}')"
    subprocess.Popen(['powershell', '-Command', ps_cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def ping_backend(url):
    try:
        req = urllib.request.Request(f'{url}/api/voice/ping', data=b'{}', headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=3) as res:
            res.read()
    except Exception:
        pass

def ping_loop():
    print('[Daemon] Pinging backend endpoints...')
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
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'online', 'service': 'chronos-voice-daemon'}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def run_local_server():
    server = HTTPServer(('127.0.0.1', 43210), DaemonRequestHandler)
    print('[Daemon] Local CORS API server listening on http://127.0.0.1:43210')
    server.serve_forever()

if __name__ == '__main__':
    print('=== CHRONOS VOICE COORDINATION DAEMON ===')
    speak('Chronos Voice Daemon online')
    
    # Run ping loop in background
    threading.Thread(target=ping_loop, daemon=True).start()
    
    # Run SSE stream listeners in background
    for url in API_URLS:
        threading.Thread(target=stream_events, args=(url,), daemon=True).start()
        
    # Start local HTTP server
    run_local_server()
