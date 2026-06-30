from flask import Flask, jsonify, request, send_from_directory, Response, redirect, g
from flask_cors import CORS
import os
import requests
import sqlite3

# ── GCS Persistence (data survives container restarts) ─────────────────
GCS_BUCKET = os.environ.get('GCS_BUCKET_NAME', '')
_gcs_available = False
if GCS_BUCKET:
    try:
        from google.cloud import storage
        _gcs_client = storage.Client()
        _gcs_bucket = _gcs_client.bucket(GCS_BUCKET)
        _gcs_available = True
        print(f"[GCS] Backup bucket configured: {GCS_BUCKET}", flush=True)
    except Exception as e:
        print(f"[GCS] Not available (non-fatal): {e}", flush=True)

def _gcs_restore():
    if not _gcs_available:
        return
    for fname in ('chronos.db', 'settings.json', 'google_tokens.json', 'interventions.json'):
        local_path = os.path.join(os.path.dirname(__file__), fname)
        if os.path.exists(local_path):
            continue  # already have local data
        try:
            blob = _gcs_bucket.blob(f'chronos_backup/{fname}')
            if blob.exists():
                blob.download_to_filename(local_path)
                print(f"[GCS] Restored {fname} from backup.", flush=True)
        except Exception as e:
            print(f"[GCS] Could not restore {fname}: {e}", flush=True)

def _gcs_backup():
    if not _gcs_available:
        return
    for fname in ('chronos.db', 'settings.json', 'google_tokens.json', 'interventions.json'):
        local_path = os.path.join(os.path.dirname(__file__), fname)
        if os.path.exists(local_path):
            try:
                blob = _gcs_bucket.blob(f'chronos_backup/{fname}')
                blob.upload_from_filename(local_path)
            except Exception as e:
                print(f"[GCS] Backup failed for {fname}: {e}", flush=True)
    print("[GCS] Backup cycle complete.", flush=True)

def _gcs_backup_async():
    if not _gcs_available:
        return
    threading.Thread(target=_gcs_backup, daemon=True).start()

# Restore on startup
_gcs_restore()

def make_local_request(method, url, **kwargs):
    import urllib.parse
    import requests
    
    # Fully bypass system proxies to avoid issues when VPN/proxy is enabled
    session = requests.Session()
    session.trust_env = False
    kwargs['proxies'] = {}
    
    headers = kwargs.get('headers', {})
    headers['ngrok-skip-browser-warning'] = '69420'
    kwargs['headers'] = headers
    
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
            # Try 127.0.0.1 first, then localhost, then [::1] (IPv6)
            hosts = ['127.0.0.1', 'localhost', '[::1]']
            # Put the original host first to honor whatever is passed
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
            # Separate connection timeout from read timeout.
            # Fail fast on connection (1.0s limit), but allow full original duration for reading/generating response.
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
            print(f"[DEBUG LOCAL REQUEST ERROR] method={method}, url={u}, error={e}", flush=True)
            
    if last_err:
        raise last_err
import json
import datetime
import uuid
import queue
import hashlib
import threading
import time

def parse_iso_to_local_naive(iso_str):
    if not iso_str:
        return datetime.datetime.now()
    try:
        iso_clean = iso_str.replace('Z', '+00:00')
        dt = datetime.datetime.fromisoformat(iso_clean)
        if dt.tzinfo is not None:
            # Convert to local system timezone (astimezone(None))
            dt = dt.astimezone(None)
            dt = dt.replace(tzinfo=None)
        return dt
    except Exception:
        # Fallback to naive stripping of Z/offsets
        try:
            t_parts = iso_str.split('T')
            if len(t_parts) == 2:
                time_part = t_parts[1].replace('Z', '')
                if '+' in time_part:
                    time_part = time_part.split('+')[0]
                elif '-' in time_part:
                    # check if the minus is the timezone offset
                    # e.g., 12:00:00-05:00 vs 12:00:00.123
                    parts = time_part.split('-')
                    if len(parts) > 1 and len(parts[-1]) == 5 and ':' in parts[-1]:
                        time_part = '-'.join(parts[:-1])
                dt = datetime.datetime.fromisoformat(f"{t_parts[0]}T{time_part}")
                return dt
        except Exception:
            pass
        return datetime.datetime.now()

from memory_engine import (
    init_memory_table, get_memory, upsert_memory, delete_memory,
    get_timeline, ingest_timeline_event, get_memory_summary,
    LAYER_IDENTITY, LAYER_TWIN_PROFILE, LAYER_BEHAVIOR_MEMORY,
    LAYER_MISSION_MEMORY, LAYER_CONVERSATION_MEMORY,
    LAYER_REFERENCE_MEMORY, LAYER_TIMELINE_MEMORY, ALL_LAYERS
)

# Global Server-Sent Events (SSE) client list for voice telemetry
voice_clients = []
voice_clients_lock = threading.Lock()

speech_queue = queue.Queue()
last_voice_link_ping = 0.0
voice_muted = False
voice_muted_until = 0.0
is_speaking = False
is_speaking_lock = threading.Lock()
voice_conversation_history = []
active_sprints = {}
active_sprints_lock = threading.Lock()

INTERVENTIONS_FILE = os.path.join(os.path.dirname(__file__), 'interventions.json')
last_voice_event_speak_time = 0.0

# ── Proactive Monitor State ─────────────────────────────────────────────
# Tracks what the monitor has already said to avoid repetition
_proactive_spoken_hashes: set = set()       # hashes of recently spoken messages
_proactive_last_spoken: float = 0.0         # wall-clock time of last proactive speech
_proactive_last_task_snapshot: dict = {}    # task_id → {score, escalation, cp_count} at last check
_proactive_last_check: float = 0.0          # last time we evaluated state
_proactive_recent_spoken: list = []         # rolling log of recent spoken messages
_proactive_rejected: list = []              # topics recently rejected / ignored by operator (max 20)


