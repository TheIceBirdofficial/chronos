"""Chronos Voice Daemon — Silent system tray with Alt+C global hotkey.

Architecture:
  - pystray: system tray icon (status + right-click menu)
  - Alt+C:   global hotkey → Google STT → AI chat → Google TTS response
  - Second Alt+C during speech: interrupt and restart listening
  - Browser heartbeat (POST /heartbeat every 5–10s) keeps daemon alive
  - No heartbeat for >30s + 5s grace → clean self-termination
  - SSE listener: receives backend proactive alerts, speaks them
  - No console window: use pythonw or PyInstaller with console=False

Build EXE (no console):
    pyinstaller chronos_voice_daemon.spec

Run directly (development):
    pythonw voice_daemon_exe_entry.py
"""
import os
import sys
import io
import time
import json
import base64
import queue
import hashlib
import subprocess
import threading
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── Config ──────────────────────────────────────────────────────────────
API_URLS = [
    'http://127.0.0.1:5000',
    'https://chronos-backend-410257364704.europe-west1.run.app',
]
SAMPLE_RATE    = 16000
RECORD_SECONDS = 8
HEARTBEAT_TIMEOUT = 30  # seconds; standalone mode skips this
SILENCE_THRESHOLD = 0.02
DAEMON_PORT    = 43210

# ── State ────────────────────────────────────────────────────────────────
last_heartbeat   = time.time()
active_tabs      = set()
grace_exit_start = 0.0
google_api_key   = ""
backend_url      = ""
user_id          = ""
standalone       = '--standalone' in sys.argv
speech_queue     = queue.Queue()
recording_lock   = threading.Lock()
is_recording     = False
is_speaking      = False          # True while Google TTS audio is playing
_spoken_hashes: set = set()       # dedup — skips identical phrases
_tray_icon       = None           # pystray icon instance (set in main)
_tray_status     = "Starting..."  # shown in tray title

# ── Sounddevice lazy-import ──────────────────────────────────────────────
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

# ── Tray helpers ─────────────────────────────────────────────────────────
def _set_tray_status(text: str):
    global _tray_status
    _tray_status = text
    if _tray_icon is not None:
        try:
            _tray_icon.title = f"Chronos Voice — {text}"
            _tray_icon.update_menu()
        except Exception:
            pass

def _tray_status_item():
    """Dynamic tray menu item showing current status."""
    import pystray
    return pystray.MenuItem(
        lambda _: f"⬤  {_tray_status}",
        action=None,
        enabled=False
    )

def _open_logs():
    log_path = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'ChronosVoice' / 'daemon.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if not log_path.exists():
        log_path.write_text("[Chronos Voice] No log entries yet.\n")
    subprocess.Popen(['notepad.exe', str(log_path)],
                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))

def _restart_voice():
    _set_tray_status("Restarting SSE...")
    # Restart the SSE listener threads
    for url in API_URLS:
        threading.Thread(target=sse_listener, args=(url,), daemon=True).start()
    _set_tray_status("Connected")

def _exit_daemon():
    _set_tray_status("Stopping...")
    if _tray_icon is not None:
        try:
            _tray_icon.stop()
        except Exception:
            pass
    time.sleep(0.5)
    os._exit(0)

