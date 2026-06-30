"""Chronos Voice Daemon — Cross-platform global hotkey (Alt+C) voice assistant.

Uses Google Cloud STT + TTS APIs (no local model files).
Requires: pynput, sounddevice, requests

Run directly: python voice_daemon_exe_entry.py [--standalone]
Build EXE:    pyinstaller chronos_voice_daemon.spec
"""
import os
import sys
import time
import json
import base64
import queue
import hashlib
import subprocess
import threading
import urllib.request
import struct
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────
API_URLS = [
    'http://127.0.0.1:5000',  # dev fallback
    'https://chronos-backend-410257364704.europe-west1.run.app',
]
SAMPLE_RATE = 16000
RECORD_SECONDS = 8
SILENCE_THRESHOLD = 0.02
SILENCE_DURATION = 1.0
HEARTBEAT_TIMEOUT = 30  # seconds before auto-shutdown (standalone disables)

# ── State ──────────────────────────────────────────────────────────────
last_heartbeat = time.time()
google_api_key = ""
backend_url = ""
user_id = ""
standalone = '--standalone' in sys.argv
speech_queue = queue.Queue()
recording_lock = threading.Lock()
is_recording = False
_spoken_hashes: set = set()   # dedup — prevents repeating identical phrases

# ── Sounddevice helpers (lazy-import to keep startup fast) ─────────────
_sd = None
_np = None

def _ensure_audio():
    global _sd, _np
    if _sd is None:
        import sounddevice as sd
        _sd = sd
    if _np is None:
        import numpy as np
        _np = np
    return _sd, _np


# ── Google Cloud STT ───────────────────────────────────────────────────
def google_stt(audio_bytes):
    if not google_api_key:
        print("[STT] No API key configured.", flush=True)
        return ""
    sd, np = _ensure_audio()
    try:
        b64 = base64.b64encode(audio_bytes).decode('utf-8')
        url = f"https://speech.googleapis.com/v1/speech:recognize?key={google_api_key}"
        body = json.dumps({
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": SAMPLE_RATE,
                "languageCode": "en-US",
                "model": "latest_short"
            },
            "audio": {"content": b64}
        }).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read())
        if 'results' in data and data['results']:
            return data['results'][0]['alternatives'][0]['transcript']
    except Exception as e:
        print(f"[STT Error] {e}", flush=True)
    return ""


# ── Google Cloud TTS ───────────────────────────────────────────────────
def google_tts(text):
    if not google_api_key:
        print(f"[TTS] No API key — printing: {text}", flush=True)
        return None
    try:
        url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={google_api_key}"
        body = json.dumps({
            "input": {"text": text},
            "voice": {"languageCode": "en-US", "name": "en-US-Neural2-F"},
            "audioConfig": {"audioEncoding": "LINEAR16", "speakingRate": 1.1}
        }).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read())
        audio_b64 = data.get('audioContent', '')
        if audio_b64:
            return base64.b64decode(audio_b64)
    except Exception as e:
        print(f"[TTS Error] {e}", flush=True)
    return None


# ── Audio capture ──────────────────────────────────────────────────────
def record_audio():
    sd, np = _ensure_audio()
    print("[Mic] Recording... (speak now)", flush=True)
    audio = sd.rec(int(SAMPLE_RATE * RECORD_SECONDS),
                   samplerate=SAMPLE_RATE, channels=1, dtype='float64')
    sd.wait()
    audio_float = audio.flatten()
    audio_int16 = (audio_float * 32767).astype(np.int16)
    return audio_int16.tobytes()


# ── Playback ───────────────────────────────────────────────────────────
def play_audio(wav_bytes):
    sd, np = _ensure_audio()
    if wav_bytes is None:
        return
    try:
        audio_data = np.frombuffer(wav_bytes, dtype=np.int16)
        sd.play(audio_data, SAMPLE_RATE)
        sd.wait()
    except Exception as e:
        print(f"[Playback Error] {e}", flush=True)


