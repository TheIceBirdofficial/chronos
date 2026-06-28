import pyaudio
import numpy as np
try:
    from openwakeword.model import Model
except ImportError:
    # Fallback mock class for runtime safety if openwakeword is not installed yet
    class Model:
        def __init__(self, **kwargs): pass
        def predict(self, x): return {"alexa": 0.0}
import requests
import time
import sys

# Try importing openwakeword or state fallback
try:
    import openwakeword
    model = Model(wakeword_models=["models/chronos.tflite"])
    print("✅ OpenWakeWord loaded with custom model: models/chronos.tflite")
except Exception:
    print("⚠️ Custom 'chronos' model not found or OpenWakeWord not installed. Using default alexa model.")
    model = Model()

# Audio capture parameters
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1280

audio = pyaudio.PyAudio()

try:
    stream = audio.open(
        format=FORMAT, 
        channels=CHANNELS, 
        rate=RATE, 
        input=True, 
        frames_per_buffer=CHUNK
    )
except Exception as e:
    print(f"❌ Failed to open microphone stream: {e}", file=sys.stderr)
    print("Please verify that PyAudio has microphone permissions and a mic is plugged in.", file=sys.stderr)
    sys.exit(1)

print("🎙️ Chronos Wake Word Listener active. Listening for 'Chronos'...")

try:
    while True:
        data = stream.read(CHUNK, exception_on_overflow=False)
        audio_frame = np.frombuffer(data, dtype=np.int16)
        
        # OpenWakeWord prediction
        prediction = model.predict(audio_frame)
        
        for key in prediction.keys():
            if prediction[key] >= 0.5:
                print(f"⚡ Wake word detected: {key} (confidence: {prediction[key]:.2f})")
                try:
                    # Notify the Chronos local backend server
                    requests.post("http://localhost:5000/api/voice/trigger", json={"status": "listening"})
                    # Wait to prevent double-firing
                    time.sleep(2.0)
                except Exception as err:
                    print(f"⚠️ Failed to contact Chronos backend: {err}")
except KeyboardInterrupt:
    print("\nStopping Chronos Wake Word Daemon.")
finally:
    stream.stop_stream()
    stream.close()
    audio.terminate()