def _build_icon():
    """Generate a minimal Chronos 'C' tray icon at runtime using Pillow."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        size = 64
        img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # Deep purple circle
        draw.ellipse([2, 2, size - 2, size - 2], fill=(100, 30, 200, 255))
        # White 'C'
        try:
            font = ImageFont.truetype("arial.ttf", 36)
        except Exception:
            font = ImageFont.load_default()
        draw.text((16, 10), "C", fill=(255, 255, 255, 255), font=font)
        return img
    except Exception:
        # Ultra-minimal fallback: solid purple square
        try:
            from PIL import Image
            img = Image.new('RGBA', (32, 32), (100, 30, 200, 255))
            return img
        except Exception:
            return None

# ── Google Cloud STT ─────────────────────────────────────────────────────
def google_stt(audio_bytes: bytes) -> str:
    if not google_api_key:
        print("[STT] No API key.", flush=True)
        return ""
    try:
        b64 = base64.b64encode(audio_bytes).decode()
        url = f"https://speech.googleapis.com/v1/speech:recognize?key={google_api_key}"
        body = json.dumps({
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": SAMPLE_RATE,
                "languageCode": "en-US",
                "model": "latest_short"
            },
            "audio": {"content": b64}
        }).encode()
        req = urllib.request.Request(url, data=body,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read())
        if data.get('results'):
            return data['results'][0]['alternatives'][0]['transcript']
    except Exception as e:
        print(f"[STT Error] {e}", flush=True)
    return ""

# ── Google Cloud TTS ─────────────────────────────────────────────────────
def google_tts(text: str):
    """Returns raw LINEAR16 audio bytes or None."""
    if not google_api_key:
        return None
    try:
        url = f"https://texttospeech.googleapis.com/v1/text:synthesize?key={google_api_key}"
        body = json.dumps({
            "input": {"text": text},
            "voice": {"languageCode": "en-US", "name": "en-US-Neural2-F"},
            "audioConfig": {"audioEncoding": "LINEAR16", "speakingRate": 1.1}
        }).encode()
        req = urllib.request.Request(url, data=body,
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read())
        audio_b64 = data.get('audioContent', '')
        if audio_b64:
            return base64.b64decode(audio_b64)
    except Exception as e:
        print(f"[TTS Error] {e}", flush=True)
    return None

# ── Audio capture ────────────────────────────────────────────────────────
def record_audio() -> bytes:
    sd, np = _ensure_audio()
    print("[Mic] Recording...", flush=True)
    audio = sd.rec(int(SAMPLE_RATE * RECORD_SECONDS),
                   samplerate=SAMPLE_RATE, channels=1, dtype='float64')
    sd.wait()
    audio_int16 = (audio.flatten() * 32767).astype(np.int16)
    return audio_int16.tobytes()

# ── Playback ─────────────────────────────────────────────────────────────
_playback_sd = None  # sounddevice stream for interrupt support

def play_audio(wav_bytes: bytes):
    """Play LINEAR16 audio. Sets is_speaking flag; resets on completion or interrupt."""
    global is_speaking, _playback_sd
    sd, np = _ensure_audio()
    if not wav_bytes:
        return
    try:
        is_speaking = True
        _set_tray_status("Speaking")
        audio_data = np.frombuffer(wav_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        _playback_sd = sd.play(audio_data, SAMPLE_RATE)
        sd.wait()
    except Exception as e:
        print(f"[Playback Error] {e}", flush=True)
    finally:
        is_speaking = False
        _playback_sd = None
        _set_tray_status("Connected")

def interrupt_speech():
    """Stop ongoing playback immediately."""
    global is_speaking
    try:
        _sd and _sd.stop()
    except Exception:
        pass
    is_speaking = False

# ── speak_text ───────────────────────────────────────────────────────────
def speak_text(text: str):
    """Speak text via Google TTS (preferred) or Windows System.Speech (fallback).
    Deduplicates identical phrases within the session."""
    global _spoken_hashes
    clean = text.strip()
    if not clean:
        return

    # Dedup: skip if already spoken this session
    h = hashlib.md5(clean.lower().encode()).hexdigest()
    if h in _spoken_hashes:
        print(f"[Daemon] Skipping duplicate: {clean}", flush=True)
        return
    if len(_spoken_hashes) > 200:
        _spoken_hashes.clear()
    _spoken_hashes.add(h)

    print(f"[Daemon] Speaking: {clean}", flush=True)
    audio = google_tts(clean)
    if audio:
        play_audio(audio)
    else:
        # Fallback: Windows System.Speech via hidden PowerShell
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
        except Exception as e:
            print(f"[TTS Fallback Error] {e}", flush=True)

# ── AI query ─────────────────────────────────────────────────────────────
def query_ai(transcript: str) -> str:
    if not backend_url:
        return "Chronos backend not configured."
    try:
        body = json.dumps({"message": transcript, "history": []}).encode()
        headers = {'Content-Type': 'application/json', 'X-User-Id': user_id or 'anonymous'}
        req = urllib.request.Request(f"{backend_url}/api/ai/chat",
                                     data=body, headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=20) as res:
            data = json.loads(res.read())
        return data.get('response', data.get('content', 'No response.'))
    except Exception as e:
        print(f"[AI Error] {e}", flush=True)
        return f"Error: {e}"

# ── Hotkey handler ────────────────────────────────────────────────────────
def on_activate():
    """Alt+C pressed: if speaking → interrupt; if recording → ignore; else → listen."""
    global is_recording
    
    # If currently speaking, interrupt immediately
    if is_speaking:
        print("[Hotkey] Interrupting speech.", flush=True)
        interrupt_speech()
        _set_tray_status("Interrupted")
        return

    with recording_lock:
        if is_recording:
            return  # already recording — ignore double press
        is_recording = True

    _set_tray_status("Listening...")
    _set_tray_status("Listening")
    try:
        speak_text("Listening")
        audio = record_audio()
        print("[Mic] Transcribing...", flush=True)
        _set_tray_status("Thinking")
        transcript = google_stt(audio)
        if not transcript:
            print("[Mic] No speech detected.", flush=True)
            _set_tray_status("Connected")
            return
        print(f"[User] {transcript}", flush=True)
        response = query_ai(transcript)
        print(f"[Chronos] {response}", flush=True)
        speak_text(response)
    finally:
        with recording_lock:
            is_recording = False
        _set_tray_status("Connected")

def setup_hotkey():
    try:
        from pynput import keyboard
        COMBO = {keyboard.Key.alt, keyboard.KeyCode.from_char('c')}
        current: set = set()

        def on_press(key):
            current.add(key)
            if all(k in current for k in COMBO):
                threading.Thread(target=on_activate, daemon=True).start()

        def on_release(key):
            current.discard(key)

        listener = keyboard.Listener(on_press=on_press, on_release=on_release)
        listener.daemon = True
        listener.start()
        print("[Daemon] Alt+C hotkey registered.", flush=True)
    except Exception as e:
        print(f"[Hotkey Error] {e}", flush=True)

# ── SSE listener ──────────────────────────────────────────────────────────
def sse_listener(url: str):
    while True:
        try:
            print(f"[SSE] Connecting to {url}/api/voice/events", flush=True)
            _set_tray_status("Connected")
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
                        except Exception as parse_err:
                            print(f"[SSE] Parse error: {parse_err}", flush=True)
        except Exception as e:
            print(f"[SSE] Disconnected: {e}, reconnecting in 5s...", flush=True)
            _set_tray_status("Waiting")
            time.sleep(5)

# ── Local HTTP server (heartbeat + register) ──────────────────────────────
class DaemonHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress request logs

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        global last_heartbeat, active_tabs, grace_exit_start
        import urllib.parse
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        tab_id = query.get('tabId', [''])[0]

        if path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                'status': 'online',
                'service': 'chronos-voice-daemon',
                'hotkey': 'Alt+C',
                'apiKey': bool(google_api_key),
                'userId': bool(user_id),
                'isSpeaking': is_speaking,
            }).encode())
        elif path == '/heartbeat':
            last_heartbeat = time.time()
            if tab_id:
                active_tabs.add(tab_id)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'acknowledged'}).encode())
        elif path == '/disconnect':
            if tab_id in active_tabs:
                active_tabs.discard(tab_id)
            if len(active_tabs) == 0:
                grace_exit_start = time.time()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'disconnected'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global user_id, google_api_key, backend_url, active_tabs, grace_exit_start
        import urllib.parse
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)
        tab_id = query.get('tabId', [''])[0]

        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len) if content_len else b'{}'
        try:
            data = json.loads(body)
        except Exception:
            data = {}

        if path == '/register':
            uid = data.get('userId', '')
            if uid:
                user_id = uid
                print(f"[Daemon] Registered user: {user_id}", flush=True)
            tid = data.get('tabId', tab_id)
            if tid:
                active_tabs.add(tid)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'registered'}).encode())
        elif path == '/disconnect':
            tid = data.get('tabId', tab_id)
            if tid in active_tabs:
                active_tabs.discard(tid)
            if len(active_tabs) == 0:
                grace_exit_start = time.time()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'disconnected'}).encode())
        elif path == '/interrupt':
            interrupt_speech()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'interrupted'}).encode())
        else:
            self.send_response(404)
            self.end_headers()

def run_local_server():
    for attempt in range(5):
        try:
            server = HTTPServer(('127.0.0.1', DAEMON_PORT + attempt), DaemonHandler)
            print(f"[Daemon] HTTP server on 127.0.0.1:{DAEMON_PORT + attempt}", flush=True)
            server.serve_forever()
            return
        except OSError:
            continue
    print("[Daemon] Could not bind to any port.", flush=True)

# ── Bootstrap config fetch ────────────────────────────────────────────────
def fetch_config():
    global google_api_key, backend_url, user_id
    for url in API_URLS:
        try:
            req = urllib.request.Request(f"{url}/api/voice/config")
            req.add_header('X-User-Id', user_id or 'anonymous')
            with urllib.request.urlopen(req, timeout=5) as res:
                data = json.loads(res.read())
            google_api_key = data.get('googleApiKey', google_api_key)
            backend_url    = data.get('backendUrl', url)
            if data.get('userId'):
                user_id = data['userId']
            print(f"[Config] Fetched from {url} | key={'yes' if google_api_key else 'no'}", flush=True)
            return True
        except Exception as e:
            print(f"[Config] {url} — {e}", flush=True)
    print("[Config] Offline mode.", flush=True)
    return False

# ── Ping loop ─────────────────────────────────────────────────────────────
def ping_loop():
    while True:
        for url in API_URLS:
            try:
                req = urllib.request.Request(
                    f"{url}/api/voice/ping",
                    data=b'{}',
                    headers={'Content-Type': 'application/json'}
                )
                urllib.request.urlopen(req, timeout=3)
            except Exception:
                pass
        time.sleep(10)

# ── Heartbeat monitor ─────────────────────────────────────────────────────
def heartbeat_monitor():
    """Kill daemon when browser closes (no active tabs for 5s, or no heartbeat for HEARTBEAT_TIMEOUT)."""
    global grace_exit_start
    if standalone:
        return
    time.sleep(15)  # grace period on startup
    while True:
        now = time.time()
        # 1. Total silence timeout (heartbeat stopped completely without sending disconnect)
        elapsed = now - last_heartbeat
        if elapsed > HEARTBEAT_TIMEOUT:
            print(f"[Daemon] Hard timeout: no heartbeat for {elapsed:.0f}s. Shutting down.", flush=True)
            _exit_daemon()

        # 2. Tab-close count down (active tabs became 0)
        if len(active_tabs) == 0 and grace_exit_start > 0:
            grace_elapsed = now - grace_exit_start
            if grace_elapsed >= 5.0:
                print(f"[Daemon] Zero tabs remaining for {grace_elapsed:.1f}s. Shutting down.", flush=True)
                _exit_daemon()
        else:
            # reset grace if tabs reconnect
            grace_exit_start = 0.0

        time.sleep(1)
# ── Main ──────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    # Redirect all stdout/stderr to log file to stay completely silent
    log_dir = Path(os.environ.get('LOCALAPPDATA', Path.home())) / 'ChronosVoice'
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / 'daemon.log'
    _log_file = open(log_path, 'a', encoding='utf-8', buffering=1)
    if not standalone:
        sys.stdout = _log_file
        sys.stderr = _log_file

    print("=" * 50, flush=True)
    print("  CHRONOS VOICE DAEMON", flush=True)
    print(f"  {'Standalone' if standalone else 'Browser companion'} mode", flush=True)
    print("  Alt+C: voice query  |  Alt+C during speech: interrupt", flush=True)
    print("=" * 50, flush=True)

    fetch_config()

    # Start background threads
    threading.Thread(target=ping_loop, daemon=True).start()
    threading.Thread(target=heartbeat_monitor, daemon=True).start()
    for url in API_URLS:
        threading.Thread(target=sse_listener, args=(url,), daemon=True).start()
    threading.Thread(target=run_local_server, daemon=True).start()

    setup_hotkey()

    # Build system tray
    try:
        import pystray
        from PIL import Image

        icon_img = _build_icon()
        if icon_img is None:
            # Absolute minimal fallback
            icon_img = Image.new('RGB', (32, 32), color=(100, 30, 200))

        menu = pystray.Menu(
            pystray.MenuItem(lambda _: f"⬤  {_tray_status}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Logs",        lambda: _open_logs()),
            pystray.MenuItem("Restart Voice",    lambda: _restart_voice()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit Chronos Voice", lambda: _exit_daemon()),
        )

        _tray_icon = pystray.Icon(
            name="chronos_voice",
            icon=icon_img,
            title="Chronos Voice — Starting...",
            menu=menu,
        )

        _set_tray_status("Running")
        print("[Daemon] Tray icon active.", flush=True)
        _tray_icon.run()  # blocks until icon.stop() is called

    except ImportError:
        print("[Daemon] pystray/Pillow not installed. Running headless.", flush=True)
        _set_tray_status("Running (headless)")
        # Headless: just block the main thread
        while True:
            time.sleep(60)
    except Exception as tray_err:
        print(f"[Daemon] Tray error: {tray_err}. Running headless.", flush=True)
        while True:
            time.sleep(60)
