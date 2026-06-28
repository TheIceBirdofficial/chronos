from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS
import requests
import sqlite3

def make_local_request(method, url, **kwargs):
    import urllib.parse
    import requests
    
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
import os
import json
import datetime
import uuid
import queue
import hashlib
import threading
import time

# Global Server-Sent Events (SSE) client list for voice telemetry
voice_clients = []

speech_queue = queue.Queue()
last_voice_link_ping = 0.0
voice_muted = False
voice_muted_until = 0.0
is_speaking = False
voice_conversation_history = []

INTERVENTIONS_FILE = os.path.join(os.path.dirname(__file__), 'interventions.json')
last_voice_event_speak_time = 0.0

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
                try:
                    iso_clean = due_str.replace('Z', '+00:00')
                    due_dt = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
                    hours_ahead = int((due_dt - datetime.datetime.now()).total_seconds() / 3600.0)
                except Exception:
                    pass
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
    for q in list(voice_clients):
        try:
            q.put(payload)
        except Exception:
            pass

notification_cooldowns = {}

def send_phone_notification(title, message):
    global notification_cooldowns
    now = time.time()
    notification_cooldowns = {k: v for k, v in notification_cooldowns.items() if now - v < 300.0}
    
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

def speech_worker():
    global is_speaking
    while True:
        try:
            text = speech_queue.get()
            if text is None:
                is_speaking = False
                break
            
            is_speaking = True
            print(f"[Headless Voice Coordinator] Broadcasting speech: '{text}'", flush=True)
            broadcast_status("speaking", text)
            
            # Pacing: ~12 chars per second + 0.5s buffer
            speak_duration = max(1.5, len(text) * 0.08)
            time.sleep(speak_duration)
            
            is_speaking = False
            speech_queue.task_done()
            
            if speech_queue.empty():
                broadcast_status("idle", "Chronos Voice Link: Sync Active.")
        except Exception as e:
            is_speaking = False
            print(f"[Speech Worker Error] {e}", flush=True)
            time.sleep(0.1)

# Start the headless speech worker thread
if os.environ.get('WERKZEUG_RUN_MAIN') == 'true' or not os.environ.get('FLASK_USE_RELOADER', 'true') == 'true':
    worker_thread = threading.Thread(target=speech_worker, daemon=True)
    worker_thread.start()
    print("[Headless Voice Coordinator] Speech worker thread active.")

app = Flask(__name__, static_folder='../frontend', static_url_path='')
CORS(app)

# Persistent Local Database File path (SQLite)
SQLITE_DB = os.path.join(os.path.dirname(__file__), 'chronos.db')

def init_sqlite_db():
    conn = sqlite3.connect(SQLITE_DB)
    cursor = conn.cursor()
    
    # Settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
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
        totalRecoveredHours REAL
    )
    """)
    
    # Tasks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
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
        delayHistory TEXT
    )
    """)
    
    # Populate default settings row if not exists
    cursor.execute("SELECT COUNT(*) FROM settings WHERE id = 'active_operator'")
    if cursor.fetchone()[0] == 0:
        # Load from settings.json if it exists, to preserve user settings on upgrade
        settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
        username = "user"
        sleep_start = 23
        sleep_end = 7
        ntfy_topic = "chronos-alerts-user"
        twin_profile = ""
        if os.path.exists(settings_file):
            try:
                with open(settings_file, 'r') as f:
                    cfg = json.load(f)
                    username = cfg.get('username', 'user')
                    sleep_start = int(cfg.get('sleepStart', 23))
                    sleep_end = int(cfg.get('sleepEnd', 7))
                    ntfy_topic = cfg.get('ntfyTopic', 'chronos-alerts-user')
                    twin_profile = cfg.get('twinProfile', '')
            except Exception:
                pass
        cursor.execute("""
        INSERT INTO settings (
            id, username, sleepStart, sleepEnd, ntfyTopic, twinProfile, 
            procrastinationRating, attentionCycle, stressResponse, 
            executionCount, failureCount, streakCount, totalRecoveredHours
        ) VALUES (
            'active_operator', ?, ?, ?, ?, ?,
            8.0, 'Focus cycles peak late evening', 'Postpones tasks under high workload pressure',
            0, 0, 0, 0.0
        )
        """, (username, sleep_start, sleep_end, ntfy_topic, twin_profile))
        conn.commit()
    conn.close()

# Initialize DB immediately
init_sqlite_db()

# --- Database Operations Adapter ---

def load_tasks_db():
    try:
        conn = sqlite3.connect(SQLITE_DB)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks")
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
                
            tasks_list.append(t)
        return tasks_list
    except Exception as e:
        print(f"[CHRONOS DB] SQLite read error: {e}")
        return []