def load_interventions():
    if not os.path.exists(INTERVENTIONS_FILE):
        return {"totals": {"interventions": 0, "successes": 0, "ignored": 0}, "log": []}
    try:
        with open(INTERVENTIONS_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {"totals": {"interventions": 0, "successes": 0, "ignored": 0}, "log": []}

def save_interventions(data):
    try:
        with open(INTERVENTIONS_FILE, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving interventions: {e}")

def record_intervention(event_type, task_id, survival_score, confidence, expected_imp, actions_taken, spoken_text):
    data = load_interventions()
    data['totals']['interventions'] = data['totals'].get('interventions', 0) + 1
    new_entry = {
        "timestamp": datetime.datetime.now().isoformat(),
        "event_type": event_type,
        "task_id": task_id,
        "survival_score": survival_score,
        "confidence": confidence,
        "expected_imp": expected_imp,
        "actions_taken": actions_taken,
        "spoken_text": spoken_text,
        "status": "pending"
    }
    data['log'].append(new_entry)
    save_interventions(data)
    return new_entry

def update_intervention_status(task_id, new_status="success"):
    data = load_interventions()
    updated = False
    for entry in reversed(data.get('log', [])):
        if entry.get('task_id') == task_id and entry.get('status') == 'pending':
            try:
                dt = datetime.datetime.fromisoformat(entry['timestamp'])
                if (datetime.datetime.now() - dt).total_seconds() < 3600.0:
                    entry['status'] = new_status
                    if new_status == 'success':
                        data['totals']['successes'] = data['totals'].get('successes', 0) + 1
                    else:
                        data['totals']['ignored'] = data['totals'].get('ignored', 0) + 1
                    updated = True
                    break
            except Exception:
                pass
    if updated:
        save_interventions(data)

def check_ignored_interventions():
    data = load_interventions()
    updated = False
    now = datetime.datetime.now()
    for entry in data.get('log', []):
        if entry.get('status') == 'pending':
            try:
                dt = datetime.datetime.fromisoformat(entry['timestamp'])
                if (now - dt).total_seconds() >= 3600.0:
                    entry['status'] = 'ignored'
                    data['totals']['ignored'] = data['totals'].get('ignored', 0) + 1
                    updated = True
            except Exception:
                pass
    if updated:
        save_interventions(data)

def count_completed_checkpoints(task):
    timeline = task.get('timeline', [])
    count = 0
    for milestone in timeline:
        cps = milestone.get('checkpoints', []) if isinstance(milestone, dict) else []
        for cp in cps:
            if cp.get('status') == 'completed' or cp.get('completed', False):
                count += 1
    return count

def evaluate_task_state_voice_events(prev, current):
    try:
        check_ignored_interventions()
        
        tid = current['id']
        title = current.get('title', 'Task')
        prev_completed = count_completed_checkpoints(prev)
        curr_completed = count_completed_checkpoints(current)
        prev_score = prev.get('survivalScore', 100)
        curr_score = current.get('survivalScore', 100)
        prev_rescue = prev.get('recoveryActive', False)
        curr_rescue = current.get('recoveryActive', False)
        prev_is_completed = prev.get('completed', False)
        curr_is_completed = current.get('completed', False)
        
        global last_voice_event_speak_time
        now_ts = time.time()
        cooldown_ok = (now_ts - last_voice_event_speak_time) > 300.0
        
        # 1. MISSION_DEBRIEF (Completed task completion)
        if curr_is_completed and not prev_is_completed:
            update_intervention_status(tid, 'success')
            due_str = current.get('due')
            hours_ahead = 0
            if due_str:
                due_dt = parse_iso_to_local_naive(due_str)
                hours_ahead = int((due_dt - datetime.datetime.now()).total_seconds() / 3600.0)
            hours_ahead = max(0, hours_ahead)
            stats = load_interventions()
            total_interventions = stats['totals'].get('interventions', 1)
            total_successes = stats['totals'].get('successes', 1)
            consistency = int((total_successes / max(1, total_interventions)) * 100)
            
            speech_text = f"Mission accomplished, operator. You finished {hours_ahead} hours before the deadline. Your completion consistency is {consistency} percent. Excellent work."
            if cooldown_ok:
                speech_queue.put(speech_text)
                last_voice_event_speak_time = now_ts
                
            events = current.get('events', [])
            events.append({
                "timestamp": datetime.datetime.now().isoformat(),
                "agent": "Chronos Executive Advisor",
                "type": "debrief",
                "message": speech_text
            })
            current['events'] = events
            return

        # 2. CHECKPOINT_MOMENTUM
        if curr_completed - prev_completed >= 3 and not curr_is_completed:
            update_intervention_status(tid, 'success')
            expected_imp = min(40, (curr_completed - prev_completed) * 6)
            speech_text = f"Excellent momentum. Securing three checkpoints recovered estimated {expected_imp} percent survival capacity."
            if cooldown_ok:
                speech_queue.put(speech_text)
                last_voice_event_speak_time = now_ts
                
            events = current.get('events', [])
            events.append({
                "timestamp": datetime.datetime.now().isoformat(),
                "agent": "Chronos Executive Advisor",
                "type": "momentum",
                "message": speech_text
            })
            current['events'] = events
            return

        # 3. RECOVERY_GENERATED
        if curr_rescue and not prev_rescue:
            speech_text = f"Active recovery plan generated. Today's timeline has been rebuilt to defend your recovery windows."
            if cooldown_ok:
                speech_queue.put(speech_text)
                last_voice_event_speak_time = now_ts
                
            events = current.get('events', [])
            events.append({
                "timestamp": datetime.datetime.now().isoformat(),
                "agent": "Chronos Executive Advisor",
                "type": "intervention",
                "message": speech_text,
                "reason": "Recovery forecast initialized after task risk escalation.",
                "survivalScore": curr_score,
                "confidence": 93,
                "expectedImprovement": 28,
                "actionsTaken": ["Timeline rebuilt", "Sleep Defended", "Rescue Active"]
            })
            current['events'] = events
            record_intervention("RECOVERY_GENERATED", tid, curr_score, 93, 28, ["Timeline rebuilt", "Sleep Defended"], speech_text)
            return

        # 4. SURVIVAL_RECOVERY
        if curr_score - prev_score >= 8 and not curr_is_completed:
            update_intervention_status(tid, 'success')
            speech_text = f"Timeline trajectory corrected. Survival projection on task '{title}' improved by {int(curr_score - prev_score)} percent."
            if cooldown_ok:
                speech_queue.put(speech_text)
                last_voice_event_speak_time = now_ts
                
            events = current.get('events', [])
            events.append({
                "timestamp": datetime.datetime.now().isoformat(),
                "agent": "Chronos Executive Advisor",
                "type": "recovery",
                "message": speech_text
            })
            current['events'] = events
            return

        # 5. SURVIVAL_COLLAPSE
        if prev_score - curr_score > 10 and not curr_is_completed:
            # Parse warningCount from category dict
            cat_str = current.get('category', '')
            cat = {}
            if cat_str:
                try:
                    cat = json.loads(cat_str)
                    if not isinstance(cat, dict): cat = {}
                except Exception: pass
            w_count = cat.get('warningCount', 0) + 1
            cat['warningCount'] = w_count
            current['category'] = json.dumps(cat)
            
            risk = current.get('riskAnalysis', {})
            work_rem = risk.get('workRemaining', 3.0)
            
            if w_count == 1:
                speech_text = f"Operational alert. You are beginning to fall behind on '{title}'."
            elif w_count == 2:
                speech_text = f"Warning. The schedule for '{title}' is becoming compressed. Work remaining is {int(work_rem)} hours."
            elif w_count == 3:
                speech_text = f"Assertive alert. Immediate focused action is now recommended on '{title}'."
            else:
                speech_text = f"Critical risk. Your estimated work exceeds remaining productive hours. Completing a milestone immediately is required."

            if cooldown_ok:
                speech_queue.put(speech_text)
                last_voice_event_speak_time = now_ts
                
            events = current.get('events', [])
            events.append({
                "timestamp": datetime.datetime.now().isoformat(),
                "agent": "Chronos Executive Advisor",
                "type": "intervention",
                "message": speech_text,
                "reason": f"Survival probability dropped from {prev_score}% to {curr_score}%. Work exceeds productive hours.",
                "survivalScore": curr_score,
                "confidence": 91,
                "expectedImprovement": 22,
                "actionsTaken": ["Priority Elevated", "Voice Warning Issued"]
            })
            current['events'] = events
            record_intervention("SURVIVAL_COLLAPSE", tid, curr_score, 91, 22, ["Priority Elevated", "Voice Warning Issued"], speech_text)
            return

    except Exception as e:
        print(f"Error in evaluate_task_state_voice_events: {e}")

def broadcast_status(status, text=""):
    payload = {"status": status, "text": text}
    with voice_clients_lock:
        for q in list(voice_clients):
            try:
                q.put(payload)
            except Exception:
                pass

notification_cooldowns = {}

def send_phone_notification(title, message):
    global notification_cooldowns
    now = time.time()
    stale = [k for k, v in notification_cooldowns.items() if now - v >= 300.0]
    for k in stale:
        del notification_cooldowns[k]
    
    # Check cooldown by title key prefix
    key = title[:25]
    if key in notification_cooldowns:
        elapsed = now - notification_cooldowns[key]
        if elapsed < 300.0:
            print(f"[Phone Notification Throttled] Cooldown active for '{key}' ({int(300 - elapsed)}s remaining).")
            return
            
    notification_cooldowns[key] = now

    def _run():
        settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
        topic = "chronos-alerts-user"
        if os.path.exists(settings_file):
            try:
                with open(settings_file, 'r') as f:
                    cfg = json.load(f)
                    topic = cfg.get('ntfyTopic', topic)
            except Exception:
                pass
        if not topic:
            return
        url = f"https://ntfy.sh/{topic}"
        headers = {
            "Title": title,
            "Priority": "high",
            "Tags": "warning,alarm_clock"
        }
        try:
            session = requests.Session()
            session.trust_env = False
            session.post(url, data=message.encode('utf-8'), headers=headers, proxies={}, timeout=5)
            print(f"[Phone Notification] Sent successfully to topic '{topic}': {title} - {message}")
        except Exception as e:
            print(f"[Phone Notification Error] Failed to send push to '{topic}': {e}")
            
    threading.Thread(target=_run, daemon=True).start()

def _proactive_should_speak(text: str, min_silence_s: float) -> bool:
    """Return True only if this message is novel, non-repetitive, and enough time has passed."""
    global _proactive_last_spoken, _proactive_spoken_hashes
    now = time.time()
    if now - _proactive_last_spoken < min_silence_s:
        return False
    # Hash first ~80 chars to catch rephrased-but-same-topic messages
    h = hashlib.md5(text[:80].lower().encode()).hexdigest()
    if h in _proactive_spoken_hashes:
        return False
    # Keep the hash set bounded
    if len(_proactive_spoken_hashes) > 60:
        _proactive_spoken_hashes.clear()
    _proactive_spoken_hashes.add(h)
    _proactive_last_spoken = now
    return True


def _proactive_queue(text: str, min_silence_s: float = 300.0) -> bool:
    """Enqueue a proactive speech item if checks pass and voice is not muted."""
    if not text:
        return False
    if voice_muted and time.time() < voice_muted_until:
        return False
    if _proactive_should_speak(text, min_silence_s):
        speech_queue.put(text)
        return True
    return False


import hashlib as _hashlib_mod  # noqa: E402 — already imported but aliased for clarity


def _run_proactive_monitor():
    """
    Background thread: Adaptive Proactive Monitor.

    Evaluates operator risk state and decides whether to speak.
    Cadence is determined by risk level — not fixed intervals.

    Risk levels → silence floors:
      LOW      (score ≥ 80, green)   → check every 10 min, speak floor 30 min
      MEDIUM   (score 50-79, yellow) → check every 5 min,  speak floor 12 min
      HIGH     (score 25-49, orange) → check every 3 min,  speak floor 7 min
      CRITICAL (score < 25, red/black)→ check every 90s,   speak floor 4 min
    """
    global _proactive_last_task_snapshot, _proactive_last_check, _proactive_recent_spoken

    import hashlib
    import datetime as _dt

    # Give the server 20s to fully start before first check
    time.sleep(20)

    while True:
        try:
            now = time.time()

            # ── 1. Load all tasks for *all* users (monitor runs server-wide) ──
            try:
                conn = get_db_conn()
                conn.row_factory = sqlite3.Row
                cur = conn.cursor()
                cur.execute("SELECT * FROM tasks WHERE completed = 0")
                rows = cur.fetchall()
                conn.close()
            except Exception as db_err:
                print(f"[ProactiveMonitor] DB read error: {db_err}", flush=True)
                time.sleep(60)
                continue

            active_tasks = []
            for row in rows:
                t = dict(row)
                try:
                    t['timeline'] = json.loads(t['timeline']) if t.get('timeline') else []
                except Exception:
                    t['timeline'] = []
                active_tasks.append(t)

            if not active_tasks:
                time.sleep(120)
                continue

            # ── 2. Determine highest-risk task ──────────────────────────────
            def _score(t):
                return t.get('survivalScore', 100) or 100

            worst = min(active_tasks, key=_score)
            worst_score = _score(worst)
            worst_title = worst.get('title', 'your task')
            worst_id = str(worst.get('id', ''))
            worst_escalation = worst.get('escalationLevel', 'green')
            worst_due = worst.get('due', '')

            # Hours until deadline
            hours_left = None
            if worst_due:
                try:
                    due_dt = datetime.datetime.fromisoformat(
                        worst_due.replace('Z', '+00:00')
                    ).replace(tzinfo=None)
                    hours_left = (due_dt - datetime.datetime.now()).total_seconds() / 3600.0
                except Exception:
                    pass

            # ── 3. Pick cadence based on risk ──────────────────────────────
            if worst_score >= 80 or worst_escalation == 'green':
                check_interval = 600        # 10 min
                speak_floor    = 1800       # 30 min minimum silence
                risk_label     = 'LOW'
            elif worst_score >= 50 or worst_escalation == 'yellow':
                check_interval = 300        # 5 min
                speak_floor    = 720        # 12 min
                risk_label     = 'MEDIUM'
            elif worst_score >= 25 or worst_escalation == 'orange':
                check_interval = 180        # 3 min
                speak_floor    = 420        # 7 min
                risk_label     = 'HIGH'
            else:
                check_interval = 90         # 90 s
                speak_floor    = 240        # 4 min
                risk_label     = 'CRITICAL'

            # Respect cadence — don't evaluate more often than check_interval
            if now - _proactive_last_check < check_interval:
                time.sleep(10)
                continue
            _proactive_last_check = now

            print(
                f"[ProactiveMonitor] Evaluating — Risk: {risk_label}, "
                f"Worst task: '{worst_title}' ({worst_score}%)",
                flush=True
            )

            # ── 4. Snapshot delta — what changed since last check? ──────────
            prev_snap = _proactive_last_task_snapshot.get(worst_id, {})
            prev_score = prev_snap.get('score', worst_score)
            prev_cp    = prev_snap.get('cp_count', 0)

            curr_cp = sum(
                1 for m in (worst.get('timeline') or [])
                for cp in (m.get('checkpoints', []) if isinstance(m, dict) else [])
                if cp.get('status') == 'completed' or cp.get('completed', False)
            )

            _proactive_last_task_snapshot[worst_id] = {
                'score': worst_score,
                'escalation': worst_escalation,
                'cp_count': curr_cp,
                'checked_at': now,
            }

            # ── 5. Generate intervention if warranted ──────────────────────
            spoken = False

            # Gather active sprint info
            user_id = worst.get('user_id', 'anonymous')
            with active_sprints_lock:
                sprint = active_sprints.get(user_id, {"active": False})
            
            sprint_info = "None"
            if sprint.get("active"):
                status_str = "PAUSED" if sprint.get("paused") else "ACTIVE"
                mins_left = int(sprint.get("seconds_left", 0) / 60)
                sprint_info = f"Focused Pomodoro session is currently {status_str} with {mins_left} minutes remaining."

            # Get user twin profile settings
            twin_profile = ""
            try:
                conn = get_db_conn()
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT twinProfile FROM settings WHERE user_id = ? LIMIT 1", (user_id,))
                row = cursor.fetchone()
                if row:
                    twin_profile = row['twinProfile']
                conn.close()
            except Exception:
                pass

            # Gather calendar info
            calendar_info = "No upcoming calendar events / meetings."
            try:
                events = get_google_calendar_events()
                if events:
                    gcal_list = []
                    for ev in events[:3]:
                        summary = ev.get('summary', 'Meeting')
                        start = ev.get('start', {}).get('dateTime') or ev.get('start', {}).get('date', '')
                        gcal_list.append(f"'{summary}' scheduled at {start}")
                    calendar_info = "; ".join(gcal_list)
            except Exception:
                pass

            # Get timeline & checkpoints info
            total_cps = 0
            completed_cps = 0
            for m in (worst.get('timeline') or []):
                if isinstance(m, dict):
                    for cp in m.get('checkpoints', []):
                        total_cps += 1
                        if cp.get('status') == 'completed' or cp.get('completed', False):
                            completed_cps += 1
            
            recent_spoken_str = "None"
            if _proactive_recent_spoken:
                recent_spoken_str = " | ".join(_proactive_recent_spoken)

            ai_config = get_ai_config_from_db()
            
            # Query AI to make the proactive speaking decision
            if ai_config and ai_config.get('apiKey'):
                try:
                    prompt = (
                        f"You are Chronos Ops, the tactical AI deadline defense system.\n"
                        f"Evaluate the operator's current telemetry to decide whether a proactive spoken operations briefing or warning is useful.\n\n"
                        f"Current Telemetry:\n"
                        f"- Twin Profile: {twin_profile}\n"
                        f"- Highest-Risk Task: '{worst_title}'\n"
                        f"  - Importance: {worst_escalation.upper()} / {worst.get('importance', 'medium').upper()}\n"
                        f"  - Survival Probability: {worst_score}%\n"
                        f"  - Escalation Level: {worst_escalation.upper()}\n"
                        f"  - Time remaining to deadline: {hours_left:.1f} hours\n"
                        f"  - Progress: {completed_cps} of {total_cps} checkpoints completed.\n"
                        f"  - Recovery Active: {worst.get('recoveryActive', False)} (Progress: {worst.get('recoveryProgress', 0.0)*100:.1f}%)\n"
                        f"- Active Pomodoro Sprint: {sprint_info}\n"
                        f"- Calendar context: {calendar_info}\n"
                        f"- Recent briefings you spoke: {recent_spoken_str}\n\n"
                        f"Rules for Intervention:\n"
                        f"1. Silence is preferred. Only intervene if the risk level is MEDIUM or higher (survival < 80%) AND there is a clear trigger: deadline compression, prolonged inactivity, a stalled sprint, ignored recovery, or key trajectory change.\n"
                        f"2. If no check-in/intervention is needed right now, reply with EXACTLY 'SILENT' and nothing else.\n"
                        f"3. If an intervention is needed, reply with a calm, professional, reassuring operations update (max 2 sentences, 35 words). Speak directly to the operator.\n"
                        f"4. NEVER use generic motivational catchphrases ('Keep working', 'Don't procrastinate', 'You can do it'). Instead, provide specific analytical observations.\n"
                        f"5. NEVER fabricate or hallucinate any facts. Only speak using the facts above.\n"
                        f"6. Do NOT mention or repeat any of your recent updates: {recent_spoken_str}."
                    )
                    
                    response = query_ai_direct(
                        ai_config.get('provider', 'gemini'),
                        ai_config.get('apiUrl'),
                        ai_config.get('apiKey'),
                        ai_config.get('model'),
                        [{"role": "user", "content": prompt}],
                        timeout=12
                    )
                    
                    if response:
                        ai_text = response.strip()
                        if ai_text and ai_text.upper() != "SILENT" and not ai_text.startswith("SILENT"):
                            # Filter out any weird markdown formatting
                            ai_text = ai_text.replace("**", "").replace("`", "").replace("Chronos Ops:", "").strip()
                            # Queue it!
                            spoken = _proactive_queue(ai_text, speak_floor)
                            if spoken:
                                # Update recent spoken memory
                                _proactive_recent_spoken.append(ai_text)
                                if len(_proactive_recent_spoken) > 5:
                                    _proactive_recent_spoken.pop(0)
                                print(f"[ProactiveMonitor] AI decided to speak: '{ai_text}'", flush=True)
                except Exception as ai_err:
                    print(f"[ProactiveMonitor] AI-driven decision failed: {ai_err}. Falling back to rules.", flush=True)

            # Fallback to rules if AI is offline, failed, or chose not to speak but rules dictate check-in
            if not spoken:
                # 5a. Deadline imminent and critical
                if (
                    not spoken
                    and hours_left is not None
                    and hours_left <= 2.0
                    and hours_left > 0
                    and worst_score < 40
                ):
                    mins_left = int(hours_left * 60)
                    text = (
                        f"Attention. '{worst_title}' has approximately {mins_left} minutes "
                        f"remaining and a survival score of {worst_score} percent. "
                        f"Immediate focused effort is required."
                    )
                    spoken = _proactive_queue(text, speak_floor)

                # 5b. Score dropped sharply since last check (rapid deterioration)
                if (
                    not spoken
                    and prev_score - worst_score >= 12
                    and not (prev_score == worst_score)
                ):
                    drop = int(prev_score - worst_score)
                    text = (
                        f"Risk alert. The survival probability for '{worst_title}' "
                        f"dropped {drop} points since the last assessment. "
                        f"Current score is {worst_score} percent."
                    )
                    spoken = _proactive_queue(text, speak_floor)

                # 5c. No checkpoint progress on a critical task
                if (
                    not spoken
                    and curr_cp == prev_cp
                    and worst_score < 45
                    and risk_label in ('HIGH', 'CRITICAL')
                    and (now - prev_snap.get('checked_at', now - 9999)) > speak_floor
                ):
                    total_cps = sum(
                        len(m.get('checkpoints', []))
                        for m in (worst.get('timeline') or [])
                        if isinstance(m, dict)
                    )
                    if total_cps > 0:
                        text = (
                            f"No checkpoint progress has been recorded for '{worst_title}'. "
                            f"{curr_cp} of {total_cps} steps completed. "
                            f"Resuming work now would improve the survival estimate."
                        )
                        spoken = _proactive_queue(text, speak_floor)

                # 5d. Deadline within 4 hours with medium+ risk (heads-up)
                if (
                    not spoken
                    and hours_left is not None
                    and 2.0 < hours_left <= 4.0
                    and worst_score < 60
                ):
                    text = (
                        f"'{worst_title}' is due in approximately {int(hours_left)} hours "
                        f"with a survival score of {worst_score} percent. "
                        f"Consider reviewing the recovery checklist."
                    )
                    spoken = _proactive_queue(text, speak_floor)

                # 5e. Multiple high-risk tasks
                if not spoken:
                    critical_tasks = [
                        t for t in active_tasks
                        if (t.get('survivalScore') or 100) < 35
                    ]
                    if len(critical_tasks) >= 2:
                        titles = " and ".join(f"'{t['title']}'" for t in critical_tasks[:2])
                        text = (
                            f"You currently have {len(critical_tasks)} tasks below "
                            f"35 percent survival probability, including {titles}. "
                            f"Prioritising the most urgent is recommended."
                        )
                        spoken = _proactive_queue(text, speak_floor)

            if spoken:
                print(f"[ProactiveMonitor] Intervention queued (risk={risk_label}).", flush=True)

        except Exception as monitor_err:
            print(f"[ProactiveMonitor] Unexpected error: {monitor_err}", flush=True)

        time.sleep(10)


# Start the proactive monitoring thread
_proactive_thread = threading.Thread(target=_run_proactive_monitor, daemon=True, name="ProactiveMonitor")
_proactive_thread.start()
print("[ProactiveMonitor] Adaptive intervention monitor started.", flush=True)


def speech_worker():

    global is_speaking
    while True:
        try:
            text = speech_queue.get()
            if text is None:
                with is_speaking_lock:
                    is_speaking = False
                break
            
            with is_speaking_lock:
                is_speaking = True
            print(f"[Headless Voice Coordinator] Broadcasting speech: '{text}'", flush=True)
            broadcast_status("speaking", text)
            
            # Pacing: ~12 chars per second + 0.5s buffer
            speak_duration = max(1.5, len(text) * 0.08)
            time.sleep(speak_duration)
            
            with is_speaking_lock:
                is_speaking = False
            speech_queue.task_done()
            
            if speech_queue.empty():
                broadcast_status("idle", "Chronos Voice Link: Sync Active.")
        except Exception as e:
            with is_speaking_lock:
                is_speaking = False
            print(f"[Speech Worker Error] {e}", flush=True)
            time.sleep(0.1)

# Start the headless speech worker thread
worker_thread = threading.Thread(target=speech_worker, daemon=True)
worker_thread.start()
print("[Headless Voice Coordinator] Speech worker thread active.")

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app, supports_credentials=True)

@app.before_request
def set_user_id():
    uid = request.headers.get('X-User-Id', '').strip()
    g.user_id = uid if uid else 'anonymous'
    if not g.user_id:
        g.user_id = 'anonymous'
    print(f"[DEBUG set_user_id] path={request.path}, method={request.method}, X-User-Id={uid}, resolved={g.user_id}", flush=True)

# Persistent Database File path (SQLite)
SQLITE_DB = os.environ.get("SQLITE_DB_PATH", os.path.join(os.path.dirname(__file__), 'chronos.db'))

def get_db_conn():
    conn = sqlite3.connect(SQLITE_DB, timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn

def init_sqlite_db():
    conn = get_db_conn()
    cursor = conn.cursor()
    
    # Settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        id TEXT,
        user_id TEXT DEFAULT 'anonymous',
        username TEXT,
        sleepStart INTEGER,
        sleepEnd INTEGER,
        ntfyTopic TEXT,
        twinProfile TEXT,
        procrastinationRating REAL,
        attentionCycle TEXT,
        stressResponse TEXT,
        executionCount INTEGER,
        failureCount INTEGER,
        streakCount INTEGER,
        totalRecoveredHours REAL,
        PRIMARY KEY (id, user_id)
    )
    """)
    
    # Tasks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT,
        user_id TEXT DEFAULT 'anonymous',
        title TEXT,
        due TEXT,
        created TEXT,
        estimatedHours REAL,
        importance TEXT,
        completed INTEGER,
        survivalScore INTEGER,
        escalationLevel TEXT,
        pointOfNoReturn TEXT,
        deadlineCollapse INTEGER,
        delayCount INTEGER,
        events TEXT,
        recoveryActive INTEGER,
        recoveryProgress REAL,
        recoveryChecklist TEXT,
        riskBeforeRecovery INTEGER,
        negotiationLog TEXT,
        category TEXT,
        timeline TEXT,
        delayHistory TEXT,
        PRIMARY KEY (id, user_id)
    )
    """)
    
    # Migrate existing databases that lack user_id column
    try:
        cursor.execute("ALTER TABLE tasks ADD COLUMN user_id TEXT DEFAULT 'anonymous'")
    except sqlite3.OperationalError:
        pass
    try:
        cursor.execute("ALTER TABLE settings ADD COLUMN user_id TEXT DEFAULT 'anonymous'")
    except sqlite3.OperationalError:
        pass
    
    # Populate default settings row if not exists (only for anonymous users, compat)
    cursor.execute("SELECT COUNT(*) FROM settings WHERE id = 'active_operator' AND user_id = 'anonymous'")
    if cursor.fetchone()[0] == 0:
        cursor.execute("""
        INSERT OR IGNORE INTO settings (
            id, user_id, username, sleepStart, sleepEnd, ntfyTopic, twinProfile, 
            procrastinationRating, attentionCycle, stressResponse, 
            executionCount, failureCount, streakCount, totalRecoveredHours
        ) VALUES (
            'active_operator', 'anonymous', 'user', 23, 7, 'chronos-alerts-user', '',
            8.0, 'Focus cycles peak late evening', 'Postpones tasks under high workload pressure',
            0, 0, 0, 0.0
        )
        """)
        conn.commit()
    conn.close()

# Initialize DB immediately
init_sqlite_db()
init_memory_table()

# Migrate: add onboarding_completed column if not exists
try:
    conn = get_db_conn()
    conn.execute("ALTER TABLE settings ADD COLUMN onboarding_completed INTEGER DEFAULT 0")
    conn.commit()
    conn.close()
except sqlite3.OperationalError:
    pass

# Migrate: add rescueResources column if not exists
try:
    conn = get_db_conn()
    conn.execute("ALTER TABLE tasks ADD COLUMN rescueResources TEXT")
    conn.commit()
    conn.close()
except sqlite3.OperationalError:
    pass


# --- Database Operations Adapter ---

def load_tasks_db(user_id=None):
    try:
        if user_id is None:
            user_id = getattr(g, 'user_id', 'anonymous')
        conn = get_db_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks WHERE user_id = ?", (user_id,))
        rows = cursor.fetchall()
        conn.close()
        
        tasks_list = []
        for row in rows:
            t = dict(row)
            t['completed'] = bool(t['completed'])
            t['deadlineCollapse'] = bool(t['deadlineCollapse'])
            t['recoveryActive'] = bool(t['recoveryActive']) if t['recoveryActive'] is not None else False
            
            try:
                t['events'] = json.loads(t['events']) if t['events'] else []
            except Exception:
                t['events'] = []
                
            try:
                t['recoveryChecklist'] = json.loads(t['recoveryChecklist']) if t['recoveryChecklist'] else []
            except Exception:
                t['recoveryChecklist'] = []
                
            try:
                t['negotiationLog'] = json.loads(t['negotiationLog']) if t['negotiationLog'] else []
            except Exception:
                t['negotiationLog'] = []
                
            try:
                t['timeline'] = json.loads(t['timeline']) if t['timeline'] else []
            except Exception:
                t['timeline'] = []
                
            try:
                t['delayHistory'] = json.loads(t['delayHistory']) if t['delayHistory'] else []
            except Exception:
                t['delayHistory'] = []

            try:
                t['rescueResources'] = json.loads(t['rescueResources']) if t.get('rescueResources') else None
            except Exception:
                t['rescueResources'] = None

            tasks_list.append(t)
        return tasks_list
    except Exception as e:
        print(f"[CHRONOS DB] SQLite read error: {e}")
        return []

def save_task_db(task, user_id=None):
    try:
        if user_id is None:
            user_id = task.get('user_id') or getattr(g, 'user_id', 'anonymous')
        task['id'] = str(task['id'])
        
        # Load previous task state from SQLite to compare transitions
        prev_task = None
        try:
            conn_prev = get_db_conn()
            conn_prev.row_factory = sqlite3.Row
            cursor_prev = conn_prev.cursor()
            cursor_prev.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task['id'], user_id))
            row = cursor_prev.fetchone()
            if row:
                prev_task = dict(row)
                prev_task['events'] = json.loads(prev_task['events']) if prev_task['events'] else []
                prev_task['recoveryChecklist'] = json.loads(prev_task['recoveryChecklist']) if prev_task['recoveryChecklist'] else []
                prev_task['negotiationLog'] = json.loads(prev_task['negotiationLog']) if prev_task['negotiationLog'] else []
                prev_task['timeline'] = json.loads(prev_task['timeline']) if prev_task['timeline'] else []
                prev_task['delayHistory'] = json.loads(prev_task['delayHistory']) if prev_task['delayHistory'] else []
                prev_task['completed'] = bool(prev_task['completed'])
                prev_task['recoveryActive'] = bool(prev_task['recoveryActive'])
            conn_prev.close()
        except Exception as e:
            print(f"Error loading prev task state: {e}")
            
        if prev_task:
            evaluate_task_state_voice_events(prev_task, task)

        conn = get_db_conn()
        cursor = conn.cursor()
        
        events_str = json.dumps(task.get('events', []))
        checklist_str = json.dumps(task.get('recoveryChecklist', []))
        negotiation_str = json.dumps(task.get('negotiationLog', []))
        timeline_str = json.dumps(task.get('timeline', []))
        delay_history_str = json.dumps(task.get('delayHistory', []))
        rescue_resources_str = json.dumps(task.get('rescueResources')) if task.get('rescueResources') is not None else None
        
        completed_val = 1 if task.get('completed', False) else 0
        collapse_val = 1 if task.get('deadlineCollapse', False) else 0
        recovery_active_val = 1 if task.get('recoveryActive', False) else 0
        
        cursor.execute("""
        INSERT INTO tasks (
            id, user_id, title, due, created, estimatedHours, importance, completed,
            survivalScore, escalationLevel, pointOfNoReturn, deadlineCollapse,
            delayCount, events, recoveryActive, recoveryProgress, recoveryChecklist,
            riskBeforeRecovery, negotiationLog, category, timeline, delayHistory, rescueResources
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, user_id) DO UPDATE SET
            title=excluded.title,
            due=excluded.due,
            created=excluded.created,
            estimatedHours=excluded.estimatedHours,
            importance=excluded.importance,
            completed=excluded.completed,
            survivalScore=excluded.survivalScore,
            escalationLevel=excluded.escalationLevel,
            pointOfNoReturn=excluded.pointOfNoReturn,
            deadlineCollapse=excluded.deadlineCollapse,
            delayCount=excluded.delayCount,
            events=excluded.events,
            recoveryActive=excluded.recoveryActive,
            recoveryProgress=excluded.recoveryProgress,
            recoveryChecklist=excluded.recoveryChecklist,
            riskBeforeRecovery=excluded.riskBeforeRecovery,
            negotiationLog=excluded.negotiationLog,
            category=excluded.category,
            timeline=excluded.timeline,
            delayHistory=excluded.delayHistory,
            rescueResources=excluded.rescueResources
        """, (
            str(task['id']),
            user_id,
            task.get('title', ''),
            task.get('due', ''),
            task.get('created', ''),
            float(task.get('estimatedHours', 2.0)),
            task.get('importance', 'medium'),
            completed_val,
            task.get('survivalScore', 100),
            task.get('escalationLevel', 'green'),
            task.get('pointOfNoReturn', ''),
            collapse_val,
            int(task.get('delayCount', 0)),
            events_str,
            recovery_active_val,
            float(task.get('recoveryProgress', 0.0)),
            checklist_str,
            int(task.get('riskBeforeRecovery', 0)),
            negotiation_str,
            task.get('category', ''),
            timeline_str,
            delay_history_str,
            rescue_resources_str
        ))
        
        conn.commit()
        conn.close()
        _gcs_backup_async()
    except Exception as e:
        print(f"[CHRONOS DB] SQLite write error: {e}")

