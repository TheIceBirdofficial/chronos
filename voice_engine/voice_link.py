import os
import sys
import time
import pickle
import threading
import hashlib
import urllib.parse
import requests
import numpy as np

# Set stdout encoding to utf-8 to prevent console encoding issues
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

# Ensure voice_engine and its parent are in PATH
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import sounddevice as sd
from openwakeword.utils import AudioFeatures
from faster_whisper import WhisperModel
from wakeword_utils import flatten_features

MODEL_PATH = Path(__file__).resolve().parent / "chronos_wakeword.pkl"
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"
FRAME_SIZE = 1280  # 80ms stride
WINDOW_FRAMES = 16

# Configurable Flask base URL via environment variable
FLASK_SERVER = os.environ.get("CHRONOS_API_URL", "http://127.0.0.1:5000").rstrip("/")
OLLAMA_SERVER = os.environ.get("OLLAMA_SERVER", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "gemma2:2b")

# Local Kokoro ONNX model path settings using user home directory dynamically
home_dir = Path.home()
default_model = home_dir / "kokoro_previews" / "kokoro-v1.0.onnx"
default_voices = home_dir / "kokoro_previews" / "voices-v1.0.bin"

KOKORO_MODEL_PATH = os.environ.get("KOKORO_MODEL_PATH", str(default_model))
KOKORO_VOICES_PATH = os.environ.get("KOKORO_VOICES_PATH", str(default_voices))

CACHE_DIR = Path(__file__).resolve().parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# State variables for TTS & Duplication prevention
kokoro = None
is_speaking_query = False

# Try importing soundfile and initializing Kokoro locally
try:
    from kokoro_onnx import Kokoro
    import soundfile as sf
    if os.path.exists(KOKORO_MODEL_PATH) and os.path.exists(KOKORO_VOICES_PATH):
        print(f"[Local TTS] Loading Kokoro engine from: {KOKORO_MODEL_PATH}")
        kokoro = Kokoro(KOKORO_MODEL_PATH, KOKORO_VOICES_PATH)
        print("[Local TTS] Kokoro engine initialized successfully.")
    else:
        print(f"[Local TTS Warning] Kokoro model files not found at: {KOKORO_MODEL_PATH}")
        print("Speech will be printed to console without audio synthesis.")
except Exception as e:
    print(f"[Local TTS Error] Failed to initialize local Kokoro engine: {e}")


def make_local_request(method, url, **kwargs):
    # Fully bypass system proxies to avoid issues when VPN/proxy is enabled
    session = requests.Session()
    session.trust_env = False
    kwargs['proxies'] = {}
    
    parsed = urllib.parse.urlparse(url)
    urls = []
    if parsed.netloc:
        host_port = parsed.netloc
        if ':' in host_port:
            host, port = host_port.rsplit(':', 1)
            port_suffix = f":{port}"
        else:
            host = host_port
            port_suffix = ""
            
        is_local = host.lower() in ('localhost', '127.0.0.1', '[::1]')
        if is_local:
            hosts = ['127.0.0.1', 'localhost', '[::1]']
            if host in hosts:
                hosts.remove(host)
                hosts.insert(0, host)
            for h in hosts:
                new_netloc = f"{h}{port_suffix}"
                new_url = parsed._replace(netloc=new_netloc).geturl()
                if new_url not in urls:
                    urls.append(new_url)
        else:
            urls.append(url)
    else:
        urls.append(url)
        
    last_err = None
    original_timeout = kwargs.get('timeout', 3)
    
    for u in urls:
        try:
            if isinstance(original_timeout, tuple):
                conn_timeout, read_timeout = original_timeout
            else:
                conn_timeout = min(original_timeout, 1.0) if len(urls) > 1 else original_timeout
                read_timeout = original_timeout
                
            kwargs['timeout'] = (conn_timeout, read_timeout)
                
            if method.upper() == 'GET':
                res = session.get(u, **kwargs)
            else:
                res = session.post(u, **kwargs)
            return res
        except Exception as e:
            last_err = e
            
    if last_err:
        raise last_err


