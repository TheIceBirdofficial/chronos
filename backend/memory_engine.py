import json
import datetime
import sqlite3
import os
import threading

LAYER_IDENTITY = 'identity'
LAYER_TWIN_PROFILE = 'twin_profile'
LAYER_BEHAVIOR_MEMORY = 'behavior_memory'
LAYER_MISSION_MEMORY = 'mission_memory'
LAYER_CONVERSATION_MEMORY = 'conversation_memory'
LAYER_REFERENCE_MEMORY = 'reference_memory'
LAYER_TIMELINE_MEMORY = 'timeline_memory'

ALL_LAYERS = [
    LAYER_IDENTITY,
    LAYER_TWIN_PROFILE,
    LAYER_BEHAVIOR_MEMORY,
    LAYER_MISSION_MEMORY,
    LAYER_CONVERSATION_MEMORY,
    LAYER_REFERENCE_MEMORY,
    LAYER_TIMELINE_MEMORY,
]


def get_db_path():
    return os.environ.get("SQLITE_DB_PATH", os.path.join(os.path.dirname(__file__), 'chronos.db'))


def get_db_conn():
    conn = sqlite3.connect(get_db_path(), timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_memory_table():
    conn = get_db_conn()
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS memory_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT DEFAULT 'anonymous',
        layer TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        source TEXT DEFAULT '',
        timestamp TEXT NOT NULL,
        UNIQUE(user_id, layer, key)
    )
    """)
    conn.commit()
    conn.close()


def get_memory(user_id, layer=None):
    conn = get_db_conn()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    if layer:
        cursor.execute(
            "SELECT layer, key, value, source, timestamp FROM memory_entries WHERE user_id = ? AND layer = ? ORDER BY timestamp DESC",
            (user_id, layer),
        )
    else:
        cursor.execute(
            "SELECT layer, key, value, source, timestamp FROM memory_entries WHERE user_id = ? ORDER BY layer, key",
            (user_id,),
        )
    rows = cursor.fetchall()
    conn.close()
    result = {}
    for row in rows:
        d = dict(row)
        l = d.pop('layer')
        if l not in result:
            result[l] = {}
        result[l][d['key']] = d
    return result


def upsert_memory(user_id, layer, key, value, source=''):
    conn = get_db_conn()
    cursor = conn.cursor()
    now = datetime.datetime.utcnow().isoformat() + 'Z'
    val_str = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
    cursor.execute("""
    INSERT INTO memory_entries (user_id, layer, key, value, source, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, layer, key) DO UPDATE SET
        value = excluded.value,
        source = excluded.source,
        timestamp = excluded.timestamp
    """, (user_id, layer, key, val_str, source, now))
    conn.commit()
    conn.close()
    return {'layer': layer, 'key': key, 'value': val_str, 'source': source, 'timestamp': now}


def delete_memory(user_id, layer, key):
    conn = get_db_conn()
    cursor = conn.cursor()
    cursor.execute(
        "DELETE FROM memory_entries WHERE user_id = ? AND layer = ? AND key = ?",
        (user_id, layer, key),
    )
    conn.commit()
    conn.close()


def get_timeline(user_id, limit=50, offset=0):
    conn = get_db_conn()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute(
        "SELECT key, value, source, timestamp FROM memory_entries WHERE user_id = ? AND layer = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        (user_id, LAYER_TIMELINE_MEMORY, limit, offset),
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def ingest_timeline_event(user_id, event_key, description, source='system'):
    return upsert_memory(user_id, LAYER_TIMELINE_MEMORY, event_key, description, source)


def get_memory_summary(user_id):
    mem = get_memory(user_id)
    summary = {}
    for layer in ALL_LAYERS:
        entries = mem.get(layer, {})
        summary[layer] = {k: v.get('value', '') for k, v in entries.items()}
    return summary