def delete_task_db(tid, user_id=None):
    try:
        if user_id is None:
            user_id = getattr(g, 'user_id', 'anonymous')
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (str(tid), user_id))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[CHRONOS DB] SQLite delete error: {e}")

def update_twin_metrics(completed_change=None, failure_change=None, recovered_hours_change=None, user_id=None):
    try:
        if user_id is None:
            user_id = getattr(g, 'user_id', 'anonymous')
        conn = get_db_conn()
        cursor = conn.cursor()
        
        cursor.execute("SELECT executionCount, failureCount, streakCount, totalRecoveredHours FROM settings WHERE id = 'active_operator' AND user_id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return
            
        execution_count = int(row[0] or 0)
        failure_count = int(row[1] or 0)
        streak_count = int(row[2] or 0)
        total_recovered_hours = float(row[3] or 0.0)
        
        if completed_change is not None:
            execution_count = max(0, execution_count + completed_change)
            if completed_change > 0:
                streak_count += 1
            else:
                streak_count = max(0, streak_count - 1)
                
        if failure_change is not None:
            failure_count = max(0, failure_count + failure_change)
            if failure_change > 0:
                streak_count = 0  # reset streak on failure
                
        if recovered_hours_change is not None:
            total_recovered_hours = max(0.0, total_recovered_hours + recovered_hours_change)
            
        cursor.execute("""
        UPDATE settings SET
            executionCount = ?,
            failureCount = ?,
            streakCount = ?,
            totalRecoveredHours = ?
        WHERE id = 'active_operator' AND user_id = ?
        """, (execution_count, failure_count, streak_count, total_recovered_hours, user_id))
        
        conn.commit()
        conn.close()
        
        # Keep settings.json synced for external processes
        settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
        if os.path.exists(settings_file):
            try:
                with open(settings_file, 'r') as f:
                    cfg = json.load(f)
                cfg['executionCount'] = execution_count
                cfg['failureCount'] = failure_count
                cfg['streakCount'] = streak_count
                cfg['totalRecoveredHours'] = total_recovered_hours
                with open(settings_file, 'w') as f:
                    json.dump(cfg, f, indent=2)
            except Exception:
                pass
    except Exception as e:
        print(f"[SQLite update metrics error] {e}")

# --- Agentic Core Logic ---

def get_sleep_hours_between(start_dt, end_dt, sleep_start=23, sleep_end=7):
    """
    Calculates the number of sleep hours between start_dt and end_dt.
    Sleep hours are daily from sleep_start to sleep_end (e.g. 23:00 to 07:00).
    Handles overnight wrap-around (e.g. sleep_start = 23, sleep_end = 7).
    """
    if start_dt >= end_dt:
        return 0.0
        
    total_sleep_hours = 0.0
    current_dt = start_dt
    step = datetime.timedelta(minutes=30)
    
    sleep_set = set()
    h = sleep_start
    while h != sleep_end:
        sleep_set.add(h)
        h = (h + 1) % 24
        
    while current_dt < end_dt:
        if current_dt.hour in sleep_set:
            total_sleep_hours += 0.5
        current_dt += step
        
    return total_sleep_hours

def query_ai_direct(provider, api_url, api_key, model, messages, timeout=30):
    """
    Reusable helper to query the configured AI supplier directly.
    Returns the assistant's reply text, or None on failure.
    """
    try:
        if provider == 'gemini':
            if not api_key:
                return None
            contents = []
            system_instruction = None
            for msg in messages:
                role = msg.get('role')
                content = msg.get('content', '')
                if role == 'system':
                    system_instruction = content
                elif role == 'user':
                    contents.append({"role": "user", "parts": [{"text": content}]})
                elif role == 'assistant':
                    contents.append({"role": "model", "parts": [{"text": content}]})
            gemini_model = model or 'gemini-1.5-flash'
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
            headers_gemini = {"X-Goog-Api-Key": api_key, "Content-Type": "application/json"}
            payload = {"contents": contents, "generationConfig": {"temperature": 0.7}}
            if system_instruction:
                payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
            response = requests.post(url, json=payload, headers=headers_gemini, timeout=timeout)
            response.raise_for_status()
            res_data = response.json()
            return res_data['candidates'][0]['content']['parts'][0]['text']


        elif provider == 'nvidia':
            url = f"{api_url or 'https://integrate.api.nvidia.com/v1'}/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"model": model or "meta/llama-3.1-8b-instruct", "messages": messages, "temperature": 0.5, "max_tokens": 1024, "stream": False}
            response = requests.post(url, json=payload, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.json().get('choices', [{}])[0].get('message', {}).get('content', '')

        elif provider == 'custom':
            if not api_url:
                return None
            url = f"{api_url.rstrip('/')}/chat/completions"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            payload = {"model": model, "messages": messages, "temperature": 0.7, "stream": False}
            response = requests.post(url, json=payload, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.json().get('choices', [{}])[0].get('message', {}).get('content', '')

    except Exception as e:
        print(f"[query_ai_direct] AI query failed: {e}", flush=True)
        return None


def get_ai_config_from_db():
    """Load AI supplier config from settings (stored in settings.json)."""
    settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
    if os.path.exists(settings_file):
        try:
            with open(settings_file, 'r') as f:
                cfg = json.load(f)
                return {
                    'provider': cfg.get('aiProvider', 'gemini'),
                    'apiUrl': cfg.get('aiApiUrl', 'https://generativelanguage.googleapis.com/v1beta'),
                    'apiKey': cfg.get('aiApiKey', ''),
                    'model': cfg.get('aiModel', 'gemini-1.5-flash'),
                }
        except Exception:
            pass
    return {'provider': 'gemini', 'apiUrl': 'https://generativelanguage.googleapis.com/v1beta', 'apiKey': '', 'model': 'gemini-1.5-flash'}


def generate_dynamic_timeline(title, due_str, twin_profile="", ai_config=None, user_id=None, estimated_hours=None):
    """
    Generates a time-pressure-aware timeline. Urgency tier is computed from
    actual remaining hours and available work capacity, then passed to the AI
    (or rule-based fallback) so generated phases reflect real deadline proximity.
    """
    import math as _math

    now = datetime.datetime.now()
    due = now + datetime.timedelta(hours=4)
    due = parse_iso_to_local_naive(due_str)

    total_hours = (due - now).total_seconds() / 3600.0
    est_h = float(estimated_hours) if estimated_hours else max(1.0, total_hours * 0.4)

    def format_time_ref(dt):
        diff_days = (dt.date() - now.date()).days
        time_part = dt.strftime("%I:%M %p")
        if diff_days == 0:
            return f"Today, {time_part}"
        elif diff_days == 1:
            return f"Tomorrow, {time_part}"
        else:
            return f"{dt.strftime('%a %d %b')}, {time_part}"

    # Load sleep & procrastination settings
    sleep_start = 23
    sleep_end = 7
    procrastination_rating = 8.0
    try:
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute(
            "SELECT sleepStart, sleepEnd, procrastinationRating FROM settings WHERE id = 'active_operator' AND user_id = ?",
            (user_id,)
        )
        row = cursor.fetchone()
        if row:
            sleep_start = int(row[0])
            sleep_end   = int(row[1])
            procrastination_rating = float(row[2])
        conn.close()
    except Exception:
        pass

    # Compute available work hours (excl. sleep/eating/misc)
    sleep_h  = get_sleep_hours_between(now, due, sleep_start, sleep_end) if total_hours > 0 else 0
    avail_h  = max(0.0, total_hours - sleep_h - 2.0*(total_hours/24.0) - 1.5*(total_hours/24.0))
    efficiency = max(0.35, 0.90 - (procrastination_rating - 1) * 0.055)
    effective_h = avail_h * efficiency
    feasibility = (effective_h / est_h) if est_h > 0 else 0.0

    # 5-Tier urgency system
    if total_hours <= 0:
        urgency_tier = "RECOVERY"
        urgency_desc = "deadline has passed — damage control mode"
        phase_count  = 2
    elif total_hours <= 4:
        urgency_tier = "CRITICAL"
        urgency_desc = f"only {total_hours:.1f}h left — emergency sprint required"
        phase_count  = 2
    elif total_hours <= 24:
        urgency_tier = "HIGH"
        urgency_desc = "deadline is today — compressed single-day schedule"
        phase_count  = 3
    elif total_hours <= 72:
        urgency_tier = "MODERATE"
        urgency_desc = "2–3 days remaining — structured execution window"
        phase_count  = 4
    else:
        urgency_tier = "RELAXED"
        urgency_desc = f"{total_hours/24:.0f} days remaining — deliberate paced schedule"
        phase_count  = 5

    feasibility_note = (
        "SURPLUS: ample capacity" if feasibility >= 1.5
        else "TIGHT: no slack for delays" if feasibility >= 1.0
        else f"DEFICIT: {round(est_h - effective_h, 1)}h shortfall — sleep sacrifice or scope reduction needed"
    )

    # Try user's configured AI supplier first
    if ai_config and ai_config.get('apiKey'):
        try:
            prompt = (
                f"You are Chronos, a tactical AI deadline defense system. Current time: {now.strftime('%A, %d %b %Y at %I:%M %p')}.\n"
                f"Generate a time-pressure-aware task breakdown for: '{title}'\n"
                f"Deadline: {due.strftime('%A, %d %b at %I:%M %p')} ({total_hours:.1f}h from now)\n"
                f"Urgency Tier: {urgency_tier} — {urgency_desc}\n"
                f"Estimated effort: {est_h:.1f}h | Effective capacity: {effective_h:.1f}h | Feasibility: {feasibility_note}\n"
                f"Sleep schedule: {sleep_start}:00–{sleep_end}:00 | Procrastination factor: {procrastination_rating}/10\n"
                f"Twin profile: {twin_profile}\n\n"
                f"Generate EXACTLY {phase_count} phases.\n"
                f"Tone rules by urgency tier:\n"
                f"  RELAXED: optimistic, deliberate, quality-focused phrasing\n"
                f"  MODERATE: structured, business-like, balanced\n"
                f"  HIGH: urgent, focused, single-day sprint mentality\n"
                f"  CRITICAL: emergency framing, acknowledge time pressure explicitly, no fluff\n"
                f"  RECOVERY: post-deadline damage control, constructive tone, partial credit focus\n"
                f"Rules: Never schedule work during sleep ({sleep_start}:00–{sleep_end}:00). "
                f"Each scheduledTime must be a realistic clock time given today's date and sleep windows. "
                f"Phase 1 should start within 30 minutes of now if CRITICAL or HIGH.\n"
                f"Respond ONLY with raw JSON array: "
                f'[{{"title": "...", "scheduledTime": "Today at 8:00 PM"}}]'
            )
            reply = query_ai_direct(
                ai_config.get('provider', 'gemini'),
                ai_config.get('apiUrl'),
                ai_config.get('apiKey'),
                ai_config.get('model'),
                [{"role": "user", "content": prompt}],
                timeout=15
            )
            if reply:
                content = reply.strip()
                if '```' in content:
                    for part in content.split('```'):
                        stripped = part.strip().lstrip('json').strip()
                        if stripped.startswith('['):
                            content = stripped
                            break
                phases = json.loads(content)
                if isinstance(phases, list) and len(phases) >= 2:
                    return [
                        {
                            "id": f"m{i+1}",
                            "title": p.get("title", f"Phase {i+1}"),
                            "status": "pending",
                            "scheduledTime": p.get("scheduledTime", "")
                        }
                        for i, p in enumerate(phases)
                    ]
        except Exception as e:
            print(f"[Timeline Gen] AI failed: {e}", flush=True)

    # ── Rule-based fallback with 5-tier urgency ───────────────────────────
    def phase_time(fraction):
        dt = now + datetime.timedelta(hours=max(0, total_hours) * fraction)
        # Skip into next valid work window if in sleep period
        if sleep_start > sleep_end:  # e.g. 23:00 – 07:00
            in_sleep = dt.hour >= sleep_start or dt.hour < sleep_end
        else:
            in_sleep = sleep_start <= dt.hour < sleep_end
        if in_sleep:
            # Advance to next wake-up time
            wake_dt = dt.replace(hour=sleep_end, minute=0, second=0, microsecond=0)
            if wake_dt <= dt:
                wake_dt += datetime.timedelta(days=1)
            dt = wake_dt
        return format_time_ref(dt)

    if urgency_tier == "RECOVERY":
        return [
            {"id": "m1", "title": f"Emergency triage: assess what's salvageable from '{title}'", "status": "pending", "scheduledTime": phase_time(0.1)},
            {"id": "m2", "title": f"Late submission or partial credit: finalise '{title}'",    "status": "pending", "scheduledTime": phase_time(0.6)},
        ]
    elif urgency_tier == "CRITICAL":
        return [
            {"id": "m1", "title": f"URGENT — Begin '{title}' immediately (core work only)", "status": "pending", "scheduledTime": phase_time(0.05)},
            {"id": "m2", "title": f"URGENT — Final wrap-up and submission of '{title}'",     "status": "pending", "scheduledTime": phase_time(0.75)},
        ]
    elif urgency_tier == "HIGH":
        return [
            {"id": "m1", "title": f"Start now: foundation work for '{title}'",  "status": "pending", "scheduledTime": phase_time(0.1)},
            {"id": "m2", "title": f"Core execution sprint: '{title}'",          "status": "pending", "scheduledTime": phase_time(0.5)},
            {"id": "m3", "title": f"Final review and submission: '{title}'",    "status": "pending", "scheduledTime": phase_time(0.85)},
        ]
    elif urgency_tier == "MODERATE":
        return [
            {"id": "m1", "title": f"Define scope and plan for '{title}'",    "status": "pending", "scheduledTime": phase_time(0.1)},
            {"id": "m2", "title": f"Research and gather resources",           "status": "pending", "scheduledTime": phase_time(0.35)},
            {"id": "m3", "title": f"Core execution: '{title}'",               "status": "pending", "scheduledTime": phase_time(0.6)},
            {"id": "m4", "title": f"Review, refine and submit",               "status": "pending", "scheduledTime": phase_time(0.88)},
        ]
    else:  # RELAXED
        return [
            {"id": "m1", "title": f"Scope and plan: '{title}'",           "status": "pending", "scheduledTime": phase_time(0.08)},
            {"id": "m2", "title": f"Deep research and preparation",        "status": "pending", "scheduledTime": phase_time(0.28)},
            {"id": "m3", "title": f"Core implementation: '{title}'",       "status": "pending", "scheduledTime": phase_time(0.52)},
            {"id": "m4", "title": f"Testing and quality review",           "status": "pending", "scheduledTime": phase_time(0.72)},
            {"id": "m5", "title": f"Final polish and submission",          "status": "pending", "scheduledTime": phase_time(0.92)},
        ]




AI_EVALUATION_CACHE = {}

def run_autonomous_agent_decisions(task, level, survival_score, sleep_start, sleep_end, twin_profile, ai_config, user_id=None):
    if user_id is None:
        user_id = getattr(g, 'user_id', 'anonymous')
    now = datetime.datetime.now()
    events = task.get('events', [])
    modified = False
    details = []

    # Check if user is falling behind (score < 50 or level is critical)
    if survival_score >= 50 and level not in ['orange', 'red', 'black']:
        return task

    # Check if we already did an autonomous override recently to avoid infinite loops
    recent_override = False
    for ev in reversed(events):
        if "Autonomous Intervention" in ev.get('message', ''):
            try:
                ev_time = datetime.datetime.fromisoformat(ev.get('timestamp'))
                if (now - ev_time).total_seconds() < 40:
                    recent_override = True
            except Exception:
                pass
            
    if recent_override:
        return task

    # Calculate dynamic agent confidence and reasoning bullets
    procrastination_rating = 8.0
    try:
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT procrastinationRating FROM settings WHERE id = 'active_operator' AND user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            procrastination_rating = float(row[0])
    except Exception:
        pass

    confidence = min(98, max(65, 100 - survival_score + int(procrastination_rating * 2)))
    
    due_str = task.get('due')
    real_hours_left = 4.0
    if due_str:
        due_dt = parse_iso_to_local_naive(due_str)
        real_hours_left = max(0.1, (due_dt - now).total_seconds() / 3600.0)

    estimated_hours = float(task.get('estimatedHours', 2))
    delay_count = int(task.get('delayCount', 0))

    reasons = [
        f"{real_hours_left:.1f} productive hours remaining",
        f"Estimated work: {estimated_hours:.1f} hours",
        f"Procrastination threat multiplier: {procrastination_rating}/10"
    ]
    if delay_count > 0:
        reasons.append(f"{delay_count} historical delays recorded")
    
    reasons_str = "\n".join(f"• {r}" for r in reasons)

    # --- ACTION 1: PRIORITY ESCALATION ---
    prev_importance = task.get('importance', 'medium')
    if prev_importance == 'low':
        task['importance'] = 'medium'
        modified = True
        details.append("Elevated importance to MEDIUM")
        events.append({
            'timestamp': now.isoformat(),
            'agent': 'Chronos Autonomous Agent',
            'message': f"Autonomous Intervention: Elevated task priority from LOW to MEDIUM.\nConfidence: {confidence}%\nReason:\n{reasons_str}"
        })
    elif prev_importance == 'medium':
        task['importance'] = 'high'
        modified = True
        details.append("Elevated importance to HIGH")
        events.append({
            'timestamp': now.isoformat(),
            'agent': 'Chronos Autonomous Agent',
            'message': f"Autonomous Intervention: Elevated task priority from MEDIUM to HIGH.\nConfidence: {confidence}%\nReason:\n{reasons_str}"
        })

    # --- ACTION 2: MILESTONE SPLITTING ---
    timeline = task.get('timeline', [])
    split_done = False
    for milestone in timeline:
        checkpoints = milestone.get('checkpoints', []) if isinstance(milestone, dict) else []
        for idx, cp in enumerate(checkpoints):
            if cp.get('status') in ['pending', 'active'] and not cp.get('completed', False):
                old_title = cp.get('title', 'Subgoal')
                if "Step " in old_title or "Part " in old_title or cp.get('is_split'):
                    continue
                    
                split_done = True
                cp['is_split'] = True
                
                step1 = f"Part A: Setup & prototyping for {old_title}"
                step2 = f"Part B: Core implementation & testing of {old_title}"
                
                if ai_config and ai_config.get('apiKey'):
                    try:
                        ai_prompt = f"""You are the Chronos Task Splitter. The operator is falling behind on task checkpoint "{old_title}". 
Split this checkpoint into exactly 2 smaller, highly actionable, specific technical steps. 
Respond ONLY with a raw JSON array of 2 strings: ["Step 1", "Step 2"]."""
                        reply = query_ai_direct(
                            ai_config.get('provider', 'gemini'),
                            ai_config.get('apiUrl'),
                            ai_config.get('apiKey'),
                            ai_config.get('model'),
                            [{"role": "user", "content": ai_prompt}],
                            timeout=8
                        )
                        if reply:
                            content = reply.strip()
                            if '```' in content:
                                content = content.split('```')[1].strip()
                                if content.startswith('json'):
                                    content = content[4:].strip()
                            parsed = json.loads(content)
                            if isinstance(parsed, list) and len(parsed) == 2:
                                step1 = parsed[0]
                                step2 = parsed[1]
                    except Exception:
                        pass
                
                import uuid
                cp_duration = cp.get('estimatedMinutes', 60)
                cp1 = {
                    'id': str(uuid.uuid4()),
                    'title': step1,
                    'detail': cp.get('detail', ''),
                    'status': 'active',
                    'scheduledTime': cp.get('scheduledTime'),
                    'estimatedMinutes': cp_duration // 2,
                    'is_split': True
                }
                cp2 = {
                    'id': str(uuid.uuid4()),
                    'title': step2,
                    'detail': cp.get('detail', ''),
                    'status': 'pending',
                    'scheduledTime': cp.get('scheduledTime'),
                    'estimatedMinutes': cp_duration // 2,
                    'is_split': True
                }
                
                checkpoints.pop(idx)
                checkpoints.insert(idx, cp2)
                checkpoints.insert(idx, cp1)
                milestone['checkpoints'] = checkpoints
                modified = True
                details.append(f"Split checkpoint '{old_title}'")
                events.append({
                    'timestamp': now.isoformat(),
                    'agent': 'Chronos Autonomous Agent',
                    'message': f"Autonomous Intervention: Split checkpoint '{old_title}' into 2 micro-steps to reduce cognitive friction.\nConfidence: {confidence}%\nReason:\n{reasons_str}"
                })
                break
        if split_done:
            break

    # --- ACTION 3: SLEEP WINDOW TIMELINE SHIFT ---
    shifted_count = 0
    for milestone in timeline:
        checkpoints = milestone.get('checkpoints', []) if isinstance(milestone, dict) else []
        for cp in checkpoints:
            if cp.get('status') in ['pending', 'active'] and not cp.get('completed', False):
                sched_str = cp.get('scheduledTime', '')
                if sched_str:
                    try:
                        iso_clean = sched_str.replace('Z', '+00:00')
                        sched_dt = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
                        
                        sleep_hours_list = []
                        curr = sleep_start
                        while curr != sleep_end:
                            sleep_hours_list.append(curr)
                            curr = (curr + 1) % 24
                          
                        if sched_dt.hour in sleep_hours_list:
                            new_sched_dt = sched_dt
                            if sched_dt.hour >= sleep_start:
                                new_sched_dt = sched_dt + datetime.timedelta(days=1)
                            new_sched_dt = new_sched_dt.replace(hour=sleep_end, minute=0, second=0)
                            cp['scheduledTime'] = new_sched_dt.isoformat() + 'Z'
                            shifted_count += 1
                    except Exception:
                        pass
    if shifted_count > 0:
        modified = True
        details.append(f"Shifted {shifted_count} checkpoints past sleep hours")
        events.append({
            'timestamp': now.isoformat(),
            'agent': 'Chronos Autonomous Agent',
            'message': f"Autonomous Intervention: Rescheduled checkpoints past sleep hours ({sleep_start}:00 - {sleep_end}:00).\nConfidence: {confidence}%\nReason:\n{reasons_str}"
        })

    # --- ACTION 4: DISPATCH URGENT ALERTS & VOICE ---
    if modified:
        summary_details = ", ".join(details)
        send_phone_notification(
            "⚠️ Chronos Autonomous Override Engaged",
            f"Chronos has modified '{task.get('title')}' scheduling: {summary_details}. Immediate action required!"
        )
        try:
            # Bypass self-call HTTP requests to avoid hardcoded port issues
            is_muted = voice_muted and (time.time() < voice_muted_until)
            if not is_muted:
                speech_queue.put(f"Warning: Chronos autonomous intervention engaged for task: {task.get('title')}. Adjusting priority and timeline parameters.")
        except Exception as e:
            print(f"[Voice Speak Direct Queue Error] {e}")

    task['events'] = events
    return task


def evaluate_task(task, twin_profile="", is_pulse=False, user_id=None):
    """
    Risk Agent: Recalculates survival scores, deterioration history, and 'Point of No Return'.
    Intervention Agent: Assigns 5-stage escalation levels and generates alerts.
    """
    if user_id is None:
        user_id = getattr(g, 'user_id', 'anonymous')
    due_str = task.get('due')
    if not due_str:
        return task
        
    created_str = task.get('created') or datetime.datetime.now().isoformat()
    estimated_hours = float(task.get('estimatedHours', 2))
    importance = task.get('importance', 'medium')
    completed = task.get('completed', False)
    
    if completed:
        task['survivalScore'] = 100
        task['escalationLevel'] = 'green'
        task['deadlineCollapse'] = False
        task['pointOfNoReturn'] = "Deadline Secure"
        return task
        
    now = datetime.datetime.now()
    due = parse_iso_to_local_naive(due_str)
    
    # Calculate real time remaining in hours
    real_time_diff = due - now
    real_hours_left = real_time_diff.total_seconds() / 3600.0
    
    if real_hours_left <= 0:
        task['survivalScore'] = 0
        task['escalationLevel'] = 'black'
        task['deadlineCollapse'] = True
        task['pointOfNoReturn'] = "Deadline Collapse Passed"
        return task
        
    # Load sleep & procrastination settings from SQLite database
    sleep_start = 23
    sleep_end = 7
    procrastination_rating = 8.0
    try:
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT sleepStart, sleepEnd, procrastinationRating FROM settings WHERE id = 'active_operator' AND user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            sleep_start = int(row[0])
            sleep_end = int(row[1])
            procrastination_rating = float(row[2])
    except Exception as e:
        print(f"[SQLite load settings error] {e}")
            
    # ── Data-driven survival probability ──────────────────────────────────
    # Step 1: Available work hours (excl. sleep, eating overhead, misc overhead)
    sleep_hours      = get_sleep_hours_between(now, due, sleep_start, sleep_end)
    eating_overhead  = 2.0 * (real_hours_left / 24.0)
    misc_overhead    = 1.5 * (real_hours_left / 24.0)
    work_hours_left  = max(0.0, real_hours_left - sleep_hours - eating_overhead - misc_overhead)

    # Step 2: Procrastination erosion — user won't use 100% of available hours.
    #   procrastination_rating 1 = very disciplined (90% efficiency)
    #   procrastination_rating 10 = extremely prone (40% efficiency)
    efficiency = max(0.35, 0.90 - (procrastination_rating - 1) * 0.055)
    effective_hours = work_hours_left * efficiency

    # Step 3: Feasibility ratio — how much capacity vs. how much work is needed
    #   ratio >= 2.0 → very comfortable (score near 95)
    #   ratio == 1.0 → exactly enough (score ~55; procrastination risk)
    #   ratio  < 1.0 → physically impossible without skipping sleep
    #   ratio <= 0   → already impossible
    if estimated_hours <= 0:
        estimated_hours = 0.5
    feasibility_ratio = effective_hours / estimated_hours

    # Step 4: Base survival score from capacity curve (sigmoid-like mapping)
    if feasibility_ratio <= 0:
        base_score = 1
    elif feasibility_ratio >= 3.0:
        base_score = 96
    else:
        # Smooth curve: 0→1, 0.5→25, 1.0→55, 1.5→72, 2.0→84, 2.5→90, 3.0→96
        import math
        base_score = int(96 * (1 - math.exp(-1.4 * feasibility_ratio)))
        base_score = max(1, min(96, base_score))

    # Step 5: Progress credit — completed checkpoints reduce remaining effort
    try:
        cat_raw = task.get('category', '{}') or '{}'
        cat_obj = json.loads(cat_raw) if isinstance(cat_raw, str) else (cat_raw or {})
        completed_cps = len(cat_obj.get('completedCheckpoints', []))
        total_cps = sum(
            len(m.get('checkpoints', [])) if isinstance(m, dict) else 0
            for m in (task.get('timeline') or [])
        )
        progress_fraction = (completed_cps / total_cps) if total_cps > 0 else 0.0
    except Exception:
        progress_fraction = 0.0
    progress_bonus = int(progress_fraction * 12)  # up to +12 pts for full completion

    # Step 6: Historical delay penalty
    delay_count   = int(task.get('delayCount', 0))
    delay_penalty = min(30, delay_count * 8)

    # Step 7: Importance weight (high-importance tasks feel more precarious)
    importance_penalty = {'high': 4, 'medium': 0, 'low': -3}.get(importance, 0)

    # Step 8: Compose final score
    survival_score = base_score + progress_bonus - delay_penalty - importance_penalty
    survival_score = max(1, min(98, survival_score))

    no_return_offset_hours = estimated_hours
    predicted_start_lead_hours = round(max(1.0, (10.0 - procrastination_rating) * 1.5), 1)
    cognitive_observations = [
        f"Capacity check: {round(effective_hours, 1)}h effective (of {round(work_hours_left, 1)}h available at {int(efficiency*100)}% efficiency) vs {estimated_hours}h required.",
        f"Feasibility ratio: {round(feasibility_ratio, 2)}x. {'Surplus capacity.' if feasibility_ratio >= 1.5 else 'Tight window — no slack.' if feasibility_ratio >= 1.0 else 'DEFICIT — impossible without sleep reduction.'}",
        f"Adjustments: progress +{progress_bonus}pts, delay history -{delay_penalty}pts, procrastination erosion active ({int((1-efficiency)*100)}% waste)."
    ]

    log_message = None

    ai_config = None
    task_id = str(task.get('id'))
    cached_eval = AI_EVALUATION_CACHE.get(task_id) if is_pulse else None
    
    if cached_eval:
        survival_score = cached_eval['survivalScore']
        no_return_offset_hours = cached_eval['pointOfNoReturnHours']
        cognitive_observations = cached_eval['cognitiveObservations']
        log_message = cached_eval['logMessage']
        
        # Calculate dynamic decay if they are running out of time
        if work_hours_left < estimated_hours:
            deficit_factor = work_hours_left / estimated_hours
            survival_score = int(survival_score * deficit_factor)
            survival_score = max(1, min(98, survival_score))
    else:
        # Query AI config
        ai_config = get_ai_config_from_db()
        if ai_config and ai_config.get('apiKey'):
            try:
                ai_prompt = f"""You are the Chronos Risk and Intervention Agent. Evaluate the procrastination risk of this task.
    
Task: "{task.get('title')}"
Importance: {importance}
Estimated effort: {estimated_hours} hours
Current time: {now.isoformat()}
Deadline (due): {due.isoformat()}
Total calendar hours remaining: {round(real_hours_left, 2)} hours
Sleep hours in this window: {round(sleep_hours, 2)} hours
Eating hours in this window: {round(eating_overhead, 2)} hours
Miscellaneous overhead in this window: {round(misc_overhead, 2)} hours
Net productive work hours available to user: {round(work_hours_left, 2)} hours
User Twin Profile: {twin_profile}
Sleep schedule: {sleep_start}:00 to {sleep_end}:00
Procrastination rating: {procrastination_rating}/10

Respond with a raw JSON object containing these keys:
- "survivalScore": integer (1 to 98) representing the probability of successfully submitting this task on time.
- "pointOfNoReturnHours": float representing how many hours before the deadline is the absolute point of no return for this task. (Determine this dynamically based on task complexity, net productive hours available, twin profile, and estimated effort.)
- "cognitiveObservations": array of 3 brief, specific clinical observation strings explaining the user's risks, schedules, and focus windows for this task.
- "logMessage": a clinical, technical observation log message to add to the timeline events (max 15 words).

Respond ONLY with raw JSON. No markdown, no explanation."""
                reply = query_ai_direct(
                    ai_config.get('provider', 'gemini'),
                    ai_config.get('apiUrl'),
                    ai_config.get('apiKey'),
                    ai_config.get('model'),
                    [{"role": "user", "content": ai_prompt}],
                    timeout=15
                )
                if reply:
                    content = reply.strip()
                    if '```' in content:
                        parts = content.split('```')
                        for part in parts:
                            stripped = part.strip()
                            if stripped.startswith('json'):
                                stripped = stripped[4:].strip()
                            if stripped.startswith('{'):
                                content = stripped
                                break
                    parsed = json.loads(content)
                    if 'survivalScore' in parsed:
                        survival_score = max(1, min(98, int(parsed['survivalScore'])))
                    if 'pointOfNoReturnHours' in parsed:
                        no_return_offset_hours = float(parsed['pointOfNoReturnHours'])
                    if 'cognitiveObservations' in parsed and isinstance(parsed['cognitiveObservations'], list):
                        cognitive_observations = parsed['cognitiveObservations']
                    if 'logMessage' in parsed:
                        log_message = parsed['logMessage']
                        
                    # Save to cache
                    AI_EVALUATION_CACHE[task_id] = {
                        'survivalScore': survival_score,
                        'pointOfNoReturnHours': no_return_offset_hours,
                        'cognitiveObservations': cognitive_observations,
                        'logMessage': log_message
                    }
            except Exception as e:
                print(f"[evaluate_task] AI evaluation failed: {e}", flush=True)

    # ── Strict Data-Driven Capacity Overrides (Task 5) ────────────────────
    if completed:
        survival_score = 100
    elif real_hours_left <= 0:
        if task.get('recoveryActive'):
            # Recovery Protocol is active. Success probability based on recovery progress
            rec_progress = float(task.get('recoveryProgress') or 0.0)
            survival_score = max(5, min(95, int(rec_progress)))
        else:
            survival_score = 0
    else:
        if work_hours_left <= 0:
            # Sleep schedule/overhead consumed all remaining time
            survival_score = 1
        elif estimated_hours > work_hours_left:
            # Capacity deficit
            capacity_ratio = work_hours_left / estimated_hours
            survival_score = max(1, min(45, int(capacity_ratio * 45)))
        else:
            # Surplus, but adjust based on capacity boundaries
            capacity_ratio = work_hours_left / estimated_hours
            if capacity_ratio < 1.3:
                survival_score = min(65, survival_score)
            elif capacity_ratio < 1.6:
                survival_score = min(80, survival_score)

    # 5-Stage Escalations
    if survival_score >= 80:
        level = 'green'
    elif survival_score >= 60:
        level = 'yellow'
    elif survival_score >= 40:
        level = 'orange'
    elif survival_score >= 20:
        level = 'red'
    else:
        level = 'black'
        
    # Point of No Return computation
    no_return_dt = due - datetime.timedelta(hours=no_return_offset_hours)
    
    if no_return_dt < now:
        no_return_str = "Passed"
    else:
        diff_days = (no_return_dt.date() - now.date()).days
        time_part = no_return_dt.strftime("%I:%M %p")
        if diff_days == 0:
            no_return_str = f"Today, {time_part}"
        elif diff_days == 1:
            no_return_str = f"Tomorrow, {time_part}"
        else:
            no_return_str = f"{no_return_dt.strftime('%d %b')}, {time_part}"
    reason = cognitive_observations[0] if (cognitive_observations and len(cognitive_observations) > 0) else "Potential time deficit detected."
    # Risk analysis telemetry
    task['riskAnalysis'] = {
        'workRemaining': estimated_hours,
        'timeRemaining': round(work_hours_left, 1),
        'twinProcrastinationFactor': round(procrastination_rating * 1.5, 1),
        'historyPenalty': delay_penalty,
        'predictedStartLead': predicted_start_lead_hours,
        'failurePrediction': reason,
        'failureRisk': 100 - survival_score,
        'cognitiveObservationsList': cognitive_observations
    }
    
    # Update task attributes
    prev_level = task.get('escalationLevel', 'green')
    prev_collapse = task.get('deadlineCollapse', False)
    task['survivalScore'] = survival_score
    task['escalationLevel'] = level
    task['pointOfNoReturn'] = no_return_str
    task['deadlineCollapse'] = (level == 'black')

    
    # Check if we need to send push notification
    if level != prev_level and level in ['red', 'black']:
        send_phone_notification(
            f"Chronos Alert: Task Escalated ({level.upper()})",
            f"Task '{task.get('title')}' is now in critical '{level}' status. Survival forecast: {survival_score}%. Work Remaining: {estimated_hours}h."
        )
    elif task['deadlineCollapse'] and not prev_collapse:
        update_twin_metrics(failure_change=1)
        send_phone_notification(
            "Chronos CRITICAL: Deadline Collapse Detected",
            f"Task '{task.get('title')}' has collapsed! The deadline has passed."
        )
    
    # Score History (Trend Sparkline values) - ONLY real values, no deteriorating mock stubs
    history = task.get('scoreHistory', [])
    if not history:
        history = [survival_score]
    else:
        if history[-1] != survival_score:
            history.append(survival_score)
            if len(history) > 5:
                history = history[-5:]
                
    task['scoreHistory'] = history
    
    # Event Log Update
    events = task.get('events', [])
    if not events:
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Planner Agent',
            'message': 'Mission Timeline initialized and aligned with Operator Twin focus windows.'
        })
        
    if prev_level != level:
        message = f"Escalation level transitioned from {prev_level.upper()} to {level.upper()}."
        if level == 'red':
            message += " Active Intervention System voice warning broadcast triggered."
        elif level == 'black':
            message += " Emergency DEADLINE COLLAPSE status activated."
            
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Intervention Agent',
            'message': message
        })
    elif log_message:
        # Append AI generated custom technical observation
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Intervention Agent',
            'message': log_message
        })
        
    task['events'] = events
    
    # Run autonomous agent decisions & overrides
    task = run_autonomous_agent_decisions(task, level, survival_score, sleep_start, sleep_end, twin_profile, ai_config, user_id=user_id)
    
    return task