def get_user_settings():
    db_file = PROJECT_ROOT / 'backend' / 'chronos.db'
    if db_file.exists():
        try:
            import sqlite3
            conn = sqlite3.connect(str(db_file))
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM settings WHERE id = 'active_operator'")
            row = cursor.fetchone()
            conn.close()
            if row:
                return dict(row)
        except Exception as e:
            print(f"[Voice Link SQLite load error] {e}")
            
    settings_file = PROJECT_ROOT / 'backend' / 'settings.json'
    if settings_file.exists():
        try:
            with open(settings_file, 'r') as f:
                import json
                return json.load(f)
        except Exception:
            pass
    return {"username": "user", "twinProfile": "", "sleepStart": 23, "sleepEnd": 7, "procrastinationRating": 8.0}


def broadcast_voice_event(status: str, text: str = "", **kwargs) -> None:
    """Send voice event data to Flask server to broadcast to frontend clients."""
    def _run():
        try:
            url = f"{FLASK_SERVER}/api/voice/trigger"
            payload = {"status": status, "text": text}
            payload.update(kwargs)
            make_local_request('POST', url, json=payload, timeout=2)
        except Exception as e:
            print(f"[Voice Link Error] Failed to broadcast event: {e}")
    threading.Thread(target=_run, daemon=True).start()


def ping_backend() -> None:
    """Send a periodic ping to the Flask server to report daemon status."""
    def _run():
        try:
            url = f"{FLASK_SERVER}/api/voice/ping"
            make_local_request('POST', url, json={}, timeout=1.5)
        except Exception:
            pass
    threading.Thread(target=_run, daemon=True).start()


def stop_backend_speech() -> None:
    """Stop Flask speech playback and clear its queue, setting state to listening."""
    def _run():
        try:
            url = f"{FLASK_SERVER}/api/voice/stop"
            payload = {"status": "listening", "text": "Listening..."}
            make_local_request('POST', url, json=payload, timeout=2)
        except Exception as e:
            print(f"[Voice Link Error] Failed to stop backend speech: {e}")
    threading.Thread(target=_run, daemon=True).start()


def speak_locally(text: str) -> None:
    """Synthesize and play speech locally using Kokoro ONNX."""
    clean_text = text.strip()
    if not clean_text:
        return
        
    print(f"[Local TTS] Speaking: '{clean_text}'")
    
    # Generate MD5 hash of text for caching
    clean_lower = clean_text.lower()
    text_hash = hashlib.md5(clean_lower.encode('utf-8')).hexdigest()
    cache_path = CACHE_DIR / f"{text_hash}.wav"
    
    # 1. Play from local cache if exists
    if cache_path.exists():
        try:
            import soundfile as sf
            data, sample_rate = sf.read(str(cache_path))
            sd.play(data, sample_rate)
            sd.wait()
            return
        except Exception as e:
            print(f"[Local Cache Playback Error] {e}")
            
    # 2. Synthesize locally using Kokoro
    if kokoro is not None:
        try:
            import soundfile as sf
            data, sample_rate = kokoro.create(clean_text, voice="af_bella", speed=1.15, lang="en-us")
            sf.write(str(cache_path), data, sample_rate)
            
            import numpy as np
            pad_len = int(sample_rate * 0.45)
            silence_padding = np.zeros(pad_len, dtype=data.dtype)
            padded_data = np.concatenate([data, silence_padding])
            
            sd.play(padded_data, sample_rate)
            sd.wait()
        except Exception as e:
            print(f"[Kokoro Synthesis Error] {e}")
    else:
        print(f"[Local TTS Offline] System response: '{clean_text}'")


def play_indicator_sound(sound_type: str) -> None:
    """Generate and play procedural 'ting' and 'tong' sound effects."""
    try:
        sample_rate = 16000
        if sound_type == "ting":
            duration = 0.25
            t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
            wave = np.sin(2 * np.pi * 880 * t) * np.exp(-t * 18.0)
            wave += 0.25 * np.sin(2 * np.pi * 1760 * t) * np.exp(-t * 22.0)
            audio = (wave / np.max(np.abs(wave)) * 0.15).astype(np.float32)
        elif sound_type == "tong":
            duration = 0.30
            t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
            wave = np.sin(2 * np.pi * 330 * t) * np.exp(-t * 10.0)
            wave += 0.2 * np.sin(2 * np.pi * 660 * t) * np.exp(-t * 15.0)
            audio = (wave / np.max(np.abs(wave)) * 0.12).astype(np.float32)
        else:
            return

        sd.play(audio, sample_rate)
        sd.wait()
    except Exception as e:
        print(f"[Indicator Sound Error] Failed to play {sound_type}: {e}")