def save_task_db(task):
    try:
        task['id'] = str(task['id'])
        
        # Load previous task state from SQLite to compare transitions
        prev_task = None
        try:
            conn_prev = sqlite3.connect(SQLITE_DB)
            conn_prev.row_factory = sqlite3.Row
            cursor_prev = conn_prev.cursor()
            cursor_prev.execute("SELECT * FROM tasks WHERE id = ?", (task['id'],))
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

        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        
        events_str = json.dumps(task.get('events', []))
        checklist_str = json.dumps(task.get('recoveryChecklist', []))
        negotiation_str = json.dumps(task.get('negotiationLog', []))
        timeline_str = json.dumps(task.get('timeline', []))
        delay_history_str = json.dumps(task.get('delayHistory', []))
        
        completed_val = 1 if task.get('completed', False) else 0
        collapse_val = 1 if task.get('deadlineCollapse', False) else 0
        recovery_active_val = 1 if task.get('recoveryActive', False) else 0
        
        cursor.execute("""
        INSERT INTO tasks (
            id, title, due, created, estimatedHours, importance, completed,
            survivalScore, escalationLevel, pointOfNoReturn, deadlineCollapse,
            delayCount, events, recoveryActive, recoveryProgress, recoveryChecklist,
            riskBeforeRecovery, negotiationLog, category, timeline, delayHistory
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
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
            delayHistory=excluded.delayHistory
        """, (
            str(task['id']),
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
            delay_history_str
        ))
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[CHRONOS DB] SQLite write error: {e}")

def delete_task_db(tid):
    try:
        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM tasks WHERE id = ?", (str(tid),))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[CHRONOS DB] SQLite delete error: {e}")