# --- API Endpoints ---

def generate_fallback_timeline(title, due_str):
    import datetime
    now = datetime.datetime.now()
    due = parse_iso_to_local_naive(due_str)
        
    diff = due - now
    total_hours = max(0.5, diff.total_seconds() / 3600.0)
    
    p1_time = now + datetime.timedelta(hours=total_hours * 0.3)
    p2_time = now + datetime.timedelta(hours=total_hours * 0.7)
    p3_time = due
    
    return [
        {
            "id": "fallback-phase-1",
            "title": "Phase 1: Initial Research & Setup",
            "scheduledTime": p1_time.strftime('%A, %d %b at %I:%M %p'),
            "completed": False,
            "checkpoints": [
                {"id": "fb-cp-1", "title": "Establish core framework", "detail": "Initialize task directories and setup workspace.", "estimatedMinutes": 30, "completed": False},
                {"id": "fb-cp-2", "title": "Outline specifications", "detail": "Draft design document and plan API integration boundaries.", "estimatedMinutes": 30, "completed": False}
            ]
        },
        {
            "id": "fallback-phase-2",
            "title": "Phase 2: Core Development & Implementation",
            "scheduledTime": p2_time.strftime('%A, %d %b at %I:%M %p'),
            "completed": False,
            "checkpoints": [
                {"id": "fb-cp-3", "title": "Implement core logic", "detail": "Write primary functional logic and verify logic loops.", "estimatedMinutes": 60, "completed": False},
                {"id": "fb-cp-4", "title": "Develop visual layout", "detail": "Construct front-end components and wire layout views.", "estimatedMinutes": 60, "completed": False}
            ]
        },
        {
            "id": "fallback-phase-3",
            "title": "Phase 3: Integration & Final Polish",
            "scheduledTime": p3_time.strftime('%A, %d %b at %I:%M %p'),
            "completed": False,
            "checkpoints": [
                {"id": "fb-cp-5", "title": "Run end-to-end diagnostics", "detail": "Conduct unit testing and verify data synchronizations.", "estimatedMinutes": 30, "completed": False},
                {"id": "fb-cp-6", "title": "Submit final verification", "detail": "Complete final checklist and verify production deployment.", "estimatedMinutes": 30, "completed": False}
            ]
        }
    ]