def query_ai_assistant(query_text: str) -> str:
    """Query the AI assistant. Uses remote Flask server for Gemini, or queries local Ollama directly."""
    ai_provider = os.environ.get("CHRONOS_AI_PROVIDER", "gemini" if os.environ.get("GEMINI_API_KEY") else "ollama")
    
    # 1. Gemini flow via remote Flask endpoint
    if ai_provider == "gemini":
        try:
            url = f"{FLASK_SERVER}/api/voice/query"
            payload = {"query": query_text}
            res = make_local_request('POST', url, json=payload, timeout=15)
            if res.status_code == 200:
                return res.json().get("content", "").strip()
        except Exception as e:
            print(f"[Remote Voice Query Error] {e}")
            
    # 2. Ollama flow (runs locally on desktop to access localhost:11434 directly)
    else:
        try:
            settings = get_user_settings()
            username = settings.get("username", "operator")
            twin_profile = settings.get("twinProfile", "")
            
            # Fetch active tasks from remote Flask server to construct system prompt context
            tasks_info = ""
            try:
                res = make_local_request('GET', f"{FLASK_SERVER}/api/tasks", timeout=3)
                if res.status_code == 200:
                    tasks = res.json()
                    active_tasks = [t for t in tasks if not t.get('completed', False)]
                    if active_tasks:
                        tasks_info = " Active tasks: " + ", ".join([
                            f"'{t['title']}' (Score: {t['survivalScore']}%, due: {t.get('due')}, est hours: {t.get('estimatedHours')}h)"
                            for t in active_tasks
                        ]) + "."
            except Exception as e:
                print(f"[Ollama Context Sync Error] {e}")
                
            import datetime
            now_dt = datetime.datetime.now()
            time_context = now_dt.strftime("%A, %B %d, %Y, %I:%M %p")
            
            system_prompt = (
                f"You are Chronos, a tactical AI deadline defense system. The operator's name is {username}.\n"
                f"The current system date and time is {time_context}.\n"
                f"Keep your response strictly to 1 or 2 short sentences. Your tone is highly professional, focused, "
                f"and slightly urgent (like mission control).\n"
                f"You support task creation and simulation commands via special tags. If the user asks for one of these, you MUST append the exact tag at the end of your response:\n"
                f"1. Task Creation: If the user wants to add/create a task, estimate its duration (default 2.0 hours) and importance (default 'medium'), compute the deadline relative to the current time, and format: [CREATE_TASK: {{\"title\": \"Task Title\", \"due\": \"YYYY-MM-DDTHH:MM:SS\", \"estimatedHours\": X.Y, \"importance\": \"low|medium|high\"}}]\n"
                f"2. Advance/Simulate Time: [CMD: SIMULATE_TIME]\n"
                f"3. Simulate Collapse/Emergency Mode: [CMD: SIMULATE_COLLAPSE]\n"
                f"4. Evaluate Tasks/Pulse: [CMD: RUN_PULSE]\n"
                f"5. Rescue Task/Trigger Recovery: [CMD: RESCUE]\n"
            )
            if twin_profile:
                system_prompt += f" Consider the operator's digital twin profile: {twin_profile}."
            if tasks_info:
                system_prompt += f" Use this context if relevant:{tasks_info}"
                
            url = f"{OLLAMA_SERVER}/api/chat"
            model_name = OLLAMA_MODEL
            try:
                tag_res = make_local_request('GET', f"{OLLAMA_SERVER}/api/tags", timeout=2)
                if tag_res.status_code == 200:
                    models = [m["name"] for m in tag_res.json().get("models", [])]
                    if models:
                        model_name = models[0]
            except Exception:
                pass
                
            payload = {
                "model": model_name,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": query_text}
                ],
                "stream": False,
                "options": {"temperature": 0.5}
            }
            res = make_local_request('POST', url, json=payload, timeout=15)
            if res.status_code == 200:
                return res.json().get("message", {}).get("content", "").strip()
        except Exception as e:
            print(f"[Local Ollama Error] Query failed: {e}")
            
    # Local fallback responses if backend is unreachable
    query_lower = query_text.lower()
    settings = get_user_settings()
    username = settings.get("username", "operator")
    if "status" in query_lower or "how are you" in query_lower:
        return f"All local risk engines online, {username}. Observing timelines."
    return f"Tactical coordinator link offline, {username}. Focus metrics preserved."