def speak_text(text):
    """Speak text using Google Cloud TTS (preferred) or Windows System.Speech (fallback).
    Deduplicates messages — identical phrases spoken within the same session are ignored."""
    global _spoken_hashes
    clean = text.strip()
    if not clean:
        return
    # Deduplication: skip if this exact phrase was already spoken
    h = hashlib.md5(clean.lower().encode('utf-8')).hexdigest()
    if h in _spoken_hashes:
        print(f"[Daemon] Skipping duplicate: {clean}", flush=True)
        return
    if len(_spoken_hashes) > 200:
        _spoken_hashes.clear()  # periodic reset to avoid unbounded growth
    _spoken_hashes.add(h)

    print(f"[Daemon] Speaking: {clean}", flush=True)
    audio = google_tts(clean)
    if audio:
        play_audio(audio)
    else:
        # Fallback: Windows System.Speech (PowerShell) — works offline, no key required
        try:
            safe = clean.replace("'", "").replace('"', "").replace("\n", " ")
            ps_cmd = (
                "Add-Type -AssemblyName System.Speech; "
                "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                "$s.Rate = -1; "
                f"$s.Speak('{safe}');"
            )
            subprocess.Popen(
                ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps_cmd],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
        except Exception as ps_err:
            print(f"[TTS Fallback Error] {ps_err}", flush=True)


# ── Send to backend AI ─────────────────────────────────────────────────
def query_ai(transcript):
    if not backend_url:
        print("[AI] No backend URL configured.", flush=True)
        return "Chronos backend not configured."
    if not user_id:
        print("[AI] No user ID — sending as anonymous.", flush=True)
    try:
        body = json.dumps({
            "message": transcript,
            "history": []
        }).encode('utf-8')
        headers = {
            'Content-Type': 'application/json',
            'X-User-Id': user_id or 'anonymous'
        }
        req = urllib.request.Request(f"{backend_url}/api/ai/chat", data=body,
                                     headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=20) as res:
            data = json.loads(res.read())
        return data.get('response', 'No response from AI.')
    except Exception as e:
        print(f"[AI Error] {e}", flush=True)
        return f"Error contacting Chronos AI: {e}"


# ── Hotkey handler ────────────────────────────────────────────────────
_hotkey_listener = None

def on_activate():
    global is_recording
    with recording_lock:
        if is_recording:
            return
        is_recording = True
    try:
        speak_text("Listening")
        audio = record_audio()
        print("[Mic] Transcribing...", flush=True)
        transcript = google_stt(audio)
        if not transcript:
            print("[Mic] No speech detected.", flush=True)
            return
        print(f"[User] {transcript}", flush=True)
        response = query_ai(transcript)
        print(f"[Chronos] {response}", flush=True)
        speak_text(response)
    finally:
        with recording_lock:
            is_recording = False


def setup_hotkey():
    global _hotkey_listener
    from pynput import keyboard
    try:
        from pynput.keyboard import Key, Listener
        COMBINATION = {keyboard.Key.alt, keyboard.KeyCode.from_char('c')}
        current = set()

        def on_press(key):
            if key in COMBINATION:
                current.add(key)
                if all(k in current for k in COMBINATION):
                    threading.Thread(target=on_activate, daemon=True).start()
            if key == keyboard.Key.alt:
                current.add(key)

        def on_release(key):
            try:
                current.discard(key)
            except KeyError:
                pass
            if key == keyboard.Key.alt:
                current.discard(key)

        listener = Listener(on_press=on_press, on_release=on_release)
        listener.daemon = True
        listener.start()
        _hotkey_listener = listener
        print("[Daemon] Alt+C hotkey registered (global).", flush=True)
    except Exception as e:
        print(f"[Hotkey Error] Could not register global hotkey: {e}", flush=True)
        print("[Daemon] Falling back: voice will only respond to browser SSE.", flush=True)