def background_generate_timeline_and_checkpoints(task_id, title, due, twin_profile, ai_config, user_id='anonymous'):
    try:
        print(f"[Passive Charting] Starting AI timeline generation for task: {title}", flush=True)
        ai_milestones = generate_dynamic_timeline(title, due, twin_profile, ai_config, user_id=user_id)
        if not ai_milestones:
            print(f"[Passive Charting] AI timeline generation failed for task '{title}'. Retaining fallback.", flush=True)
            return
            
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT category FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        row = cursor.fetchone()
        cat_obj = {}
        if row and row[0]:
            try:
                cat_obj = json.loads(row[0])
            except Exception:
                pass
        
        ai_summary_text = ""
        ai_summary_list = cat_obj.get('aiSummary', [])
        if ai_summary_list and isinstance(ai_summary_list, list):
            summary_parts = []
            for s in ai_summary_list:
                if isinstance(s, dict):
                    summary_parts.append(s.get('content', ''))
                elif isinstance(s, str):
                    summary_parts.append(s)
            if summary_parts:
                ai_summary_text = "\nAI Summarizer Context:\n" + "\n".join(summary_parts)
        
        for i, mile in enumerate(ai_milestones):
            mile_title = mile.get('title', '')
            mile_scheduled = mile.get('scheduledTime', '')
            
            twin_context = f"\nOperator Profile: {twin_profile}" if twin_profile else ""
            prompt = f"""You are Chronos, a tactical AI deadline defense system.
Task: "{title}" (importance: medium)
Milestone: "{mile_title}" (scheduled: {mile_scheduled}){twin_context}{ai_summary_text}

Generate EXACTLY 3 to 5 highly specific, actionable checkpoint steps for this milestone.
Each checkpoint should be a concrete micro-task tailored to the operator's profile and skill level (not generic).
Use the operator's background and behavioral patterns to suggest realistic, specific actions.
Respond ONLY with a raw JSON array of objects with keys:
- "title": short specific action (max 8 words)
- "detail": one-sentence description of what exactly to do — be specific to this task and milestone
- "estimatedMinutes": estimated minutes (integer, e.g. 15, 30, 45)
No markdown, no explanation."""
            
            checkpoint_content = query_ai_direct(
                ai_config.get('provider', 'gemini'),
                ai_config.get('apiUrl', ''),
                ai_config.get('apiKey', ''),
                ai_config.get('model', 'gemini-1.5-flash'),
                [{"role": "user", "content": prompt}],
                timeout=20
            )
            
            checkpoints = []
            if checkpoint_content:
                content = checkpoint_content.strip()
                if '```' in content:
                    parts = content.split('```')
                    for part in parts:
                        s = part.strip().replace('json', '').strip()
                        if s.startswith('[') and s.endswith(']'):
                            content = s
                            break
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, list):
                        for cp_idx, cp in enumerate(parsed):
                            checkpoints.append({
                                "id": f"cp-{i}-{cp_idx}-{str(uuid.uuid4())[:6]}",
                                "title": cp.get('title', 'Action Step'),
                                "detail": cp.get('detail', 'Execute micro-task step.'),
                                "estimatedMinutes": int(cp.get('estimatedMinutes', 30)),
                                "completed": False
                            })
                except Exception as ex:
                    print(f"[Passive Charting] Failed to parse checkpoints: {ex}", flush=True)
                    
            if not checkpoints:
                checkpoints = [
                    {"id": f"cp-fb-{i}-1", "title": "Kickoff phase milestones", "detail": "Outline requirements and draft work structure.", "estimatedMinutes": 30, "completed": False},
                    {"id": f"cp-fb-{i}-2", "title": "Execute action milestones", "detail": "Implement core functional elements of this phase.", "estimatedMinutes": 45, "completed": False}
                ]
            mile['checkpoints'] = checkpoints
            
        cat_obj['personalizedTimeline'] = True
        cat_obj['personalizationLog'] = [{"role": "assistant", "content": "Adaptive timeline generated passively."}]
        
        timeline_str = json.dumps(ai_milestones)
        category_str = json.dumps(cat_obj)
        
        cursor.execute("UPDATE tasks SET timeline = ?, category = ? WHERE id = ? AND user_id = ?", (timeline_str, category_str, task_id, user_id))
        conn.commit()
        conn.close()
        print(f"[Passive Charting] Successfully completed AI timeline for task: {title}", flush=True)
    except Exception as e:
        print(f"[Passive Charting Error] Failed passively: {e}", flush=True)

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    return jsonify(load_tasks_db(user_id=g.user_id))

@app.route('/api/tasks', methods=['POST'])
def add_task():
    data = request.get_json() or {}
    twin_profile = data.get('twinProfile', '')
    ai_config = data.get('aiConfig') or get_ai_config_from_db()
    
    task_id = str(uuid.uuid4())
    task = {
        'id': task_id,
        'user_id': g.user_id,
        'title': data.get('title', 'Untitled Deadline'),
        'due': data.get('due'),
        'estimatedHours': float(data.get('estimatedHours', 2)),
        'importance': data.get('importance', 'medium'),
        'completed': False,
        'created': datetime.datetime.now().isoformat(),
        'delayCount': 0,
        'scoreHistory': [],
        'category': data.get('aiSummary', '')
    }
    
    # Generate immediate fallback timeline to unblock client
    task['timeline'] = generate_fallback_timeline(task['title'], task['due'])
    
    # Run Risk/Intervention assessment
    task = evaluate_task(task, twin_profile, user_id=g.user_id)
    
    save_task_db(task, user_id=g.user_id)
    
    # Spawn background thread to generate AI timeline & checkpoints passively
    threading.Thread(
        target=background_generate_timeline_and_checkpoints,
        args=(task['id'], task['title'], task['due'], twin_profile, ai_config, g.user_id),
        daemon=True
    ).start()
    
    # Push to Google Calendar in background (non-blocking)
    threading.Thread(target=push_task_to_google_calendar, args=(task,), daemon=True).start()
    
    return jsonify(task), 201


@app.route('/api/tasks/<tid>', methods=['PUT'])
def update_task(tid):
    data = request.get_json() or {}
    tasks_list = load_tasks_db(user_id=g.user_id)
    task = next((t for t in tasks_list if str(t['id']) == str(tid)), None)
    
    if not task:
        return jsonify({'error': 'Task not found'}), 404
        
    if 'completed' in data:
        was_completed = task.get('completed', False)
        is_completed = bool(data['completed'])
        if is_completed != was_completed:
            completed_change = 1 if is_completed else -1
            update_twin_metrics(completed_change=completed_change, user_id=g.user_id)
            
        task['completed'] = is_completed
        events = task.get('events', [])
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Intervention Agent',
            'message': 'Task marked as secure. Deadline threat dismissed.' if is_completed else 'Task reopened for monitoring.'
        })
        task['events'] = events
        
    if 'title' in data:
        task['title'] = data['title']
    if 'due' in data:
        task['due'] = data['due']
    if 'estimatedHours' in data:
        task['estimatedHours'] = float(data['estimatedHours'])
    if 'importance' in data:
        task['importance'] = data['importance']
    if 'category' in data:
        task['category'] = data['category']
        
    twin_profile = data.get('twinProfile', '')
    task = evaluate_task(task, twin_profile, user_id=g.user_id)
    
    save_task_db(task, user_id=g.user_id)
    
    # Update Google Calendar event in background (non-blocking)
    threading.Thread(target=update_google_calendar_event, args=(task,), daemon=True).start()
    
    return jsonify(task)

@app.route('/api/tasks/<tid>', methods=['DELETE'])
def delete_task(tid):
    # Fetch category before deleting so we can remove the GCal event
    try:
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT category FROM tasks WHERE id=? AND user_id=?", (str(tid), g.user_id))
        row = cursor.fetchone()
        conn.close()
        cat_str = row[0] if row else ''
    except Exception:
        cat_str = ''
    delete_task_db(tid, user_id=g.user_id)
    # Delete Google Calendar event in background (non-blocking)
    threading.Thread(target=delete_google_calendar_event, args=(tid, cat_str), daemon=True).start()
    return '', 204

# --- Demo & Simulation Endpoints ---

@app.route('/api/tasks/pulse', methods=['POST'])
def run_pulse():
    """
    Reruns Risk Agent on all tasks using the current real time,
    simulating active observation.
    """
    try:
        data = request.get_json() or {}
        twin_profile = data.get('twinProfile', '')
        
        tasks_list = load_tasks_db(user_id=g.user_id)
        updated = []
        for t in tasks_list:
            t_eval = evaluate_task(t, twin_profile, is_pulse=True, user_id=g.user_id)
            save_task_db(t_eval, user_id=g.user_id)
            updated.append(t_eval)
        return jsonify(updated)
    except Exception as e:
        print(f"[pulse] Error: {e}", flush=True)
        return jsonify({"error": "Pulse evaluation failed", "detail": str(e)}), 500

@app.route('/api/tasks/simulate/time', methods=['POST'])
def simulate_time_passage():
    """
    Simulates +1 hour passage by subtracting 1 hour from task due dates
    and updates task risk scores dynamically.
    """
    data = request.get_json() or {}
    twin_profile = data.get('twinProfile', '')
    
    tasks_list = load_tasks_db(user_id=g.user_id)
    updated = []
    for t in tasks_list:
        due_str = t.get('due')
        if due_str:
            iso_clean = due_str.replace('Z', '+00:00')
            due_dt = datetime.datetime.fromisoformat(iso_clean)
            new_due_dt = due_dt - datetime.timedelta(hours=1)
            t['due'] = new_due_dt.isoformat().replace('+00:00', 'Z')
            
            t['delayCount'] = t.get('delayCount', 0) + 1
            t_eval = evaluate_task(t, twin_profile, user_id=g.user_id)
            
            events = t_eval.get('events', [])
            events.append({
                'timestamp': datetime.datetime.now().isoformat(),
                'agent': 'Risk Agent',
                'message': f"Time passage simulation: deadline advanced by 1 hour. Time remaining: {t_eval['riskAnalysis']['timeRemaining']}h."
            })
            t_eval['events'] = events
            
            save_task_db(t_eval, user_id=g.user_id)
            updated.append(t_eval)
        else:
            updated.append(t)
            
    return jsonify(updated)

@app.route('/api/tasks/simulate/collapse', methods=['POST'])
def simulate_collapse():
    """
    Forces all tasks (or creates one if empty) to collapse to black status
    for immediate voice demo testing.
    """
    data = request.get_json() or {}
    twin_profile = data.get('twinProfile', '')
    
    tasks_list = load_tasks_db(user_id=g.user_id)
    if not tasks_list:
        task_id = str(uuid.uuid4())
        mock_due = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat() + "Z"
        task = {
            'id': task_id,
            'user_id': g.user_id,
            'title': 'Hackathon Demo Submission',
            'due': mock_due,
            'estimatedHours': 6.0,
            'importance': 'high',
            'completed': False,
            'created': datetime.datetime.now().isoformat(),
            'timeline': generate_fallback_timeline('Hackathon Demo Submission', mock_due)
        }
        tasks_list.append(task)
        
    updated = []
    for t in tasks_list:
        t['survivalScore'] = 12
        t['escalationLevel'] = 'black'
        t['deadlineCollapse'] = True
        
        now = datetime.datetime.now()
        no_return_dt = now + datetime.timedelta(minutes=45)
        t['pointOfNoReturn'] = f"Today, {no_return_dt.strftime('%I:%M %p')}"
        
        t['scoreHistory'] = [74, 52, 38, 12]
        t['riskAnalysis'] = {
            'workRemaining': t.get('estimatedHours', 6.0),
            'timeRemaining': 1.0,
            'twinProcrastinationFactor': 15,
            'historyPenalty': 5
        }
        
        events = t.get('events', [])
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Intervention Agent',
            'message': 'Forced collapse simulation triggered by Operator. Active Intervention System voice warning broadcast triggered.'
        })
        t['events'] = events
        save_task_db(t, user_id=g.user_id)
        send_phone_notification(
            "Chronos CRITICAL: Deadline Collapse Detected (Simulated)",
            f"Task '{t.get('title')}' has collapsed! The deadline has passed."
        )
        updated.append(t)
        
    return jsonify(updated)


@app.route('/api/tasks/<tid>/acknowledge_collapse', methods=['POST'])
def acknowledge_collapse(tid):
    """
    User acknowledges a collapsed (dead) task.
    Deletes the task and increments the twin's failureCount (Nexus Events).
    """
    delete_task_db(tid, user_id=g.user_id)
    update_twin_metrics(failure_change=1, user_id=g.user_id)
    
    conn = get_db_conn()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM settings WHERE id = 'active_operator' AND user_id = ?", (g.user_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return jsonify(dict(row))
    return jsonify({"success": True})


@app.route('/api/tasks/<tid>/rescue', methods=['POST'])
def rescue_task(tid):
    """
    Recovery Agent: Rebuilds timeline with AI-generated recovery phases, calculates
    AI-driven Post-Recovery Success Forecast, and compiles AI checklist resources.
    """
    tasks_list = load_tasks_db(user_id=g.user_id)
    task = next((t for t in tasks_list if str(t['id']) == str(tid)), None)
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    data = request.get_json() or {}
    twin_profile = data.get('twinProfile', '')
    ai_config = data.get('aiConfig') or get_ai_config_from_db()

    task_title = task.get('title', 'Unknown Task')
    estimated_hours = float(task.get('estimatedHours', 2))
    importance = task.get('importance', 'medium')
    due_str = task.get('due', '')
    prev_survival = task.get('survivalScore', 12)
    task['survivalScoreBeforeRecovery'] = prev_survival

    now = datetime.datetime.now()

    # Compute hours remaining
    hours_remaining = 0
    if due_str:
        due_dt = parse_iso_to_local_naive(due_str)
        hours_remaining = max(0.0, (due_dt - now).total_seconds() / 3600.0)

    # --- AI-driven recovery checklist & forecast ---
    ai_checklist = None
    ai_forecast = None
    ai_starters = None
    ai_timeline = None
    ai_no_return_offset = None  # hours before due

    if ai_config and ai_config.get('apiKey'):
        # Extract intake summary details
        import json
        ai_summary = task.get('category', '')
        summary_text = ""
        if ai_summary:
            try:
                chat_history = json.loads(ai_summary)
                if isinstance(chat_history, list):
                    summary_text = "\n".join(f"{msg.get('role', 'user').capitalize()}: {msg.get('content', '')}" for msg in chat_history)
                else:
                    summary_text = str(ai_summary)
            except Exception:
                summary_text = str(ai_summary)

        ai_prompt = f"""You are the Chronos Recovery Agent. An operator's task deadline is in critical danger.

Task Title: "{task_title}"
Importance: {importance}
Estimated effort: {estimated_hours} hours
Hours remaining until deadline: {hours_remaining:.1f}h
Previous survival probability: {prev_survival}%
User profile: {twin_profile}
Intake summary brief: {summary_text}

Your goal is to formulate a high-impact recovery plan. 
For the "checklist", generate an array of 5 to 7 of the MOST heavy-weighted, highly effective subtasks/milestones that will contribute the most to the restoration of the success rate. 
Do not constrain yourself only to the user's task summary details. Instead, use your own deep domain expertise about this task topic/field. Think for yourself to define the absolute critical-path subgoals required to execute and deliver this topic under pressure.

Generate a recovery plan in JSON format with these exact keys:
- "checklist": array of 5-7 highly specific, actionable, heavy-weighted subtask strings based on the task topic
- "starters": array of 2 strings with starter resources or templates relevant to this task
- "recoveryProbability": integer (0-100) representing the post-recovery success probability if user follows the checklist
- "recoveryPhases": array of 3 objects with keys "title" (specific action) and "scheduledTime" (e.g. "Immediately", "In 30 mins", "In 90 mins")
- "pointOfNoReturnHours": float representing how many hours before the deadline is the absolute point of no return for this task

Respond ONLY with the raw JSON object. No markdown, no explanation."""

        reply = query_ai_direct(
            ai_config.get('provider', 'gemini'),
            ai_config.get('apiUrl'),
            ai_config.get('apiKey'),
            ai_config.get('model'),
            [{"role": "user", "content": ai_prompt}],
            timeout=25
        )
        if reply:
            try:
                content = reply.strip()
                if '```' in content:
                    parts = content.split('```')
                    for part in parts:
                        stripped = part.strip()
                        if stripped.startswith('json'):
                            stripped = stripped[4:].strip()
                        if stripped.startswith('{'):
                            content = stripped
                            break
                parsed = json.loads(content)
                ai_checklist = parsed.get('checklist')
                ai_starters = parsed.get('starters')
                ai_forecast = parsed.get('recoveryProbability')
                recovery_phases = parsed.get('recoveryPhases')
                ai_no_return_offset = parsed.get('pointOfNoReturnHours')

                if isinstance(recovery_phases, list) and len(recovery_phases) >= 3:
                    ai_timeline = []
                    for i, ph in enumerate(recovery_phases[:3]):
                        ai_timeline.append({
                            "id": f"r{i+1}",
                            "title": ph.get("title", f"Recovery Phase {i+1}"),
                            "status": "pending",
                            "scheduledTime": ph.get("scheduledTime", "")
                        })
            except Exception as e:
                print(f"[rescue_task] Failed to parse AI response: {e}", flush=True)

    # Fallback values if AI fails
    rebuild_dt = now + datetime.timedelta(minutes=15)
    rebuild_time = rebuild_dt.strftime("%I:%M %p")

    new_timeline = ai_timeline or [
        {"id": "r1", "title": f"Recovery Phase 1: Emergency outline & core structure for '{task_title}'", "status": "pending", "scheduledTime": f"Immediate ({rebuild_time})"},
        {"id": "r2", "title": f"Recovery Phase 2: Rapid core execution with 25-minute focused sprints", "status": "pending", "scheduledTime": "Today, 45 mins later"},
        {"id": "r3", "title": f"Recovery Phase 3: Final review, polish, and secure submission", "status": "pending", "scheduledTime": "Today, 90 mins later"}
    ]
    task['timeline'] = new_timeline

    post_recovery_score = int(ai_forecast) if ai_forecast is not None else min(78, prev_survival + 40)
    post_recovery_score = max(10, min(95, post_recovery_score))
    task['survivalScore'] = post_recovery_score
    task['recoveryForecast'] = post_recovery_score
    task['escalationLevel'] = 'yellow'
    task['deadlineCollapse'] = False

    # Point of no return
    if due_str:
        try:
            due_dt = parse_iso_to_local_naive(due_str)
            offset_hours = float(ai_no_return_offset) if ai_no_return_offset else estimated_hours * 1.5
            new_no_return_dt = due_dt - datetime.timedelta(hours=offset_hours)
            diff_days = (new_no_return_dt.date() - now.date()).days
            time_part = new_no_return_dt.strftime("%I:%M %p")
            if diff_days == 0:
                task['newPointOfNoReturn'] = f"Today, {time_part}"
            elif diff_days == 1:
                task['newPointOfNoReturn'] = f"Tomorrow, {time_part}"
            elif diff_days < 0:
                task['newPointOfNoReturn'] = "Passed"
            else:
                task['newPointOfNoReturn'] = f"{new_no_return_dt.strftime('%d %b')}, {time_part}"
        except Exception:
            task['newPointOfNoReturn'] = "Extended"
    else:
        task['newPointOfNoReturn'] = "Extended"

    checklist = ai_checklist or [
        f"Block all distractions and open your primary workspace for '{task_title}'",
        "Write out the minimum viable version of this task on paper or doc",
        "Set a 25-minute sprint timer and begin the first critical section",
        "At the halfway mark, re-evaluate scope and cut any non-essential parts",
        "Submit a complete (not perfect) version before the deadline"
    ]

    starters = ai_starters or [
        f"Outline Template: Introduction → Core Work → Review → Submission for '{task_title}'",
        "Focus Strategy: Pomodoro sprints (25 min work / 5 min break cycles)"
    ]

    task['rescueResources'] = {
        'recoveryProbability': post_recovery_score,
        'checklist': checklist,
        'starters': starters
    }

    events = task.get('events', [])
    events.append({
        'timestamp': now.isoformat(),
        'agent': 'Recovery Agent',
        'message': f"AI Recovery protocol generated. Rebuilt mission timeline. Success Forecast: {prev_survival}% → {post_recovery_score}%."
    })
    task['events'] = events

    save_task_db(task, user_id=g.user_id)
    return jsonify(task)