def handle_dashboard_command(query_text: str) -> str | None:
    query_lower = query_text.lower()
    
    if any(k in query_lower for k in ["simulate time", "time passage", "advance time", "one hour"]):
        try:
            res = make_local_request('POST', f"{FLASK_SERVER}/api/tasks/simulate/time", json={}, timeout=5)
            if res.status_code == 200:
                return "Time passage simulation active. Deadlines advanced by one hour."
        except Exception as e:
            return f"Failed to simulate time: {e}"
            
    if any(k in query_lower for k in ["simulate collapse", "deadlines collapse", "emergency mode"]):
        try:
            res = make_local_request('POST', f"{FLASK_SERVER}/api/tasks/simulate/collapse", json={}, timeout=5)
            if res.status_code == 200:
                return "Warning! Deadline collapse sequence initiated. Critical alert broadcast active."
        except Exception as e:
            return f"Failed to simulate collapse: {e}"
            
    if any(k in query_lower for k in ["pulse", "evaluate tasks", "check risk"]):
        try:
            res = make_local_request('POST', f"{FLASK_SERVER}/api/tasks/pulse", json={}, timeout=5)
            if res.status_code == 200:
                return "Risk assessment engines refreshed. Focus levels recalculated."
        except Exception as e:
            return f"Failed to run pulse: {e}"
            
    if any(k in query_lower for k in ["rescue", "recovery", "activate recovery", "help me recover"]):
        try:
            res = make_local_request('GET', f"{FLASK_SERVER}/api/tasks", timeout=3)
            if res.status_code == 200:
                tasks = res.json()
                target_task = next((t for t in tasks if t.get("escalationLevel") in ["red", "black", "orange", "yellow"]), None)
                if not target_task and tasks:
                    target_task = tasks[0]
                
                if target_task:
                    tid = target_task["id"]
                    title = target_task.get("title", "Task")
                    rescue_res = make_local_request('POST', f"{FLASK_SERVER}/api/tasks/{tid}/rescue", json={}, timeout=5)
                    if rescue_res.status_code == 200:
                        return f"Recovery protocol applied to task: {title}. Success forecast updated."
                else:
                    return "No active tasks found in database to rescue."
        except Exception as e:
            return f"Failed to trigger rescue: {e}"

    return None


def start_sse_listener():
    """Connect to Flask SSE events and speak proactive warnings locally with auto-reconnection and backoff."""
    def _run():
        backoff = 2
        while True:
            try:
                url = f"{FLASK_SERVER}/api/voice/events"
                print(f"[SSE Client] Subscribing to event stream at {url}...", flush=True)
                
                session = requests.Session()
                session.trust_env = False
                
                headers = {"Accept": "text/event-stream"}
                response = session.get(url, headers=headers, stream=True, timeout=None)
                
                # Reset backoff on successful connection
                backoff = 2
                print("[SSE Client] Connected to Server-Sent Events stream.", flush=True)
                
                for line in response.iter_lines():
                    if line:
                        decoded = line.decode('utf-8')
                        if decoded.startswith("data:"):
                            try:
                                import json
                                payload = json.loads(decoded[5:].strip())
                                status = payload.get("status")
                                text = payload.get("text", "")
                                
                                # Speak proactive alerts from backend (e.g. speaking state)
                                if status == "speaking" and text:
                                    # Prevent double speech echo if Alt+C query is speaking
                                    if not is_speaking_query:
                                        print(f"[SSE Client] Spoken alert received: '{text}'")
                                        # Run locally on speakers asynchronously
                                        threading.Thread(target=speak_locally, args=(text,), daemon=True).start()
                            except Exception as parse_err:
                                print(f"[SSE Client Parser Error] {parse_err}", flush=True)
            except Exception as e:
                print(f"[SSE Connection Lost] {e}. Reconnecting in {backoff}s...", flush=True)
                time.sleep(backoff)
                backoff = min(backoff * 2, 30)
                
    threading.Thread(target=_run, daemon=True).start()