# ── SSE listener ───────────────────────────────────────────────────────
def sse_listener(url):
    while True:
        try:
            print(f"[SSE] Connecting to {url}/api/voice/events", flush=True)
            req = urllib.request.Request(f"{url}/api/voice/events")
            req.add_header('X-User-Id', user_id or 'anonymous')
            with urllib.request.urlopen(req, timeout=600) as res:
                for line in res:
                    line_str = line.decode('utf-8').strip()
                    if line_str.startswith('data:'):
                        try:
                            data = json.loads(line_str[5:].strip())
                            if data.get('text') and data.get('speak') is not False:
                                speak_text(data['text'])
                        except Exception as e:
                            print(f"[SSE] Parse error: {e}", flush=True)
        except Exception as e:
            print(f"[SSE] Disconnected: {e}, reconnecting in 5s...", flush=True)
            time.sleep(5)


# ── Local HTTP server ──────────────────────────────────────────────────
class DaemonHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

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
            self.wfile.write(json.dumps({
                'status': 'online',
                'service': 'chronos-voice-daemon',
                'hotkey': 'Alt+C',
                'apiKey': bool(google_api_key),
                'userId': bool(user_id)
            }).encode('utf-8'))
        elif self.path == '/heartbeat':
            last_heartbeat = time.time()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'acknowledged'}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global user_id, google_api_key, backend_url
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len else b'{}'
        data = json.loads(body) if body else {}
        if self.path == '/register':
            uid = data.get('userId', '')
            if uid:
                user_id = uid
                print(f"[Daemon] Registered user: {user_id}", flush=True)
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'registered'}).encode('utf-8'))
                return
        self.send_response(404)
        self.end_headers()


def run_local_server():
    port = 43210
    for attempt in range(5):
        try:
            server = HTTPServer(('127.0.0.1', port + attempt), DaemonHandler)
            print(f"[Daemon] Local HTTP server on 127.0.0.1:{port + attempt}", flush=True)
            server.serve_forever()
            return
        except OSError:
            continue
    print("[Daemon] Could not open local HTTP server port.", flush=True)


# ── Bootstrap ──────────────────────────────────────────────────────────
def fetch_config():
    global google_api_key, backend_url, user_id
    for url in API_URLS:
        try:
            req = urllib.request.Request(f"{url}/api/voice/config")
            req.add_header('X-User-Id', user_id or 'anonymous')
            with urllib.request.urlopen(req, timeout=5) as res:
                data = json.loads(res.read())
                google_api_key = data.get('googleApiKey', google_api_key)
                backend_url = data.get('backendUrl', url)
                if data.get('userId'):
                    user_id = data['userId']
                print(f"[Config] Fetched from {url}", flush=True)
                print(f"[Config] API key set: {bool(google_api_key)}", flush=True)
                print(f"[Config] Backend: {backend_url}", flush=True)
                return True
        except Exception as e:
            print(f"[Config] {url} — {e}", flush=True)
    print("[Config] Could not reach any backend. Running in offline mode.", flush=True)
    return False


def heartbeat_monitor():
    if standalone:
        return
    time.sleep(15)
    while True:
        if time.time() - last_heartbeat > HEARTBEAT_TIMEOUT:
            print(f"[Daemon] No heartbeat for {HEARTBEAT_TIMEOUT}s. Shutting down.", flush=True)
            speak_text("Chronos voice bridge closed")
            time.sleep(2)
            os._exit(0)
        time.sleep(2)


def ping_loop():
    while True:
        for url in API_URLS:
            try:
                req = urllib.request.Request(f"{url}/api/voice/ping",
                                             data=b'{}',
                                             headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req, timeout=3):
                    pass
            except Exception:
                pass
        time.sleep(10)


if __name__ == '__main__':
    print("=" * 50, flush=True)
    print("  CHRONOS VOICE DAEMON", flush=True)
    print(f"  {'Standalone mode' if standalone else 'Browser companion mode'}", flush=True)
    print("  Hotkey: Alt+C (system-wide)", flush=True)
    print("=" * 50, flush=True)

    fetch_config()

    speak_text("Chronos voice daemon online")

    threading.Thread(target=ping_loop, daemon=True).start()

    for url in API_URLS:
        threading.Thread(target=sse_listener, args=(url,), daemon=True).start()

    threading.Thread(target=heartbeat_monitor, daemon=True).start()

    setup_hotkey()

    run_local_server()