@app.route('/api/tasks/<tid>/complete_sprint', methods=['POST'])
def complete_sprint(tid):
    """
    Finalizes a task or checkpoint sprint, recording actual vs estimated hours,
    triggering the AI twin to analyze efficiency patterns and adjust settings.
    """
    tasks_list = load_tasks_db(user_id=g.user_id)
    task = next((t for t in tasks_list if str(t['id']) == str(tid)), None)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
        
    data = request.get_json() or {}
    actual_hours = float(data.get('actualHours', 1.0))
    estimated_hours = float(data.get('estimatedHours', 1.0))
    checkpoint_id = data.get('checkpointId')
    ai_config = data.get('aiConfig') or get_ai_config_from_db()
    
    # Parse category JSON
    category_data = {}
    if task.get('category'):
        try:
            category_data = json.loads(task['category'])
            if not isinstance(category_data, dict):
                category_data = {"aiSummary": category_data, "completedCheckpoints": []}
        except Exception:
            category_data = {"aiSummary": [], "completedCheckpoints": []}
    else:
        category_data = {"aiSummary": [], "completedCheckpoints": []}
        
    if "completedCheckpoints" not in category_data:
        category_data["completedCheckpoints"] = []
        
    # Load settings from SQLite settings
    conn = get_db_conn()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT twinProfile, procrastinationRating FROM settings WHERE id = 'active_operator' AND user_id = ?", (g.user_id,))
    row = cursor.fetchone()
    conn.close()
    
    twin_profile = ""
    procrastination_rating = 8.0
    if row:
        twin_profile = row['twinProfile'] or ""
        procrastination_rating = float(row['procrastinationRating'] or 8.0)
        
    if checkpoint_id:
        if checkpoint_id not in category_data["completedCheckpoints"]:
            category_data["completedCheckpoints"].append(checkpoint_id)
        task['category'] = json.dumps(category_data)
        
        # Add checkpoint completion event
        events = task.get('events', [])
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Execution Agent',
            'message': f"Checkpoint {checkpoint_id} completed. Actual: {actual_hours:.2f}h vs Estimated: {estimated_hours:.2f}h."
        })
        task['events'] = events
    else:
        # Complete task overall
        task['completed'] = True
        task['survivalScore'] = 100
        task['pointOfNoReturn'] = "Deadline Secure"
        task['escalationLevel'] = 'green'
        
        # Add completion event
        events = task.get('events', [])
        events.append({
            'timestamp': datetime.datetime.now().isoformat(),
            'agent': 'Execution Agent',
            'message': f"Task fully completed. Actual: {actual_hours:.2f}h vs Estimated: {estimated_hours:.2f}h."
        })
        task['events'] = events
        
        # Update settings twin metrics
        update_twin_metrics(completed_change=1, user_id=g.user_id)
        
    # AI Learning and Optimizing:
    # Query AI to update user's digital twin profile based on execution performance!
    new_twin_profile = twin_profile
    new_procrastination_rating = procrastination_rating
    
    if ai_config and ai_config.get('apiKey'):
        try:
            analysis_prompt = (
                f"The user Akash has completed a session for task: '{task['title']}'\n"
                f"Session details:\n"
                f"- Segment completed: {'Checkpoint ' + checkpoint_id if checkpoint_id else 'Full Task'}\n"
                f"- Original Estimated Time: {estimated_hours:.2f} hours\n"
                f"- Actual Time Taken: {actual_hours:.2f} hours\n"
                f"Current User Digital Twin Profile:\n\"{twin_profile}\"\n"
                f"Current Procrastination Rating: {procrastination_rating}/10\n\n"
                f"Instructions:\n"
                f"1. Analyze their efficiency. Did they finish faster (highly focused, low delay) or slower (procrastination, scope creep, blocker)?\n"
                f"2. Provide an updated User Digital Twin Profile keeping a clear bullet-pointed structure. Reflect their focus stamina, delay triggers, and learning dynamics.\n"
                f"3. Provide an updated Procrastination Rating between 1.0 (extremely proactive/fast) and 10.0 (high latency/procrastination).\n"
                f"4. Respond with ONLY a raw JSON object containing these keys:\n"
                f"   - \"twinProfile\": string containing the updated profile content\n"
                f"   - \"procrastinationRating\": float (1.0 to 10.0)\n"
                f"No markdown blocks, no extra text."
            )
            
            reply = query_ai_direct(
                ai_config.get('provider', 'gemini'),
                ai_config.get('apiUrl'),
                ai_config.get('apiKey'),
                ai_config.get('model'),
                [{"role": "user", "content": analysis_prompt}],
                timeout=20
            )
            
            if reply:
                content = reply.strip()
                if '```' in content:
                    parts = content.split('```')
                    for part in parts:
                        stripped = part.strip()
                        if stripped.startswith('json'):
                            stripped = stripped[4:].strip()
                        if stripped.startswith('{'):
                            content = stripped
                            break
                parsed = json.loads(content)
                if 'twinProfile' in parsed:
                    new_twin_profile = parsed['twinProfile']
                if 'procrastinationRating' in parsed:
                    new_procrastination_rating = float(parsed['procrastinationRating'])
                    
                # Save new settings to DB
                conn = get_db_conn()
                cursor = conn.cursor()
                cursor.execute("UPDATE settings SET twinProfile = ?, procrastinationRating = ? WHERE id = 'active_operator' AND user_id = ?", (new_twin_profile, new_procrastination_rating, g.user_id))
                conn.commit()
                conn.close()
        except Exception as e:
            print(f"[Complete Sprint AI learning failed] {e}", flush=True)
            
    # Save task
    save_task_db(task, user_id=g.user_id)
    
    return jsonify({
        "success": True, 
        "task": task, 
        "previousTwin": twin_profile, 
        "newTwin": new_twin_profile,
        "previousRating": procrastination_rating,
        "newRating": new_procrastination_rating
    })



@app.route('/api/recovery/status', methods=['GET'])
def recovery_status():
    task_id = request.args.get('taskId')
    if not task_id:
        return jsonify({'error': 'taskId is required'}), 400
        
    tasks_list = load_tasks_db(user_id=g.user_id)
    task = next((t for t in tasks_list if str(t['id']) == str(task_id)), None)
    if not task:
        # Task not found (e.g. after page refresh before DB sync) — return a generic fallback
        # so the RecoveryCommandCenter can still load instead of showing a 404 error.
        return jsonify({
            'severity': 'HIGH',
            'severityColor': 'text-orange-400',
            'temporalDebtHours': 0,
            'temporalDebtDays': 0,
            'riskBefore': 50,
            'riskAfter': 22,
            'progress': 0,
            'checklist': [
                'Open your primary workspace and clear all distractions',
                'Write the minimum viable outline for this task',
                'Set a 25-minute focused sprint timer and begin immediately',
                'At the halfway mark, re-evaluate scope and cut non-essential parts',
                'Submit a complete (not perfect) version before the deadline'
            ]
        })

        
    # Re-calculate work hours left to get current temporal debt
    due_str = task.get('due')
    estimated_hours = float(task.get('estimatedHours', 2))
    work_hours_left = estimated_hours
    
    if due_str:
        now = datetime.datetime.now()
        due = parse_iso_to_local_naive(due_str)
        real_time_diff = due - now
        real_hours_left = real_time_diff.total_seconds() / 3600.0
        
        sleep_start = 23
        sleep_end = 7
        settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
        if os.path.exists(settings_file):
            try:
                with open(settings_file, 'r') as f:
                    cfg = json.load(f)
                    sleep_start = int(cfg.get('sleepStart', 23))
                    sleep_end = int(cfg.get('sleepEnd', 7))
            except Exception:
                pass
                
        sleep_hours = get_sleep_hours_between(now, due, sleep_start, sleep_end)
        work_hours_left = max(0.1, real_hours_left - sleep_hours)
            
    temporal_debt_hours = max(0.0, estimated_hours - work_hours_left)
    temporal_debt_days = temporal_debt_hours / 8.0
    
    # Severity mapping
    escalation = task.get('escalationLevel', 'yellow')
    if escalation == 'green':
        severity = 'LOW'
        severity_color = 'text-green-400'
    elif escalation == 'yellow':
        severity = 'MEDIUM'
        severity_color = 'text-yellow-400'
    elif escalation == 'orange':
        severity = 'HIGH'
        severity_color = 'text-orange-400'
    else:
        severity = 'CRITICAL'
        severity_color = 'text-red-400'
        
    # Risk projection
    survival_before = task.get('survivalScoreBeforeRecovery')
    if survival_before is None:
        survival_before = max(5, int((work_hours_left / estimated_hours) * 50))
        survival_before = min(98, survival_before)
        
    risk_before = 100 - survival_before
    risk_after = 100 - task.get('survivalScore', 78)
    
    # Checklist - generate task-specific recovery plan
    rescue_resources = task.get('rescueResources') or {}
    checklist = rescue_resources.get('checklist')
    if not checklist:
        task_title = task.get('title', 'Unknown Task')
        est_hours = task.get('estimatedHours', 2)
        checklist = [
            f"Analyze remaining work for '{task_title}' ({est_hours}h estimated)",
            f"Break down '{task_title}' into 2-3 micro-steps for immediate execution",
            f"Block 90-minute focused window for '{task_title}' core effort",
            f"Skip non-essential refinements to meet deadline on '{task_title}'",
            f"Submit '{task_title}' at minimum viable quality"
        ]
    
    return jsonify({
        'severity': severity,
        'severityColor': severity_color,
        'temporalDebtHours': round(temporal_debt_hours, 1),
        'temporalDebtDays': round(temporal_debt_days, 1),
        'riskBefore': risk_before,
        'riskAfter': risk_after,
        'progress': 0,
        'checklist': checklist
    })

@app.route('/api/recovery/complete', methods=['POST'])
def recovery_complete():
    data = request.get_json() or {}
    task_id = data.get('taskId')
    if not task_id:
        return jsonify({'error': 'taskId is required'}), 400
        
    tasks_list = load_tasks_db(user_id=g.user_id)
    task = next((t for t in tasks_list if str(t['id']) == str(task_id)), None)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
        
    # Mark task as completed
    task['completed'] = True
    task['survivalScore'] = 100
    task['escalationLevel'] = 'green'
    task['deadlineCollapse'] = False
    task['pointOfNoReturn'] = "Deadline Secure"
    
    # Calculate stats for the completion banner
    recovered_hours = float(task.get('estimatedHours', 2))
    
    # Update SQLite twin metrics
    update_twin_metrics(completed_change=1, recovered_hours_change=recovered_hours, user_id=g.user_id)
    
    # Calculate streak from SQLite settings
    streak_count = 1
    try:
        conn = get_db_conn()
        cursor = conn.cursor()
        cursor.execute("SELECT streakCount FROM settings WHERE id = 'active_operator' AND user_id = ?", (g.user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            streak_count = int(row[0])
    except Exception:
        # Fallback calculation
        completed_tasks = [t for t in tasks_list if t.get('completed')]
        streak_count = len(completed_tasks) + 1
    
    # Confidence boost
    survival_before = task.get('survivalScoreBeforeRecovery')
    if survival_before is None:
        survival_before = 12
    risk_before = 100 - survival_before
    risk_after = 22
    confidence_boost = max(10, risk_before - risk_after)
    
    events = task.get('events', [])
    events.append({
        'timestamp': datetime.datetime.now().isoformat(),
        'agent': 'Recovery Agent',
        'message': "Recovery protocol completed. Task successfully secured."
    })
    task['events'] = events
    
    save_task_db(task, user_id=g.user_id)
    
    return jsonify({
        'success': True,
        'recoveredHours': recovered_hours,
        'streakCount': streak_count,
        'confidenceBoost': confidence_boost
    })

# --- AI Core endpoints ---

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    data = request.get_json() or {}
    provider = data.get('provider', 'gemini')
    api_url = data.get('apiUrl')
    api_key = data.get('apiKey')
    model = data.get('model')
    messages = data.get('messages', [])

    try:
        if provider == 'gemini':
            active_key = api_key or os.environ.get('GEMINI_API_KEY')
            if active_key:
                api_key = active_key
            
            contents = []
            system_instruction = None
            
            for msg in messages:
                role = msg.get('role')
                content = msg.get('content', '')
                if role == 'system':
                    system_instruction = content
                elif role == 'user':
                    contents.append({
                        "role": "user",
                        "parts": [{"text": content}]
                    })
                elif role == 'assistant':
                    contents.append({
                        "role": "model",
                        "parts": [{"text": content}]
                    })
            
            gemini_model = model or 'gemini-1.5-flash'
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent"
            
            payload = {"contents": contents}
            if system_instruction:
                payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
            
            payload["generationConfig"] = {"temperature": 0.7}
            
            response = requests.post(url, json=payload, headers={"X-Goog-Api-Key": api_key, "Content-Type": "application/json"}, timeout=90)
            response.raise_for_status()
            res_data = response.json()
            
            try:
                content = res_data['candidates'][0]['content']['parts'][0]['text']
            except (KeyError, IndexError):
                content = f"Error parsing Gemini response: {res_data}"
                
            return jsonify({'content': content})
            
        elif provider == 'nvidia':
            url = f"{api_url.rstrip('/') if api_url else 'https://integrate.api.nvidia.com/v1'}/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model or "meta/llama-3.1-8b-instruct",
                "messages": messages,
                "temperature": 0.5,
                "max_tokens": 1024,
                "stream": False
            }
            response = requests.post(url, json=payload, headers=headers, timeout=90)
            response.raise_for_status()
            res_data = response.json()
            content = res_data.get('choices', [{}])[0].get('message', {}).get('content', '')
            return jsonify({'content': content})

        elif provider == 'custom':
            if not api_url:
                return jsonify({'error': 'Base URL is required for custom provider'}), 400
            url = f"{api_url.rstrip('/')}/chat/completions"
            headers = {"Content-Type": "application/json"}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            payload = {
                "model": model,
                "messages": messages,
                "temperature": 0.7,
                "stream": False
            }
            response = requests.post(url, json=payload, headers=headers, timeout=90)
            response.raise_for_status()
            res_data = response.json()
            content = res_data.get('choices', [{}])[0].get('message', {}).get('content', '')
            return jsonify({'content': content})
            
        else:
            return jsonify({'error': 'Invalid provider'}), 400
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/ai/chat/stream', methods=['POST'])
def ai_chat_stream():
    data = request.get_json() or {}
    provider = data.get('provider', 'nvidia')
    api_url = data.get('apiUrl')
    api_key = data.get('apiKey')
    model = data.get('model')
    messages = data.get('messages', [])

    if provider != 'nvidia':
        return jsonify({'error': 'Streaming is only supported with NVIDIA provider'}), 400
    if not api_key:
        return jsonify({'error': 'API key is required'}), 400

    url = f"{api_url.rstrip('/') if api_url else 'https://integrate.api.nvidia.com/v1'}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model or "meta/llama-3.1-8b-instruct",
        "messages": messages,
        "temperature": 0.5,
        "max_tokens": 1024,
        "stream": True
    }

    def generate():
        try:
            resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=120)
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                decoded = line.decode('utf-8')
                if decoded.startswith('data: '):
                    chunk = decoded[6:]
                    if chunk.strip() == '[DONE]':
                        break
                    yield f"data: {chunk}\n\n"
        except Exception as e:
            yield f"data: {{\"error\": \"{str(e)}\"}}\n\n"
        yield "data: [DONE]\n\n"

    return Response(generate(), mimetype='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
    })