def run_voice_link() -> None:
    global is_speaking_query
    print("=" * 60)
    print("Chronos Voice Link Background Daemon (Hotkey Mode)")
    print("=" * 60)

    # Load faster-whisper model
    print("Loading Faster-Whisper transcribing model (small.en)...")
    whisper_model = WhisperModel("small.en", device="cpu", compute_type="int8")

    input_device = None
    try:
        default_input = sd.default.device[0]
        if default_input is not None:
            input_device = default_input
            info = sd.query_devices(input_device)
            print(f"Microphone: {info['name']}")
    except Exception as exc:
        print(f"Warning: Could not query audio devices: {exc}")

    latest_pcm = np.zeros(FRAME_SIZE, dtype=np.int16)
    new_data_available = False
    command_buffer = []
    is_recording_command = False

    def audio_callback(indata, frames, time_info, status):
        nonlocal latest_pcm, new_data_available, command_buffer, is_recording_command
        pcm = indata.flatten()
        if is_recording_command:
            command_buffer.append(pcm)
        else:
            latest_pcm = pcm
            new_data_available = True

    # Open continuous microphone input stream with callback
    stream = sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype=DTYPE,
        blocksize=FRAME_SIZE,
        device=input_device,
        callback=audio_callback
    )

    # Start background ping thread to report voice link daemon status
    def start_ping_loop():
        while True:
            ping_backend()
            time.sleep(10.0)

    hotkey_triggered = False

    def on_hotkey_pressed():
        nonlocal hotkey_triggered
        print("\n[HOTKEY DETECTED] Alt+C pressed!")
        try:
            res = make_local_request('GET', f"{FLASK_SERVER}/api/voice/status", timeout=2)
            if res.status_code == 200:
                data = res.json()
                if data.get("is_speaking", False):
                    print("[HOTKEY ACTION] System is speaking. Muting and stopping playback...")
                    make_local_request('POST', f"{FLASK_SERVER}/api/voice/stop", json={"status": "idle", "text": "Chronos Voice Link: Sync Active."}, timeout=2)
                    return
        except Exception as e:
            print(f"Error querying speaking status: {e}")
            
        print("[HOTKEY ACTION] Activating assistant...")
        hotkey_triggered = True

    # Register global hotkey
    try:
        import keyboard
        keyboard.add_hotkey('alt+c', on_hotkey_pressed)
        print("\n✅ Global hotkey 'Alt+C' registered in any window.")
    except Exception as e:
        print(f"\n⚠️ Keyboard hotkey listener registration failed ({e}).")
        print("Running in console stdin trigger fallback mode.")
        print("To trigger the assistant, type 'c' and press Enter in this terminal.")
        def console_listener():
            while True:
                try:
                    line = sys.stdin.readline().strip().lower()
                    if line == 'c' or line == '':
                        on_hotkey_pressed()
                except Exception:
                    time.sleep(1)
        threading.Thread(target=console_listener, daemon=True).start()
        
    print("-" * 60)
    threading.Thread(target=start_ping_loop, daemon=True).start()
    start_sse_listener()

    with stream:
        while True:
            try:
                if not hotkey_triggered:
                    time.sleep(0.02)
                    continue

                hotkey_triggered = False
                
                # Stop active backend speech immediately
                stop_backend_speech()
                
                # Play pleasant listening start bell
                play_indicator_sound("ting")
                
                # Record command audio with silence detection
                print("Recording command...", flush=True)
                broadcast_voice_event("listening", "Listening for command...")
                
                command_buffer = []
                is_recording_command = True
                
                silence_threshold = 250
                silence_frames_limit = 20  # ~1.6 seconds of silence (20 * 80ms)
                silence_counter = 0
                max_frames = 70  # Max ~5.6 seconds recording
                
                # Flush existing callback frames
                time.sleep(0.1)
                command_buffer.clear()
                
                while is_recording_command and len(command_buffer) < max_frames:
                    time.sleep(0.08)  # Monitor buffer every 80ms
                    
                    if len(command_buffer) > 0:
                        latest_chunk = command_buffer[-1]
                        max_amplitude = np.max(np.abs(latest_chunk))
                        if max_amplitude < silence_threshold:
                            silence_counter += 1
                        else:
                            silence_counter = 0
                            
                        if silence_counter >= silence_frames_limit:
                            print("Silence detected, cutting off recording.")
                            break
                
                is_recording_command = False
                
                # Play listening stop warm drop
                play_indicator_sound("tong")
                
                if not command_buffer:
                    continue
                audio_int16 = np.concatenate(command_buffer)
                audio_float32 = audio_int16.astype(np.float32) / 32768.0
                
                # Transcribe audio using Whisper
                print("Transcribing speech...", flush=True)
                broadcast_voice_event("thinking", "Transcribing...")
                
                segments, info = whisper_model.transcribe(audio_float32, beam_size=5)
                query = " ".join([seg.text for seg in segments]).strip()
                
                print(f"User Query: '{query}'")
                if not query or len(query) < 2:
                    print("Empty transcription. Aborting.")
                    broadcast_voice_event("idle", "Chronos Voice Link: Sync Active.")
                    continue
                    
                broadcast_voice_event("user_speech", query)
                
                # Query remote assistant
                response_text = None
                try:
                    response_text = query_ai_assistant(query)
                except Exception as e:
                    print(f"Query AI assistant failed: {e}")
                    
                is_fallback = False
                if not response_text or "Observing timelines" in response_text or "assistant active" in response_text:
                    is_fallback = True
                    
                if is_fallback:
                    local_response = handle_dashboard_command(query)
                    if local_response:
                        response_text = local_response
                if not response_text:
                    response_text = "Tactical communications channel offline. System active."

                # Parse command and task creation tags
                import re
                import json
                cmd_tag = None
                create_task_tags = []
                
                cmd_match = re.search(r'\[CMD:\s*(\w+)\]', response_text)
                if cmd_match:
                    cmd_tag = cmd_match.group(1)
                    response_text = re.sub(r'\[CMD:\s*\w+\]', '', response_text).strip()
                    
                task_matches = re.finditer(r'\[CREATE_TASK:\s*(\{[\s\S]*?\})\]', response_text)
                for m in task_matches:
                    create_task_tags.append(m.group(1))
                
                response_text = re.sub(r'\[CREATE_TASK:\s*\{[\s\S]*?\}\]', '', response_text).strip()

                # Execute simulation command if tag found
                if cmd_tag:
                    print(f"[Voice Link] Executing command tag: {cmd_tag}")
                    if cmd_tag == "SIMULATE_TIME":
                        try:
                            make_local_request('POST', f"{FLASK_SERVER}/api/tasks/simulate/time", json={}, timeout=5)
                        except Exception as e: print(f"CMD error: {e}")
                    elif cmd_tag == "SIMULATE_COLLAPSE":
                        try:
                            make_local_request('POST', f"{FLASK_SERVER}/api/tasks/simulate/collapse", json={}, timeout=5)
                        except Exception as e: print(f"CMD error: {e}")
                    elif cmd_tag == "RUN_PULSE":
                        try:
                            make_local_request('POST', f"{FLASK_SERVER}/api/tasks/pulse", json={}, timeout=5)
                        except Exception as e: print(f"CMD error: {e}")
                    elif cmd_tag == "RESCUE":
                        try:
                            res = make_local_request('GET', f"{FLASK_SERVER}/api/tasks", timeout=3)
                            if res.status_code == 200:
                                tasks = res.json()
                                target_task = next((t for t in tasks if t.get("escalationLevel") in ["red", "black", "orange", "yellow"]), None)
                                if not target_task and tasks:
                                    target_task = tasks[0]
                                if target_task:
                                    make_local_request('POST', f"{FLASK_SERVER}/api/tasks/{target_task['id']}/rescue", json={}, timeout=5)
                        except Exception as e: print(f"CMD error: {e}")

                # Execute task creations if tags found
                for tag in create_task_tags:
                    print(f"[Voice Link] Executing task creation tag: {tag}")
                    try:
                        twin_profile = ""
                        try:
                            settings = get_user_settings()
                            twin_profile = settings.get("twinProfile", "")
                        except Exception: pass
                        
                        task_data = json.loads(tag)
                        res = make_local_request('POST', f"{FLASK_SERVER}/api/tasks", json={
                            'title': task_data.get('title', 'Untitled Deadline'),
                            'due': task_data.get('due'),
                            'estimatedHours': float(task_data.get('estimatedHours', 2.0)),
                            'importance': task_data.get('importance', 'medium'),
                            'twinProfile': twin_profile
                        }, timeout=5)
                        if res.status_code == 201:
                            broadcast_voice_event("reload_tasks")
                            broadcast_voice_event("redirect", target="/dashboard")
                    except Exception as e:
                        print(f"[Voice Link Error] Failed to create task: {e}")

                # Play response locally on speakers
                print(f"Chronos response: '{response_text}'")
                is_speaking_query = True
                speak_locally(response_text)
                is_speaking_query = False
                print("Ready for next command.\n")
                
            except Exception as e:
                print(f"[Error in Link Loop] {e}")
                time.sleep(0.1)


if __name__ == "__main__":
    run_voice_link()