def update_twin_metrics(completed_change=None, failure_change=None, recovered_hours_change=None):
    try:
        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        
        cursor.execute("SELECT executionCount, failureCount, streakCount, totalRecoveredHours FROM settings WHERE id = 'active_operator'")
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
        WHERE id = 'active_operator'
        """, (execution_count, failure_count, streak_count, total_recovered_hours))
        
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
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
            payload = {"contents": contents, "generationConfig": {"temperature": 0.7}}
            if system_instruction:
                payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
            response = requests.post(url, json=payload, timeout=timeout)
            response.raise_for_status()
            res_data = response.json()
            return res_data['candidates'][0]['content']['parts'][0]['text']

        elif provider == 'ollama':
            url = api_url or 'http://localhost:11434'
            if not url.endswith('/api/chat'):
                url = url.rstrip('/') + '/api/chat'
            payload = {"model": model or "llama3", "messages": messages, "stream": False, "options": {"temperature": 0.7}}
            response = make_local_request('POST', url, json=payload, timeout=timeout)
            response.raise_for_status()
            return response.json().get('message', {}).get('content', '')

        elif provider == 'nvidia':
            url = f"{api_url or 'https://integrate.api.nvidia.com/v1'}/chat/completions"
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {"model": model or "meta/llama-3-70b-instruct", "messages": messages, "temperature": 0.5, "max_tokens": 1024, "stream": False}
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


def generate_dynamic_timeline(title, due_str, twin_profile="", ai_config=None):
    """
    Generates a dynamic 3-phase timeline based on the title, due date, and user profile.
    Uses the configured AI supplier when available, falls back to rule-based computation.
    """
    now = datetime.datetime.now()
    due = now + datetime.timedelta(hours=4)
    if due_str:
        try:
            iso_clean = due_str.replace('Z', '+00:00')
            due = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
        except Exception:
            pass
            
    total_hours = (due - now).total_seconds() / 3600.0
    if total_hours <= 0:
        total_hours = 4.0

    def format_time_ref(dt):
        diff_days = (dt.date() - now.date()).days
        time_part = dt.strftime("%I:%M %p")
        if diff_days == 0:
            return f"Today, {time_part}"
        elif diff_days == 1:
            return f"Tomorrow, {time_part}"
        else:
            return f"{dt.strftime('%d %b')}, {time_part}"

    # Load sleep & procrastination settings from SQLite database
    sleep_start = 23
    sleep_end = 7
    procrastination_rating = 8.0
    try:
        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT sleepStart, sleepEnd, procrastinationRating FROM settings LIMIT 1")
        row = cursor.fetchone()
        if row:
            sleep_start = int(row[0])
            sleep_end = int(row[1])
            procrastination_rating = float(row[2])
        conn.close()
    except Exception:
        pass

    # Try user's configured AI supplier first
    if ai_config and ai_config.get('apiKey'):
        try:
            prompt = (
                f"You are a master timeline partitioner. Current time is {now.strftime('%A, %d %b at %I:%M %p')}. "
                f"Generate a task breakdown timeline of exactly 3 sequential phases for the task '{title}' which is due at {due.strftime('%A, %d %b at %I:%M %p')} ({total_hours:.1f} hours from now). "
                f"User sleep schedule is from {sleep_start}:00 to {sleep_end}:00. Procrastination factor is {procrastination_rating}/10. "
                f"User profile: {twin_profile}. "
                f"Partition the time accurately. All phase scheduledTimes MUST fall outside the user's sleep window and be placed at highly productive hours. "
                f"Phase 1 should be scheduled early to combat procrastination. Phase 2 should cover the core effort. Phase 3 should cover the review. "
                f"Respond with ONLY a raw JSON array of 3 objects, each having keys: 'title' (actionable, detailed subtask description) and 'scheduledTime' (formatted as 'Today at 8:00 PM', 'Tomorrow at 10:30 AM', etc.). "
                f"Output ONLY the JSON array, no markdown, no explanation."
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
                # Strip markdown code blocks if present
                if '```' in content:
                    parts = content.split('```')
                    for part in parts:
                        stripped = part.strip()
                        if stripped.startswith('json'):
                            stripped = stripped[4:].strip()
                        if stripped.startswith('['):
                            content = stripped
                            break
                phases = json.loads(content)
                if isinstance(phases, list) and len(phases) >= 3:
                    timeline = []
                    for i, p in enumerate(phases[:3]):
                        timeline.append({
                            "id": f"m{i+1}",
                            "title": p.get("title", f"Phase {i+1}"),
                            "status": "pending",
                            "scheduledTime": p.get("scheduledTime", "")
                        })
                    return timeline
        except Exception as e:
            print(f"[Timeline Gen] AI supplier generation failed: {e}", flush=True)

    # Try local Ollama as fallback
    try:
        url = 'http://localhost:11434/api/generate'
        prompt = (
            f"You are a master timeline partitioner. Current time is {now.strftime('%A, %d %b at %I:%M %p')}. "
            f"Generate a task breakdown timeline of exactly 3 sequential phases for the task '{title}' which is due at {due.strftime('%A, %d %b at %I:%M %p')} ({total_hours:.1f} hours from now). "
            f"User sleep schedule is from {sleep_start}:00 to {sleep_end}:00. Procrastination factor is {procrastination_rating}/10. "
            f"User profile: {twin_profile}. "
            f"Partition the time accurately. All phase scheduledTimes MUST fall outside the user's sleep window and be placed at highly productive hours. "
            f"Respond with ONLY a raw JSON array of 3 objects, each having keys: 'title' (actionable, detailed subtask description) and 'scheduledTime' (formatted as 'Today at 8:00 PM', 'Tomorrow at 10:30 AM', etc.). "
            f"Output ONLY the JSON array, no markdown, no explanation."
        )
        session = requests.Session()
        session.trust_env = False
        res = session.post(url, json={"model": "gemma2:2b", "prompt": prompt, "stream": False}, proxies={}, timeout=3)
        if res.status_code == 200:
            content = res.json().get('response', '').strip()
            if '```' in content:
                content = content.split('```')[1]
                if content.startswith('json'):
                    content = content[4:]
                content = content.strip()
            phases = json.loads(content)
            if isinstance(phases, list) and len(phases) == 3:
                timeline = []
                for i, p in enumerate(phases):
                    timeline.append({
                        "id": f"m{i+1}",
                        "title": p.get("title", f"Phase {i+1}"),
                        "status": "pending",
                        "scheduledTime": p.get("scheduledTime", "")
                    })
                return timeline
    except Exception as e:
        print(f"[Timeline Gen] Ollama generation failed, falling back to rule-based dynamic calculation: {e}", flush=True)
        
    p1_time = now + datetime.timedelta(hours=total_hours * 0.2)
    p2_time = now + datetime.timedelta(hours=total_hours * 0.6)
    p3_time = now + datetime.timedelta(hours=total_hours * 0.9)
            
    return [
        {"id": "m1", "title": f"Initiate: Core research & structure for '{title}'", "status": "pending", "scheduledTime": format_time_ref(p1_time)},
        {"id": "m2", "title": f"Execute: Draft & build main components of '{title}'", "status": "pending", "scheduledTime": format_time_ref(p2_time)},
        {"id": "m3", "title": f"Finalize: Complete review & submit '{title}'", "status": "pending", "scheduledTime": format_time_ref(p3_time)}
    ]


AI_EVALUATION_CACHE = {}

def run_autonomous_agent_decisions(task, level, survival_score, sleep_start, sleep_end, twin_profile, ai_config):
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
        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT procrastinationRating FROM settings WHERE id = 'active_operator' LIMIT 1")
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
        try:
            iso_clean = due_str.replace('Z', '+00:00')
            due_dt = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
            real_hours_left = max(0.1, (due_dt - now).total_seconds() / 3600.0)
        except Exception:
            pass

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
                
                if ai_config and (ai_config.get('apiKey') or ai_config.get('provider') == 'ollama'):
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
            make_local_request("POST", "http://127.0.0.1:5000/api/voice/speak", json={
                "text": f"Warning: Chronos autonomous intervention engaged for task: {task.get('title')}. Adjusting priority and timeline parameters."
            }, timeout=3)
        except Exception:
            pass

    task['events'] = events
    return task


def evaluate_task(task, twin_profile="", is_pulse=False):
    """
    Risk Agent: Recalculates survival scores, deterioration history, and 'Point of No Return'.
    Intervention Agent: Assigns 5-stage escalation levels and generates alerts.
    """
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
    try:
        iso_clean = due_str.replace('Z', '+00:00')
        due = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
    except Exception:
        due = datetime.datetime.now() + datetime.timedelta(hours=4)
    
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
        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT sleepStart, sleepEnd, procrastinationRating FROM settings WHERE id = 'active_operator'")
        row = cursor.fetchone()
        conn.close()
        if row:
            sleep_start = int(row[0])
            sleep_end = int(row[1])
            procrastination_rating = float(row[2])
    except Exception as e:
        print(f"[SQLite load settings error] {e}")
            
    # Subtract sleep hours (non-work hours), eating hours, and misc overheads to get highly accurate available hours
    sleep_hours = get_sleep_hours_between(now, due, sleep_start, sleep_end)
    eating_overhead = 2.0 * (real_hours_left / 24.0)
    misc_overhead = 1.5 * (real_hours_left / 24.0)
    work_hours_left = max(0.1, real_hours_left - sleep_hours - eating_overhead - misc_overhead)
    
    # Proactive Outcome Prediction math:
    # Buffer in hours before deadline that the user typically starts the task
    predicted_start_lead_hours = round(max(1.0, (10.0 - procrastination_rating) * 1.5), 1)
    
    # Calculate historical delay count penalty
    delay_count = int(task.get('delayCount', 0))
    delay_penalty = delay_count * 8
    
    # Calculate work remaining and margin
    margin = work_hours_left / estimated_hours
    
    # Defaults and fallback values
    pred_risk = int(10 + delay_penalty)
    if margin < 1.3:
        pred_risk += 25
    pred_risk = max(5, min(95, pred_risk))
    survival_score = 100 - pred_risk
    survival_score = max(1, min(98, survival_score))
    
    no_return_offset_hours = estimated_hours
    cognitive_observations = [
        f"Effort requirement: {estimated_hours} hours. Active productive window: {round(work_hours_left, 1)}h (excl. sleep, eating, misc overheads).",
        f"Operator Twin procrastination factor of {procrastination_rating} is active.",
        f"Historical delay penalties applied: {delay_penalty}% risk margin offset."
    ]
    log_message = None

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
        if ai_config and (ai_config.get('apiKey') or ai_config.get('provider') == 'ollama'):
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
    task = run_autonomous_agent_decisions(task, level, survival_score, sleep_start, sleep_end, twin_profile, ai_config)
    
    return task

# --- API Endpoints ---

@app.route('/api/tasks', methods=['GET'])
def get_tasks():
    return jsonify(load_tasks_db())

@app.route('/api/tasks', methods=['POST'])
def add_task():
    data = request.get_json()
    twin_profile = data.get('twinProfile', '')
    ai_config = data.get('aiConfig') or get_ai_config_from_db()
    
    task_id = str(uuid.uuid4())
    task = {
        'id': task_id,
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
    
    # Generate Mission Timeline via Planner Agent
    task['timeline'] = generate_dynamic_timeline(task['title'], task['due'], twin_profile, ai_config)
    
    # Run Risk/Intervention assessment
    task = evaluate_task(task, twin_profile)
    
    save_task_db(task)
    return jsonify(task), 201


@app.route('/api/tasks/<tid>', methods=['PUT'])
def update_task(tid):
    data = request.get_json()
    tasks_list = load_tasks_db()
    task = next((t for t in tasks_list if str(t['id']) == str(tid)), None)
    
    if not task:
        return jsonify({'error': 'Task not found'}), 404
        
    if 'completed' in data:
        was_completed = task.get('completed', False)
        is_completed = bool(data['completed'])
        if is_completed != was_completed:
            completed_change = 1 if is_completed else -1
            update_twin_metrics(completed_change=completed_change)
            
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
    task = evaluate_task(task, twin_profile)
    
    save_task_db(task)
    return jsonify(task)

@app.route('/api/tasks/<tid>', methods=['DELETE'])
def delete_task(tid):
    delete_task_db(tid)
    return '', 204

# --- Demo & Simulation Endpoints ---

@app.route('/api/tasks/pulse', methods=['POST'])
def run_pulse():
    """
    Reruns Risk Agent on all tasks using the current real time,
    simulating active observation.
    """
    data = request.get_json() or {}
    twin_profile = data.get('twinProfile', '')
    
    tasks_list = load_tasks_db()
    updated = []
    for t in tasks_list:
        t_eval = evaluate_task(t, twin_profile, is_pulse=True)
        save_task_db(t_eval)
        updated.append(t_eval)
    return jsonify(updated)

@app.route('/api/tasks/simulate/time', methods=['POST'])
def simulate_time_passage():
    """
    Simulates +1 hour passage by subtracting 1 hour from task due dates
    and updates task risk scores dynamically.
    """
    data = request.get_json() or {}
    twin_profile = data.get('twinProfile', '')
    
    tasks_list = load_tasks_db()
    updated = []
    for t in tasks_list:
        due_str = t.get('due')
        if due_str:
            iso_clean = due_str.replace('Z', '+00:00')
            due_dt = datetime.datetime.fromisoformat(iso_clean)
            new_due_dt = due_dt - datetime.timedelta(hours=1)
            t['due'] = new_due_dt.isoformat().replace('+00:00', 'Z')
            
            t['delayCount'] = t.get('delayCount', 0) + 1
            t_eval = evaluate_task(t, twin_profile)
            
            events = t_eval.get('events', [])
            events.append({
                'timestamp': datetime.datetime.now().isoformat(),
                'agent': 'Risk Agent',
                'message': f"Time passage simulation: deadline advanced by 1 hour. Time remaining: {t_eval['riskAnalysis']['timeRemaining']}h."
            })
            t_eval['events'] = events
            
            save_task_db(t_eval)
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
    
    tasks_list = load_tasks_db()
    if not tasks_list:
        task_id = str(uuid.uuid4())
        mock_due = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat() + "Z"
        task = {
            'id': task_id,
            'title': 'Hackathon Demo Submission',
            'due': mock_due,
            'estimatedHours': 6.0,
            'importance': 'high',
            'completed': False,
            'created': datetime.datetime.now().isoformat(),
            'timeline': generate_fallback_timeline('Hackathon Demo Submission', twin_profile)
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
        save_task_db(t)
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
    delete_task_db(tid)
    update_twin_metrics(failure_change=1)
    
    settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM settings WHERE id = 'active_operator'")
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
    tasks_list = load_tasks_db()
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
        try:
            iso_clean = due_str.replace('Z', '+00:00')
            due_dt = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
            hours_remaining = max(0, (due_dt - now).total_seconds() / 3600.0)
        except Exception:
            pass

    # --- AI-driven recovery checklist & forecast ---
    ai_checklist = None
    ai_forecast = None
    ai_starters = None
    ai_timeline = None
    ai_no_return_offset = None  # hours before due

    if ai_config and (ai_config.get('apiKey') or ai_config.get('provider') == 'ollama'):
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
            iso_clean = due_str.replace('Z', '+00:00')
            due_dt = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
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

    save_task_db(task)
    return jsonify(task)


@app.route('/api/tasks/<tid>/complete_sprint', methods=['POST'])
def complete_sprint(tid):
    """
    Finalizes a task or checkpoint sprint, recording actual vs estimated hours,
    triggering the AI twin to analyze efficiency patterns and adjust settings.
    """
    tasks_list = load_tasks_db()
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
        except Exception:
            try:
                chat_history = json.loads(task['category'])
                category_data = {"aiSummary": chat_history, "completedCheckpoints": []}
            except Exception:
                category_data = {"aiSummary": [], "completedCheckpoints": []}
    else:
        category_data = {"aiSummary": [], "completedCheckpoints": []}
        
    if "completedCheckpoints" not in category_data:
        category_data["completedCheckpoints"] = []
        
    # Load settings from SQLite settings
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT twinProfile, procrastinationRating FROM settings WHERE id = 'active_operator'")
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
        update_twin_metrics(completed_change=1)
        
    # AI Learning and Optimizing:
    # Query AI to update user's digital twin profile based on execution performance!
    new_twin_profile = twin_profile
    new_procrastination_rating = procrastination_rating
    
    if ai_config and (ai_config.get('apiKey') or ai_config.get('provider') == 'ollama'):
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
                conn = sqlite3.connect(SQLITE_DB)
                cursor = conn.cursor()
                cursor.execute("UPDATE settings SET twinProfile = ?, procrastinationRating = ? WHERE id = 'active_operator'", (new_twin_profile, new_procrastination_rating))
                conn.commit()
                conn.close()
        except Exception as e:
            print(f"[Complete Sprint AI learning failed] {e}", flush=True)
            
    # Save task
    save_task_db(task)
    
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
        
    tasks_list = load_tasks_db()
    task = next((t for t in tasks_list if str(t['id']) == str(task_id)), None)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
        
    # Re-calculate work hours left to get current temporal debt
    due_str = task.get('due')
    estimated_hours = float(task.get('estimatedHours', 2))
    work_hours_left = estimated_hours
    
    if due_str:
        now = datetime.datetime.now()
        iso_clean = due_str.replace('Z', '+00:00')
        due = datetime.datetime.fromisoformat(iso_clean).replace(tzinfo=None)
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
    
    # Checklist
    rescue_resources = task.get('rescueResources') or {}
    checklist = rescue_resources.get('checklist') or [
        "Review project requirements",
        "Draft preliminary outline",
        "Build main feature set",
        "Finalize and test execution"
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
        
    tasks_list = load_tasks_db()
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
    update_twin_metrics(completed_change=1, recovered_hours_change=recovered_hours)
    
    # Calculate streak from SQLite settings
    streak_count = 1
    try:
        conn = sqlite3.connect(SQLITE_DB)
        cursor = conn.cursor()
        cursor.execute("SELECT streakCount FROM settings WHERE id = 'active_operator'")
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
    
    save_task_db(task)
    
    return jsonify({
        'success': True,
        'recoveredHours': recovered_hours,
        'streakCount': streak_count,
        'confidenceBoost': confidence_boost
    })

# --- AI Core endpoints ---

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    data = request.get_json()
    provider = data.get('provider', 'ollama')
    api_url = data.get('apiUrl')
    api_key = data.get('apiKey')
    model = data.get('model')
    messages = data.get('messages', [])

    try:
        if provider == 'gemini':
            active_key = api_key or os.environ.get('GEMINI_API_KEY')
            if not active_key:
                provider = 'ollama'
            else:
                api_key = active_key
        
        # Check provider again in case it fell back to ollama
        if provider == 'gemini':
            
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
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={api_key}"
            
            payload = {"contents": contents}
            if system_instruction:
                payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
            
            payload["generationConfig"] = {"temperature": 0.7}
            
            response = requests.post(url, json=payload, timeout=90)
            response.raise_for_status()
            res_data = response.json()
            
            try:
                content = res_data['candidates'][0]['content']['parts'][0]['text']
            except (KeyError, IndexError):
                content = f"Error parsing Gemini response: {res_data}"
                
            return jsonify({'content': content})

        elif provider == 'ollama':
            url = api_url or 'http://localhost:11434'
            if not url.endswith('/api/chat'):
                url = url.rstrip('/') + '/api/chat'
            payload = {
                "model": model or "llama3",
                "messages": messages,
                "stream": False,
                "options": {"temperature": 0.7}
            }
            response = make_local_request('POST', url, json=payload, timeout=90)
            response.raise_for_status()
            res_data = response.json()
            content = res_data.get('message', {}).get('content', '')
            return jsonify({'content': content})
            
        elif provider == 'nvidia':
            url = f"{api_url or 'https://integrate.api.nvidia.com/v1'}/chat/completions"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            payload = {
                "model": model or "meta/llama-3-70b-instruct",
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

@app.route('/api/voice/query', methods=['POST'])
def voice_query():
    data = request.get_json() or {}
    query_text = data.get("query", "").strip()
    if not query_text:
        return jsonify({"error": "Empty query"}), 400
        
    try:
        username = "operator"
        twin_profile = ""
        conn = sqlite3.connect(SQLITE_DB)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator'")
        row = cursor.fetchone()
        conn.close()
        
        if row:
            row_dict = dict(row)
            username = row_dict.get("username", "operator")
            twin_profile = row_dict.get("twinProfile", "")
            
        tasks = load_tasks_db()
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
            
        provider = "gemini" if os.environ.get("GEMINI_API_KEY") else "ollama"
        model = "gemini-1.5-flash" if provider == "gemini" else "gemma2:2b"
        
        reply = ""
        if provider == "gemini":
            api_key = os.environ.get("GEMINI_API_KEY")
            contents = []
            for msg in voice_conversation_history:
                contents.append({
                    "role": "user" if msg["role"] == "user" else "model",
                    "parts": [{"text": msg["content"]}]
                })
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = {
                "contents": contents,
                "systemInstruction": {"parts": [{"text": system_prompt}]}
            }
            res = requests.post(url, json=payload, timeout=10)
            if res.status_code == 200:
                res_data = res.json()
                try:
                    reply = res_data['candidates'][0]['content']['parts'][0]['text']
                except Exception:
                    reply = "Brief complete. Operator target updated."
            else:
                provider = "ollama"
                
        if provider == "ollama":
            url = "http://localhost:11434/api/chat"
            messages = [{"role": "system", "content": system_prompt}]
            for msg in voice_conversation_history:
                messages.append({"role": msg["role"], "content": msg["content"]})
            payload = {
                "model": model,
                "messages": messages,
                "stream": False
            }
            res = requests.post(url, json=payload, timeout=10)
            if res.status_code == 200:
                reply = res.json().get('message', {}).get('content', '')
            else:
                reply = "Tactical link offline. Manual input requested."
                
        voice_conversation_history.append({"role": "assistant", "content": reply})
        return jsonify({"content": reply})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/ai/models', methods=['GET'])
def list_models():
    provider = request.args.get('provider', 'ollama')
    api_url = request.args.get('apiUrl')
    api_key = request.args.get('apiKey')
    print(f"[DEBUG MODEL LIST] provider={provider}, api_url={api_url}, api_key={api_key}", flush=True)
    
    if provider == 'gemini':
        default_gemini_models = [
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-2.5-flash',
            'gemini-2.5-pro'
        ]
        if not api_key or not api_key.strip():
            return jsonify({'models': default_gemini_models, 'offline': True})
            
        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key.strip()}"
        try:
            response = requests.get(url, timeout=3)
            if response.status_code == 200:
                data = response.json()
                models = [m['name'].split('/')[-1] for m in data.get('models', []) if 'gemini' in m.get('name', '').lower()]
                if models:
                    return jsonify({'models': models, 'offline': False})
                return jsonify({'models': default_gemini_models, 'offline': False})
        except Exception:
            pass
        return jsonify({'models': default_gemini_models, 'offline': True})

    elif provider == 'ollama':
        fallback_models = ['llama3', 'llama3.1', 'mistral', 'gemma', 'phi3']
        url = (api_url or 'http://localhost:11434').rstrip('/') + '/api/tags'
        try:
            response = make_local_request('GET', url, timeout=3)
            print(f"[DEBUG OLLAMA PING] url={url}, status_code={response.status_code}", flush=True)
            if response.status_code == 200:
                data = response.json()
                models = [m['name'] for m in data.get('models', [])]
                print(f"[DEBUG OLLAMA PING] found models={models}", flush=True)
                if models:
                    return jsonify({'models': models, 'offline': False})
                else:
                    print(f"[DEBUG OLLAMA PING] tags succeeded but models list is empty", flush=True)
                    # Even if models list is empty, the service itself is online!
                    return jsonify({'models': fallback_models, 'offline': False})
        except Exception as e:
            print(f"[DEBUG OLLAMA ERROR] error={e}", flush=True)
            pass
        return jsonify({'models': fallback_models, 'offline': True})
        
    elif provider == 'nvidia':
        default_nim_models = [
            'meta/llama-3-70b-instruct',
            'meta/llama-3.1-70b-instruct',
            'meta/llama-3.1-405b-instruct',
            'nvidia/llama-3.1-nemotron-70b-instruct',
            'mistralai/mixtral-8x22b-instruct-v0.1',
            'microsoft/phi-3-medium-128k-instruct'
        ]
        if api_key:
            url = f"{(api_url or 'https://integrate.api.nvidia.com/v1').rstrip('/')}/models"
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            }
            try:
                response = requests.get(url, headers=headers, timeout=4)
                if response.status_code == 200:
                    data = response.json()
                    models = [m['id'] for m in data.get('data', [])]
                    chat_models = [m for m in models if 'instruct' in m.lower() or 'chat' in m.lower()]
                    if chat_models:
                        return jsonify({'models': chat_models, 'offline': False})
                    elif models:
                        return jsonify({'models': models, 'offline': False})
            except Exception:
                pass
        return jsonify({'models': default_nim_models, 'offline': True})

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
        voice_clients.append(q)
        # Send an initial ping to establish connection
        q.put({"status": "connected"})
        try:
            while True:
                data = q.get()
                yield f"data: {json.dumps(data)}\n\n"
        except GeneratorExit:
            voice_clients.remove(q)
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
    
    tasks = load_tasks_db()
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
    is_speaking = False
    # 1. Stop current audio playback
    try:
        sd.stop()
    except Exception as e:
        print(f"[Voice Stop Error] Failed to stop sounddevice: {e}")
        
    # 2. Clear speech queue
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

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    settings_file = os.path.join(os.path.dirname(__file__), 'settings.json')
    conn = sqlite3.connect(SQLITE_DB)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if request.method == 'POST':
        data = request.get_json() or {}
        
        # Load existing row first to merge fields (e.g. keep streak/counts if not passed)
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator'")
        row = cursor.fetchone()
        
        username = data.get('username', row['username'] if row else 'user')
        sleep_start = int(data.get('sleepStart', row['sleepStart'] if row else 23))
        sleep_end = int(data.get('sleepEnd', row['sleepEnd'] if row else 7))
        ntfy_topic = data.get('ntfyTopic', row['ntfyTopic'] if row else 'chronos-alerts-user')
        twin_profile = data.get('twinProfile', row['twinProfile'] if row else '')
        procrastination_rating = float(data.get('procrastinationRating', row['procrastinationRating'] if row else 8.0))
        attention_cycle = data.get('attentionCycle', row['attentionCycle'] if row else 'Focus cycles peak late evening')
        stress_response = data.get('stressResponse', row['stressResponse'] if row else 'Postpones tasks under high workload pressure')
        
        execution_count = int(data.get('executionCount', row['executionCount'] if row else 0))
        failure_count = int(data.get('failureCount', row['failureCount'] if row else 0))
        streak_count = int(data.get('streakCount', row['streakCount'] if row else 0))
        total_recovered_hours = float(data.get('totalRecoveredHours', row['totalRecoveredHours'] if row else 0.0))
        
        cursor.execute("""
        INSERT INTO settings (
            id, username, sleepStart, sleepEnd, ntfyTopic, twinProfile,
            procrastinationRating, attentionCycle, stressResponse,
            executionCount, failureCount, streakCount, totalRecoveredHours
        ) VALUES (
            'active_operator', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        ) ON CONFLICT(id) DO UPDATE SET
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
            totalRecoveredHours=excluded.totalRecoveredHours
        """, (
            username, sleep_start, sleep_end, ntfy_topic, twin_profile,
            procrastination_rating, attention_cycle, stress_response,
            execution_count, failure_count, streak_count, total_recovered_hours
        ))
        conn.commit()
        conn.close()
        
        # Keep settings.json backup updated (also persist AI config if provided)
        data_to_save = {
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
            "totalRecoveredHours": total_recovered_hours
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
            
        return jsonify(data_to_save)

    else:
        cursor.execute("SELECT * FROM settings WHERE id = 'active_operator'")
        row = cursor.fetchone()
        conn.close()
        if row:
            return jsonify(dict(row))
            
        # Fallback to file settings if SQLite row is missing
        if os.path.exists(settings_file):
            try:
                with open(settings_file, 'r') as f:
                    return jsonify(json.load(f))
            except Exception:
                pass
        return jsonify({"username": "user", "twinProfile": "", "sleepStart": 23, "sleepEnd": 7, "ntfyTopic": "chronos-alerts-user", "procrastinationRating": 8.0})

@app.route('/api/tasks/presets/load', methods=['POST'])
def load_presets():
    import datetime
    # Load preset active missions
    # Mocking: Hackathon Project, Cloud Infrastructure, Pitch Deck
    conn = sqlite3.connect(SQLITE_DB)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM tasks")
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
        t_eval = evaluate_task(t)
        save_task_db(t_eval)
        
    return jsonify({"status": "presets_loaded", "count": len(presets)})

@app.route('/api/calendar/sync', methods=['POST'])
def calendar_sync():
    import datetime
    # Sync tasks from Google Calendar
    # Mocking two high-fidelity tasks synchronized from Google Calendar
    tasks = load_tasks_db()
    
    # Calculate friday/monday deadlines relative to today
    today = datetime.datetime.now()
    days_to_friday = (4 - today.weekday()) % 7
    if days_to_friday == 0: days_to_friday = 7
    due_friday = (today + datetime.timedelta(days=days_to_friday)).replace(hour=14, minute=0, second=0).isoformat() + "Z"
    
    days_to_monday = (7 - today.weekday()) % 7
    if days_to_monday == 0: days_to_monday = 7
    due_monday = (today + datetime.timedelta(days=days_to_monday)).replace(hour=9, minute=0, second=0).isoformat() + "Z"
    
    cal_tasks = [
        {
            "id": "gcal-chemistry-exam",
            "title": "Chemistry Exam Prep",
            "due": due_friday,
            "estimatedHours": 4.0,
            "importance": "high",
            "completed": False,
            "survivalScore": 60,
            "escalationLevel": "yellow",
            "category": json.dumps({"locked_intake": True, "aiSummary": [], "completedCheckpoints": []})
        },
        {
            "id": "gcal-physics-exam",
            "title": "Physics Exam Prep",
            "due": due_monday,
            "estimatedHours": 5.0,
            "importance": "high",
            "completed": False,
            "survivalScore": 75,
            "escalationLevel": "green",
            "category": json.dumps({"locked_intake": True, "aiSummary": [], "completedCheckpoints": []})
        }
    ]
    
    count = 0
    for ct in cal_tasks:
        if not any(t['id'] == ct['id'] for t in tasks):
            ct_eval = evaluate_task(ct)
            save_task_db(ct_eval)
            count += 1
            
    if count > 0:
        send_phone_notification("Google Calendar Synced", f"Imported {count} locked calendar events. AI Intake briefing required to activate timeline.")
        speech_queue.put(f"Google Calendar synced. {count} mission targets imported. Complete the intake briefings to activate.")
        
    return jsonify({"status": "synced", "count": count})

# Background Scheduler Job Initialization (runs evaluation loop every 30s)
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    
    def background_pulse_job():
        print("[APScheduler] Running background cron timeline evaluation...", flush=True)
        try:
            tasks = load_tasks_db()
            for t in tasks:
                if not t.get('completed', False):
                    t_eval = evaluate_task(t)
                    save_task_db(t_eval)
        except Exception as e:
            print(f"[APScheduler Job Error] {e}")

    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(background_pulse_job, 'interval', seconds=30)
    scheduler.start()
    print("✅ Background APScheduler initialized. Pulses scheduled every 30s.")
except Exception as e:
    print(f"Warning: Failed to load APScheduler ({e}). Falling back to browser-pulsed triggers.")

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != '' and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)