@app.route('/api/voice/query', methods=['POST'])
def voice_query():
    data = request.get_json() or {}
    query_text = data.get("query", "").strip()
    if not query_text:
        return jsonify({"error": "Empty query"}), 400
        
    try:
        username = "operator"
        twin_profile = ""
        conn = get_db_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator' AND user_id = ?", (g.user_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            row_dict = dict(row)
            username = row_dict.get("username", "operator")
            twin_profile = row_dict.get("twinProfile", "")
            
        tasks = load_tasks_db(user_id=g.user_id)
        active_tasks = [t for t in tasks if not t.get('completed', False)]
        tasks_info = ""
        if active_tasks:
            tasks_info = " Active tasks: " + ", ".join([
                f"'{t['title']}' (Score: {t['survivalScore']}%, due: {t.get('due')}, est hours: {t.get('estimatedHours')}h)"
                for t in active_tasks
            ]) + "."
            
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
            
        global voice_conversation_history
        voice_conversation_history.append({"role": "user", "content": query_text})
        if len(voice_conversation_history) > 10:
            voice_conversation_history = voice_conversation_history[-10:]
            
        ai_config = get_ai_config_from_db()
        provider = ai_config.get('provider', 'gemini')
        model = ai_config.get('model', 'gemini-1.5-flash')
        api_url = ai_config.get('apiUrl')
        api_key = ai_config.get('apiKey')
        
        # If API key is not configured for Gemini, fall back to environment variable
        if provider == 'gemini' and not api_key:
            api_key = os.environ.get("GEMINI_API_KEY")
        
        messages = [{"role": "system", "content": system_prompt}]
        for msg in voice_conversation_history:
            messages.append({"role": msg["role"], "content": msg["content"]})
            
        reply = query_ai_direct(provider, api_url, api_key, model, messages, timeout=15)
        if not reply:
            reply = "Tactical coordinator link offline. Manual input requested."
            
        voice_conversation_history.append({"role": "assistant", "content": reply})
        return jsonify({"content": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/ai/models', methods=['GET', 'POST'])
def list_models():
    if request.method == 'POST':
        body = request.get_json() or {}
        provider = body.get('provider', 'gemini')
        api_url = body.get('apiUrl', '')
        api_key = body.get('apiKey', '')
    else:
        provider = request.args.get('provider', 'gemini')
        api_url = request.headers.get('X-Api-Url', '')
        api_key = request.headers.get('X-Api-Key', '')
        # Fallback to query params for backward compat (with deprecation notice)
        if not api_key:
            api_key = request.args.get('apiKey', '')
    
    if provider == 'gemini':
        default_gemini_models = [
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-2.5-flash',
            'gemini-2.5-pro'
        ]
        if not api_key or not api_key.strip():
            return jsonify({'models': default_gemini_models, 'offline': True})
            
        url = "https://generativelanguage.googleapis.com/v1beta/models"
        try:
            response = requests.get(url, headers={"X-Goog-Api-Key": api_key.strip()}, timeout=3)
            if response.status_code == 200:
                data = response.json()
                models = [m['name'].split('/')[-1] for m in data.get('models', []) if 'gemini' in m.get('name', '').lower()]
                if models:
                    return jsonify({'models': models, 'offline': False})
                return jsonify({'models': default_gemini_models, 'offline': False})
        except Exception:
            pass
        return jsonify({'models': default_gemini_models, 'offline': True})
        
    elif provider == 'nvidia':
        # Whitelisted models only — no live API fetch to prevent overrides
        nim_models = [
            'meta/llama-3.1-8b-instruct',
            'meta/llama-3.3-70b-instruct'
        ]
        return jsonify({'models': nim_models, 'offline': False})

    elif provider == 'custom':
        if not api_url:
            return jsonify({'models': [], 'offline': True})
        url = f"{api_url.rstrip('/')}/models"
        headers = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        try:
            response = requests.get(url, headers=headers, timeout=4)
            if response.status_code == 200:
                data = response.json()
                models = [m['id'] for m in data.get('data', [])]
                if models:
                    return jsonify({'models': models, 'offline': False})
        except Exception:
            pass
        return jsonify({'models': [], 'offline': True})
        
# --- Voice Assistant Integration API & SSE ---

@app.route('/api/voice/events')
def voice_events():
    def event_stream():
        q = queue.Queue()
        with voice_clients_lock:
            voice_clients.append(q)
        # Send an initial ping to establish connection
        q.put({"status": "connected"})
        try:
            while True:
                data = q.get()
                yield f"data: {json.dumps(data)}\n\n"
        finally:
            with voice_clients_lock:
                try:
                    voice_clients.remove(q)
                except ValueError:
                    pass
    return Response(event_stream(), mimetype="text/event-stream")

@app.route('/api/voice/trigger', methods=['POST'])
def voice_trigger():
    data = request.get_json() or {}
    # Broadcast voice event to all connected clients
    for q in list(voice_clients):
        q.put(data)
    return jsonify({"status": "success"})

@app.route('/api/voice/briefing', methods=['POST'])
def voice_briefing():
    import datetime as dt_mod
    global last_voice_event_speak_time
    
    # Check if a briefing was already spoken today
    global last_briefing_date
    if 'last_briefing_date' not in globals():
        globals()['last_briefing_date'] = None
        
    current_date = dt_mod.date.today()
    if globals()['last_briefing_date'] == current_date:
        return jsonify({"status": "already_briefed"})
        
    globals()['last_briefing_date'] = current_date
    
    tasks = load_tasks_db(user_id=g.user_id)
    active_tasks = [t for t in tasks if not t.get('completed', False)]
    count = len(active_tasks)
    
    total_hours = sum(t.get('estimatedHours', 0.0) for t in active_tasks)
    hours = int(total_hours)
    minutes = int((total_hours - hours) * 60)
    
    urgency_needed = any(t.get('escalationLevel', 'green') in ['yellow', 'orange', 'red', 'black'] for t in active_tasks)
    
    time_str = ""
    if hours > 0:
        time_str += f"{hours} hour{'s' if hours > 1 else ''}"
    if minutes > 0:
        if time_str:
            time_str += f" and "
        time_str += f"{minutes} minute{'s' if minutes > 1 else ''}"
    if not time_str:
        time_str = "zero minutes"
        
    briefing_text = f"Good morning. You have {count} active mission{'s' if count != 1 else ''}. "
    if urgency_needed:
        briefing_text += "One requires immediate attention. "
    briefing_text += f"Estimated focused work today is {time_str}."
    
    speech_queue.put(briefing_text)
    last_voice_event_speak_time = time.time()
    
    return jsonify({"status": "briefed", "text": briefing_text})

@app.route('/api/voice/speak', methods=['POST'])
def voice_speak():
    global voice_muted, voice_muted_until
    data = request.get_json() or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "Empty text"}), 400
        
    # Check if voice is muted
    is_muted = voice_muted and (time.time() < voice_muted_until)
    if is_muted:
        print(f"[Voice Speak Bypassed] Voice link is muted. Skipping: '{text}'")
        return jsonify({"status": "muted", "reason": "Voice is muted"})
        
    # Queue the speech item
    speech_queue.put(text)
    return jsonify({"status": "queued"})

@app.route('/api/voice/stop', methods=['POST'])
def voice_stop():
    global is_speaking
    with is_speaking_lock:
        is_speaking = False
    # Clear speech queue
    with speech_queue.mutex:
        speech_queue.queue.clear()
        
    # 3. Broadcast status update
    data = request.get_json() or {}
    new_status = data.get("status", "idle")
    broadcast_status(new_status, data.get("text", "Chronos Voice Link: Sync Active."))
    
    return jsonify({"status": "stopped"})

@app.route('/api/voice/ping', methods=['POST'])
def voice_ping():
    global last_voice_link_ping
    last_voice_link_ping = time.time()
    return jsonify({"status": "acknowledged"})

@app.route('/api/voice/status', methods=['GET'])
def voice_status():
    global is_speaking, last_voice_link_ping
    now = time.time()
    last_seen = int(now - last_voice_link_ping) if last_voice_link_ping > 0 else -1
    is_online = last_seen >= 0 and last_seen < 40.0
    return jsonify({
        "voice_link": "online" if is_online else "offline",
        "last_seen_seconds": last_seen,
        "server": "online",
        "is_speaking": is_speaking
    })

@app.route('/api/voice/config', methods=['GET'])
def voice_config():
    """Returns config the voice daemon needs: Google API key + backend URL."""
    settings = {}
    settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
    if os.path.exists(settings_file):
        try:
            with open(settings_file, 'r') as f:
                settings = json.load(f)
        except Exception:
            pass
    google_api_key = settings.get('googleApiKey', os.environ.get('GOOGLE_API_KEY', ''))
    backend_url = os.environ.get('BACKEND_URL', request.host_url.rstrip('/'))
    return jsonify({"googleApiKey": google_api_key, "backendUrl": backend_url, "userId": g.user_id})

@app.route('/api/voice/mute', methods=['POST'])
def mute_voice():
    global voice_muted, voice_muted_until
    data = request.get_json() or {}
    duration = data.get('duration', 600)  # default 10 minutes (600s)
    voice_muted = True
    voice_muted_until = time.time() + duration
    
    # Broadcast mute event to clients
    broadcast_status("warning", "Chronos Voice Link: Reminders Muted.")
    return jsonify({"muted": True, "muted_until": voice_muted_until})

@app.route('/api/voice/unmute', methods=['POST'])
def unmute_voice():
    global voice_muted, voice_muted_until
    voice_muted = False
    voice_muted_until = 0.0
    broadcast_status("idle", "Chronos Voice Link: Sync Active.")
    return jsonify({"muted": False})

@app.route('/api/voice/mute-status', methods=['GET'])
def mute_status():
    global voice_muted, voice_muted_until
    is_muted = voice_muted and (time.time() < voice_muted_until)
    remaining = max(0, int(voice_muted_until - time.time())) if voice_muted else 0
    return jsonify({
        "muted": is_muted,
        "remaining_seconds": remaining
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    ai_online = False
    try:
        settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
        if os.path.exists(settings_file):
            with open(settings_file, 'r') as f:
                cfg = json.load(f)
            api_key = cfg.get('aiApiKey', '')
            if api_key:
                ai_online = True
    except Exception:
        pass
    db_online = True
    try:
        conn = get_db_conn()
        conn.execute("SELECT 1")
        conn.close()
    except Exception:
        db_online = False
    voice_online = (time.time() - last_voice_link_ping) < 40.0 if last_voice_link_ping > 0 else False
    return jsonify({
        "ai_online": ai_online,
        "db_online": db_online,
        "voice_online": voice_online
    })

@app.route('/api/bootstrap', methods=['GET'])
def bootstrap():
    user_id = g.user_id
    settings_data = {}
    try:
        conn = get_db_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator' AND user_id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            settings_data = dict(row)
        settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
        if os.path.exists(settings_file):
            with open(settings_file, 'r') as f:
                file_settings = json.load(f)
            for k, v in file_settings.items():
                if k not in settings_data or settings_data[k] is None or settings_data[k] == '':
                    settings_data[k] = v
    except Exception:
        pass

    tasks = load_tasks_db(user_id=user_id)

    memory = get_memory_summary(user_id)

    ai_online = False
    try:
        api_key = settings_data.get('aiApiKey', '')
        if api_key:
            ai_online = True
    except Exception:
        pass
    db_online = True
    voice_online = (time.time() - last_voice_link_ping) < 40.0 if last_voice_link_ping > 0 else False
    health = {"ai_online": ai_online, "db_online": db_online, "voice_online": voice_online}

    profile = {
        "username": settings_data.get('username', 'user'),
        "twinProfile": settings_data.get('twinProfile', ''),
        "procrastinationRating": settings_data.get('procrastinationRating', 8.0),
        "attentionCycle": settings_data.get('attentionCycle', ''),
        "stressResponse": settings_data.get('stressResponse', ''),
        "executionCount": settings_data.get('executionCount', 0),
        "failureCount": settings_data.get('failureCount', 0),
        "streakCount": settings_data.get('streakCount', 0),
        "totalRecoveredHours": settings_data.get('totalRecoveredHours', 0.0),
        "aiProvider": settings_data.get('aiProvider', 'gemini'),
        "aiModel": settings_data.get('aiModel', 'gemini-1.5-flash'),
    }

    return jsonify({
        "settings": settings_data,
        "tasks": tasks,
        "memory": memory,
        "health": health,
        "profile": profile,
    })


# ── Memory API ─────────────────────────────────────────────────

@app.route('/api/memory', methods=['GET'])
def memory_get_all():
    layer = request.args.get('layer')
    return jsonify(get_memory(g.user_id, layer))


@app.route('/api/memory/<layer>', methods=['POST'])
def memory_upsert(layer):
    if layer not in ALL_LAYERS:
        return jsonify({"error": f"Invalid layer. Must be one of: {', '.join(ALL_LAYERS)}"}), 400
    data = request.get_json() or {}
    key = data.get('key')
    value = data.get('value')
    source = data.get('source', 'user')
    if not key:
        return jsonify({"error": "key is required"}), 400
    result = upsert_memory(g.user_id, layer, key, value, source)
    return jsonify(result)


@app.route('/api/memory/<layer>/<key>', methods=['DELETE'])
def memory_delete(layer, key):
    if layer not in ALL_LAYERS:
        return jsonify({"error": "Invalid layer"}), 400
    delete_memory(g.user_id, layer, key)
    return '', 204


@app.route('/api/memory/timeline', methods=['GET'])
def memory_timeline():
    limit = int(request.args.get('limit', 50))
    offset = int(request.args.get('offset', 0))
    return jsonify(get_timeline(g.user_id, limit, offset))


@app.route('/api/memory/learn', methods=['POST'])
def memory_learn():
    data = request.get_json() or {}
    text = data.get('text', '').strip()
    if not text:
        return jsonify({"error": "text is required"}), 400
    source = data.get('source', 'conversation')

    ai_config = get_ai_config_from_db()
    if ai_config and ai_config.get('apiKey'):
        prompt = (
            f"Analyze this user statement and extract up to 3 important memory entries. "
            f"For each entry, determine the appropriate memory layer from: "
            f"{', '.join(ALL_LAYERS)}. "
            f"Output a JSON array of objects with keys: 'layer', 'key', 'value'. "
            f"Only include truly meaningful information (preferences, goals, patterns, facts). "
            f"Respond with ONLY the JSON array, no other text.\n\n"
            f"User statement: {text}"
        )
        try:
            reply = query_ai_direct(
                ai_config.get('provider', 'gemini'),
                ai_config.get('apiUrl', ''),
                ai_config.get('apiKey', ''),
                ai_config.get('model', 'gemini-1.5-flash'),
                [{"role": "user", "content": prompt}],
                timeout=10
            )
            if reply:
                content = reply.strip()
                if '```' in content:
                    parts = content.split('```')
                    for part in parts:
                        s = part.strip().replace('json', '').strip()
                        if s.startswith('['):
                            content = s
                            break
                entries = json.loads(content)
                if isinstance(entries, list):
                    saved = []
                    for entry in entries:
                        if entry.get('layer') in ALL_LAYERS and entry.get('key'):
                            result = upsert_memory(g.user_id, entry['layer'], entry['key'], entry.get('value', ''), source)
                            saved.append(result)
                    return jsonify({"saved": saved, "count": len(saved)})
        except Exception as e:
            print(f"[Memory Learn] AI extraction failed: {e}", flush=True)

    return jsonify({"saved": [], "count": 0})


@app.route('/api/phone/test', methods=['POST'])
def test_phone_notification():
    data = request.get_json() or {}
    topic = data.get('ntfyTopic')
    if not topic:
        return jsonify({"error": "Topic name is required"}), 400
        
    url = f"https://ntfy.sh/{topic}"
    headers = {
        "Title": "Chronos Synchronization",
        "Priority": "high",
        "Tags": "incoming_envelope,lock"
    }
    try:
        session = requests.Session()
        session.trust_env = False
        res = session.post(
            url, 
            data="Chronos Phone Link successfully verified! Real-time telemetry alerts are now active.".encode('utf-8'), 
            headers=headers, 
            proxies={}, 
            timeout=10
        )
        if res.status_code == 200:
            return jsonify({"status": "success", "message": "Verification notification dispatched successfully!"})
        else:
            return jsonify({"error": f"Failed to reach notification broker: HTTP {res.status_code}"}), 502
    except Exception as e:
        return jsonify({"error": f"Network error: {str(e)}"}), 500

@app.route('/api/sprint/status', methods=['POST'])
def update_sprint_status():
    data = request.get_json() or {}
    uid = getattr(g, 'user_id', 'anonymous')
    with active_sprints_lock:
        active_sprints[uid] = {
            "task_id": data.get("taskId"),
            "checkpoint_id": data.get("checkpointId"),
            "active": bool(data.get("active", False)),
            "paused": bool(data.get("paused", False)),
            "duration": int(data.get("duration", 0)),
            "seconds_left": int(data.get("secondsLeft", 0)),
            "last_updated": time.time()
        }
    return jsonify({"status": "updated"})

@app.route('/api/sprint/status', methods=['GET'])
def get_sprint_status():
    uid = getattr(g, 'user_id', 'anonymous')
    with active_sprints_lock:
        sprint = active_sprints.get(uid, {"active": False})
    return jsonify(sprint)

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
    conn = get_db_conn()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if request.method == 'POST':
        data = request.get_json() or {}
        
        # Load existing row first to merge fields (e.g. keep streak/counts if not passed)
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator' AND user_id = ?", (g.user_id,))
        row = cursor.fetchone()
        
        username = data.get('username', row['username'] if row else 'user')
        sleep_start = int(data.get('sleepStart', row['sleepStart'] if row else 23))
        sleep_end = int(data.get('sleepEnd', row['sleepEnd'] if row else 7))
        ntfy_topic = data.get('ntfyTopic', row['ntfyTopic'] if row else 'chronos-alerts-user')
        twin_profile = data.get('twinProfile', row['twinProfile'] if row else '')
        procrastination_rating = data.get('procrastinationRating')
        if procrastination_rating is not None:
            procrastination_rating = float(procrastination_rating)
        elif row and row['procrastinationRating'] is not None:
            procrastination_rating = float(row['procrastinationRating'])
        else:
            procrastination_rating = None
        
        attention_cycle = data.get('attentionCycle') or (row.get('attentionCycle') if row else None)
        stress_response = data.get('stressResponse') or (row.get('stressResponse') if row else None)
        
        execution_count = int(data.get('executionCount', row['executionCount'] if row else 0))
        failure_count = int(data.get('failureCount', row['failureCount'] if row else 0))
        streak_count = int(data.get('streakCount', row['streakCount'] if row else 0))
        total_recovered_hours = float(data.get('totalRecoveredHours', row['totalRecoveredHours'] if row else 0.0))
        onboarding_completed = int(bool(data.get('onboardingComplete', row.get('onboarding_completed', 0) if row else 0)))
        
        cursor.execute("""
        INSERT INTO settings (
            id, user_id, username, sleepStart, sleepEnd, ntfyTopic, twinProfile,
            procrastinationRating, attentionCycle, stressResponse,
            executionCount, failureCount, streakCount, totalRecoveredHours,
            onboarding_completed
        ) VALUES (
            'active_operator', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON CONFLICT(id, user_id) DO UPDATE SET
            username=excluded.username,
            sleepStart=excluded.sleepStart,
            sleepEnd=excluded.sleepEnd,
            ntfyTopic=excluded.ntfyTopic,
            twinProfile=excluded.twinProfile,
            procrastinationRating=excluded.procrastinationRating,
            attentionCycle=excluded.attentionCycle,
            stressResponse=excluded.stressResponse,
            executionCount=excluded.executionCount,
            failureCount=excluded.failureCount,
            streakCount=excluded.streakCount,
            totalRecoveredHours=excluded.totalRecoveredHours,
            onboarding_completed=excluded.onboarding_completed
        """, (
            g.user_id, username, sleep_start, sleep_end, ntfy_topic, twin_profile,
            procrastination_rating, attention_cycle, stress_response,
            execution_count, failure_count, streak_count, total_recovered_hours,
            onboarding_completed
        ))
        conn.commit()
        conn.close()
        
        # Keep settings.json backup updated (also persist AI config if provided)
        data_to_save = {
            "user_id": g.user_id,
            "username": username,
            "sleepStart": sleep_start,
            "sleepEnd": sleep_end,
            "ntfyTopic": ntfy_topic,
            "twinProfile": twin_profile,
            "procrastinationRating": procrastination_rating,
            "attentionCycle": attention_cycle,
            "stressResponse": stress_response,
            "executionCount": execution_count,
            "failureCount": failure_count,
            "streakCount": streak_count,
            "totalRecoveredHours": total_recovered_hours,
            "onboarding_completed": onboarding_completed
        }
        # Persist AI config fields if passed
        for ai_field in ('aiProvider', 'aiApiUrl', 'aiApiKey', 'aiModel'):
            if ai_field in data:
                data_to_save[ai_field] = data[ai_field]
        try:
            # Merge with existing file to preserve fields not passed
            if os.path.exists(settings_file):
                with open(settings_file, 'r') as f:
                    existing = json.load(f)
                existing.update(data_to_save)
                data_to_save = existing
        except Exception:
            pass
        try:
            with open(settings_file, 'w') as f:
                json.dump(data_to_save, f, indent=2)
        except Exception:
            pass
            
        _gcs_backup_async()
        return jsonify(data_to_save)

    else:
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator' AND user_id = ?", (g.user_id,))
        row = cursor.fetchone()
        conn.close()
        res_data = dict(row) if row else {}
        
        # Merge with settings.json to get fields not stored in SQLite (like AI Config options)
        if os.path.exists(settings_file):
            try:
                with open(settings_file, 'r') as f:
                    file_settings = json.load(f)
                    for k, v in file_settings.items():
                        if k not in res_data or res_data[k] is None or res_data[k] == '':
                            res_data[k] = v
            except Exception:
                pass
        
        if res_data:
            if 'onboarding_completed' not in res_data:
                res_data['onboarding_completed'] = 0
            return jsonify(res_data)
        return jsonify({"username": "user", "twinProfile": "", "sleepStart": 23, "sleepEnd": 7, "ntfyTopic": "chronos-alerts-user", "procrastinationRating": None, "attentionCycle": None, "stressResponse": None, "onboarding_completed": 0})

@app.route('/api/tasks/presets/load', methods=['POST'])
def load_presets():
    import datetime
    # Load preset active missions
    # Mocking: Hackathon Project, Cloud Infrastructure, Pitch Deck
    conn = get_db_conn()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks WHERE user_id = ?", (g.user_id,))
    conn.commit()
    conn.close()
    
    due_hackathon = (datetime.datetime.now() + datetime.timedelta(hours=3)).isoformat() + "Z"
    due_cloud = (datetime.datetime.now() + datetime.timedelta(days=2)).isoformat() + "Z"
    due_pitch = (datetime.datetime.now() + datetime.timedelta(hours=18)).isoformat() + "Z"
    
    presets = [
        {
            "id": "preset-hackathon",
            "title": "Hackathon Demo Submission",
            "due": due_hackathon,
            "estimatedHours": 8.0,
            "importance": "high",
            "completed": False,
            "survivalScore": 28,
            "escalationLevel": "black",
            "deadlineCollapse": True,
            "category": json.dumps({"warningCount": 2, "aiSummary": [], "completedCheckpoints": []})
        },
        {
            "id": "preset-cloud",
            "title": "Cloud Infrastructure Migration",
            "due": due_cloud,
            "estimatedHours": 4.0,
            "importance": "medium",
            "completed": False,
            "survivalScore": 88,
            "escalationLevel": "green",
            "category": json.dumps({"warningCount": 0, "aiSummary": [], "completedCheckpoints": []})
        },
        {
            "id": "preset-pitch",
            "title": "Investor Pitch Deck finalization",
            "due": due_pitch,
            "estimatedHours": 5.0,
            "importance": "high",
            "completed": False,
            "survivalScore": 52,
            "escalationLevel": "orange",
            "category": json.dumps({"warningCount": 1, "aiSummary": [], "completedCheckpoints": []})
        }
    ]
    
    for t in presets:
        t['user_id'] = g.user_id
        t_eval = evaluate_task(t, user_id=g.user_id)
        save_task_db(t_eval, user_id=g.user_id)
        
    return jsonify({"status": "presets_loaded", "count": len(presets)})

def get_google_oauth_credentials():
    # Try environment variables first (production / Cloud Run standard)
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    
    if client_id and client_secret:
        return client_id, client_secret
        
    # Fallback to local secrets.json
    secrets_file = os.path.join(os.path.dirname(__file__), 'secrets.json')
    if os.path.exists(secrets_file):
        try:
            with open(secrets_file, 'r') as f:
                data = json.load(f)
                if data.get('client_id') and data.get('client_secret'):
                    return data.get('client_id'), data.get('client_secret')
        except Exception:
            pass
            
    raise ValueError("Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables, or create backend/secrets.json.")

def get_google_calendar_events():
    tokens_file = os.path.join(os.path.dirname(__file__), 'google_tokens.json')
    if not os.path.exists(tokens_file):
        return None
        
    try:
        with open(tokens_file, 'r') as f:
            tokens = json.load(f)
    except Exception:
        return None
        
    access_token = tokens.get('access_token')
    if not access_token:
        return None
        
    import requests as py_requests
    events_url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
    headers = {"Authorization": f"Bearer {access_token}"}
    
    import datetime
    time_min = datetime.datetime.utcnow().isoformat() + "Z"
    time_max = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).isoformat() + "Z"
    
    params = {
        "timeMin": time_min,
        "timeMax": time_max,
        "singleEvents": "true",
        "orderBy": "startTime"
    }
    
    res = py_requests.get(events_url, headers=headers, params=params, timeout=10)
    if res.status_code == 401:
        # Try refresh token
        refresh_token = tokens.get('refresh_token')
        if refresh_token:
            try:
                client_id, client_secret = get_google_oauth_credentials()
            except ValueError:
                return None
            refresh_url = "https://oauth2.googleapis.com/token"
            refresh_data = {
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }
            ref_res = py_requests.post(refresh_url, data=refresh_data, timeout=10)
            if ref_res.status_code == 200:
                new_tokens = ref_res.json()
                tokens.update(new_tokens)
                with open(tokens_file, 'w') as f:
                    json.dump(tokens, f)
                headers = {"Authorization": f"Bearer {tokens.get('access_token')}"}
                res = py_requests.get(events_url, headers=headers, params=params, timeout=10)
                
    if res.status_code != 200:
        return None
        
    return res.json().get('items', [])

def _get_gcal_access_token():
    """Return a valid Google Calendar access token, refreshing if needed."""
    import requests as py_requests
    tokens_file = os.path.join(os.path.dirname(__file__), 'google_tokens.json')
    if not os.path.exists(tokens_file):
        return None
    try:
        with open(tokens_file, 'r') as f:
            tokens = json.load(f)
    except Exception:
        return None
    access_token = tokens.get('access_token')
    if not access_token:
        return None
    # Try a quick token validation; if 401, attempt refresh
    test = py_requests.get(
        "https://www.googleapis.com/calendar/v3/calendars/primary",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=5
    )
    if test.status_code == 401:
        refresh_token = tokens.get('refresh_token')
        if not refresh_token:
            return None
        try:
            client_id, client_secret = get_google_oauth_credentials()
        except ValueError:
            return None
        ref_res = py_requests.post("https://oauth2.googleapis.com/token", data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }, timeout=10)
        if ref_res.status_code == 200:
            tokens.update(ref_res.json())
            with open(tokens_file, 'w') as f:
                json.dump(tokens, f)
            access_token = tokens.get('access_token')
        else:
            return None
    return access_token

def push_task_to_google_calendar(task):
    """Create a Google Calendar event for a Chronos task. Stores event id in category JSON."""
    import requests as py_requests
    access_token = _get_gcal_access_token()
    if not access_token:
        return
    try:
        due_str = task.get('due', '')
        if not due_str:
            return
        # Build RFC3339 start/end (use estimated hours for duration)
        due_clean = due_str.replace('Z', '+00:00')
        due_dt = datetime.datetime.fromisoformat(due_clean)
        est_hours = float(task.get('estimatedHours', 1))
        start_dt = due_dt - datetime.timedelta(hours=est_hours)
        body = {
            "summary": task.get('title', 'Chronos Task'),
            "description": f"Chronos Task | Importance: {task.get('importance','medium')}",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end":   {"dateTime": due_dt.isoformat(),   "timeZone": "UTC"},
            "extendedProperties": {"private": {"chronos_task_id": str(task['id'])}}
        }
        res = py_requests.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body, timeout=8
        )
        if res.status_code in (200, 201):
            event_id = res.json().get('id')
            if event_id:
                # Persist gcalEventId inside the category JSON column
                conn = get_db_conn()
                cursor = conn.cursor()
                uid = task.get('user_id', 'anonymous')
                cursor.execute("SELECT category FROM tasks WHERE id=? AND user_id=?", (str(task['id']), uid))
                row = cursor.fetchone()
                cat_obj = {}
                if row and row[0]:
                    try:
                        cat_obj = json.loads(row[0])
                    except Exception:
                        pass
                cat_obj['gcalEventId'] = event_id
                cursor.execute("UPDATE tasks SET category=? WHERE id=? AND user_id=?", (json.dumps(cat_obj), str(task['id']), uid))
                conn.commit()
                conn.close()
                print(f"[GCal] Created event {event_id} for task {task['id']}", flush=True)
    except Exception as e:
        print(f"[GCal] push_task_to_google_calendar error: {e}", flush=True)

def update_google_calendar_event(task):
    """Update the linked Google Calendar event for a Chronos task."""
    import requests as py_requests
    # Read gcalEventId from category JSON
    cat_str = task.get('category', '') or ''
    try:
        cat_obj = json.loads(cat_str) if isinstance(cat_str, str) else cat_str
    except Exception:
        cat_obj = {}
    event_id = cat_obj.get('gcalEventId') if isinstance(cat_obj, dict) else None
    if not event_id:
        return
    access_token = _get_gcal_access_token()
    if not access_token:
        return
    try:
        due_str = task.get('due', '')
        if not due_str:
            return
        due_clean = due_str.replace('Z', '+00:00')
        due_dt = datetime.datetime.fromisoformat(due_clean)
        est_hours = float(task.get('estimatedHours', 1))
        start_dt = due_dt - datetime.timedelta(hours=est_hours)
        is_completed = task.get('completed', False)
        prefix = "✅ " if is_completed else ""
        body = {
            "summary": prefix + task.get('title', 'Chronos Task'),
            "description": f"Chronos Task | Importance: {task.get('importance','medium')} | Status: {'Secured' if is_completed else 'Active'}",
            "start": {"dateTime": start_dt.isoformat(), "timeZone": "UTC"},
            "end":   {"dateTime": due_dt.isoformat(),   "timeZone": "UTC"},
        }
        res = py_requests.put(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
            json=body, timeout=8
        )
        if res.status_code == 200:
            print(f"[GCal] Updated event {event_id} for task {task['id']}", flush=True)
    except Exception as e:
        print(f"[GCal] update_google_calendar_event error: {e}", flush=True)

def delete_google_calendar_event(task_id, cat_str):
    """Delete the linked Google Calendar event when a Chronos task is deleted."""
    import requests as py_requests
    try:
        cat_obj = json.loads(cat_str) if isinstance(cat_str, str) else {}
    except Exception:
        cat_obj = {}
    event_id = cat_obj.get('gcalEventId') if isinstance(cat_obj, dict) else None
    if not event_id:
        return
    access_token = _get_gcal_access_token()
    if not access_token:
        return
    try:
        py_requests.delete(
            f"https://www.googleapis.com/calendar/v3/calendars/primary/events/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=8
        )
        print(f"[GCal] Deleted event {event_id} for task {task_id}", flush=True)
    except Exception as e:
        print(f"[GCal] delete_google_calendar_event error: {e}", flush=True)

def _backend_url():
    url = os.environ.get('BACKEND_URL') or request.host_url.rstrip('/')
    if url.startswith('http://') and url not in ('http://localhost:5000', 'http://127.0.0.1:5000'):
        url = 'https://' + url[7:]
    return url

@app.route('/auth/google')

def auth_google():
    import urllib.parse
    backend_url = _backend_url()
    frontend_origin = request.args.get('frontend_origin', os.environ.get('FRONTEND_URL', backend_url))
    try:
        client_id, _ = get_google_oauth_credentials()
    except ValueError as e:
        return f"Google Calendar integration unavailable: {str(e)}", 500
    redirect_uri = backend_url + '/auth/google/callback'
    scope = "https://www.googleapis.com/auth/calendar"
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "prompt": "consent",
        "state": frontend_origin
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return redirect(url)

@app.route('/auth/google/callback')
def auth_google_callback():
    code = request.args.get('code')
    backend_url = _backend_url()
    frontend_origin = request.args.get('state', os.environ.get('FRONTEND_URL', backend_url))
    if not code:
        return "Missing auth code parameter", 400
    try:
        client_id, client_secret = get_google_oauth_credentials()
    except ValueError as e:
        return f"Google Calendar integration unavailable: {str(e)}", 500
    redirect_uri = backend_url + '/auth/google/callback'
    
    import requests as py_requests
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }
    res = py_requests.post(token_url, data=data, timeout=10)
    if res.status_code != 200:
        return f"Failed to exchange code for tokens: {res.text}", 400
        
    tokens = res.json()
    tokens_file = os.path.join(os.path.dirname(__file__), 'google_tokens.json')
    with open(tokens_file, 'w') as f:
        json.dump(tokens, f)
    _gcs_backup_async()
        
    return f"""
    <html>
      <head>
        <title>Google Calendar Authenticated</title>
        <script>
          if (window.opener) {{
            window.opener.postMessage({{ type: "CHRONOS_GCAL_AUTH_SUCCESS" }}, "*");
            window.close();
          }} else {{
            window.location.href = "{frontend_origin}/?gcal_success=true";
          }}
        </script>
      </head>
      <body style="background: #0B0C10; color: #66FCF1; font-family: sans-serif; text-align: center; padding-top: 100px;">
        <h2>✓ Authentication Successful</h2>
        <p style="color: #8A2BE2;">Syncing google calendar events. You can close this window now.</p>
      </body>
    </html>
    """

@app.route('/api/calendar/logout', methods=['POST'])
def calendar_logout():
    tokens_file = os.path.join(os.path.dirname(__file__), 'google_tokens.json')
    if os.path.exists(tokens_file):
        try:
            os.remove(tokens_file)
        except Exception as e:
            return jsonify({"error": str(e)}), 500
    return jsonify({"status": "logged_out"})

@app.route('/api/calendar/sync', methods=['POST'])
def calendar_sync():
    import datetime
    # Try fetching real events
    events = get_google_calendar_events()
    
    # If not authenticated, request frontend to open OAuth popup
    if events is None:
        data = request.get_json() or {}
        backend_url = _backend_url()
        frontend_origin = data.get('frontend_origin', os.environ.get('FRONTEND_URL', backend_url))
        auth_url = backend_url + f"/auth/google?frontend_origin={frontend_origin}"
        return jsonify({"status": "auth_required", "url": auth_url})
        
    tasks = load_tasks_db(user_id=g.user_id)
    
    cal_tasks = []
    
    # Map real calendar events
    for ev in events:
        summary = ev.get('summary', 'Untitled Event')
        start = ev.get('start', {})
        end = ev.get('end', {})
        
        due_str = start.get('dateTime') or start.get('date')
        if not due_str:
            continue
            
        # Parse duration
        est_hours = 1.0
        start_time_str = start.get('dateTime')
        end_time_str = end.get('dateTime')
        if start_time_str and end_time_str:
            try:
                s_dt = datetime.datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                e_dt = datetime.datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))
                duration_hours = (e_dt - s_dt).total_seconds() / 3600.0
                if duration_hours > 0:
                    est_hours = round(duration_hours, 1)
            except Exception:
                pass
                
        # Clean up timezone identifier for database compatibility
        clean_due = due_str
        if due_str.endswith('Z'):
            clean_due = due_str
        elif '+' in due_str or '-' in due_str:
            pass
        else:
            clean_due = due_str + 'Z'
            
        event_id = f"gcal-{ev.get('id')}"
        cal_tasks.append({
            "id": event_id,
            "title": summary,
            "due": clean_due,
            "estimatedHours": est_hours,
            "importance": "high" if "meeting" in summary.lower() or ev.get('attendees') else "medium",
            "completed": False,
            "survivalScore": 85,
            "escalationLevel": "green",
            "category": json.dumps({"locked_intake": True, "aiSummary": [], "completedCheckpoints": []})
        })
        
    count = 0
    for ct in cal_tasks:
        if not any(t['id'] == ct['id'] for t in tasks):
            # Bypass slow evaluate_task call to fix latency completely
            save_task_db(ct, user_id=g.user_id)
            count += 1
            
    if count > 0:
        send_phone_notification("Google Calendar Synced", f"Imported {count} locked calendar tasks. AI Intake briefing required to activate timeline.")
        speech_queue.put(f"Google Calendar synced. {count} mission targets imported. Complete the intake briefings to activate.")
        
    return jsonify({"status": "synced", "count": count})

def background_gcal_sync_job():
    """Periodic background sync from Google Calendar to Chronos tasks for all users."""
    try:
        events = get_google_calendar_events()
        if not events:
            return
        conn = get_db_conn()
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT DISTINCT user_id FROM tasks")
        user_ids = [row['user_id'] for row in cursor.fetchall()]
        if not user_ids:
            user_ids = ['anonymous']
        for uid in user_ids:
            existing = load_tasks_db(user_id=uid)
            existing_ids = {t['id'] for t in existing}
            import datetime
            for ev in events:
                summary = ev.get('summary', 'Untitled Event')
                start = ev.get('start', {})
                end = ev.get('end', {})
                due_str = start.get('dateTime') or start.get('date')
                if not due_str:
                    continue
                est_hours = 1.0
                start_ts = start.get('dateTime')
                end_ts = end.get('dateTime')
                if start_ts and end_ts:
                    try:
                        s_dt = datetime.datetime.fromisoformat(start_ts.replace('Z', '+00:00'))
                        e_dt = datetime.datetime.fromisoformat(end_ts.replace('Z', '+00:00'))
                        dur = (e_dt - s_dt).total_seconds() / 3600.0
                        if dur > 0:
                            est_hours = round(dur, 1)
                    except Exception:
                        pass
                event_id = f"gcal-{ev.get('id')}"
                if event_id not in existing_ids:
                    cal_task = {
                        "id": event_id,
                        "title": summary,
                        "due": due_str,
                        "estimatedHours": est_hours,
                        "importance": "high" if "meeting" in summary.lower() or ev.get('attendees') else "medium",
                        "completed": False,
                        "survivalScore": 85,
                        "escalationLevel": "green",
                        "category": json.dumps({"locked_intake": True, "aiSummary": [], "completedCheckpoints": []})
                    }
                    save_task_db(cal_task, user_id=uid)
        conn.close()
        print(f"[GCal Auto-Sync] Synced {len(events)} events for {len(user_ids)} user(s).", flush=True)
    except Exception as e:
        print(f"[GCal Auto-Sync Error] {e}", flush=True)

# Background Scheduler Job Initialization (runs evaluation loop every 30s)
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    
    def background_pulse_job():
        print("[APScheduler] Running background cron timeline evaluation...", flush=True)
        try:
            conn = get_db_conn()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT DISTINCT user_id FROM tasks")
            user_ids = [row['user_id'] for row in cursor.fetchall()]
            conn.close()
            for uid in user_ids:
                tasks = load_tasks_db(user_id=uid)
                for t in tasks:
                    if not t.get('completed', False):
                        t_eval = evaluate_task(t, user_id=uid)
                        save_task_db(t_eval, user_id=uid)
        except Exception as e:
            print(f"[APScheduler Job Error] {e}")

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(background_pulse_job, 'interval', seconds=30)
    scheduler.add_job(background_gcal_sync_job, 'interval', seconds=300)
    scheduler.start()
    print("✅ Background APScheduler initialized. Pulses every 30s, GCal sync every 5min.")
except Exception as e:
    print(f"Warning: Failed to load APScheduler ({e}). Falling back to browser-pulsed triggers.")

@app.route('/api/download-daemon', methods=['GET'])
def download_daemon():
    dist_dir = os.path.join(os.path.dirname(__file__), '..', 'dist')
    return send_from_directory(dist_dir, 'chronos_voice_daemon.exe', as_attachment=True)

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != '' and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)