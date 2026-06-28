# Chronos – Temporal Threat Command Dashboard

Chronos is an AI-powered, biologically constrained deadline defense command center designed to defend user schedules and recovery windows against deadline collapse. Moving away from passive calendar planners, Chronos models user procrastination, calculates real-time task survival probabilities, and deploys active voice-based interventions.

---

## 🛡️ The 3 Pillars of Chronos

1. **Biologically Constrained**
   - Standard planners treat time as an infinite canvas. Chronos treats sleep and circadian recovery windows as hard, immutable physical boundaries, automatically rescheduling tasks and warning when deadlines compress rest cycles.
2. **Telemetry-Driven Telemetry**
   - Renders a live mission control telemetry deck. Every mission displays survival probability percentages, calculated intervention confidence ratings, and expected improvement margins.
3. **Closed-Loop Adaptation**
   - Chronos tracks its own warning success/ignore rates inside `interventions.json`. Over time, the assistant adapts its behavioral urgency and spoken alert weights dynamically depending on user action.

---

## 🌟 Core Features

1. **Chronos Mission Control (Dashboard)**
   - Futuristic dark-themed layout with responsive WebGL particle core.
   - **Active Temporal Defense Targets**: View task urgency, importance, and AI-computed survival statistics.
   - **Explainability Telemetry**: Live telemetry logs displaying reason, confidence %, expected improvements, and action items (e.g. Sleep defended).
   - **Developer Presets**: Click one button to pre-populate SQLite with 3 active demo missions (stable, warning, and emergency collapse).

2. **Google Calendar & AI Intake Lock**
   - Syncs Google Calendar events. Synced tasks are created as "Locked Targets".
   - Locked targets block sprints and edits. The operator must complete the **AI Intake Summarizer** briefing flow to unlock and activate them on the timeline.

3. **Cloud-Native Web Speech Fallback**
   - If the local Python voice engine is offline (e.g., when deployed on Google Cloud or missing PortAudio DLLs), the frontend automatically uses browser-native `SpeechSynthesis` and `SpeechRecognition` so the user can talk to Chronos directly in the browser.

4. **Executive Focus Mode (Sprint)**
   - Cybernetic countdown sprint timer card with rotating conic-gradient radar lines and pulse wave animations.
   - Locks down interface distraction when started and logs deficits directly.

5. **Temporal Branch Viewer (Timeline)**
   - Alternating road-map scroll view showing milestone phases.
   - Checkpoint count dynamically expands based on task complexity.

6. **Out-of-Band Phone Link**
   - Dispatches emergency notifications to your mobile phone via `ntfy` if focus fails.

---

## 📂 Project Structure

```text
chronos/
├── backend/
│   ├── app.py               # Flask REST API, SQLite connection & AI Proxy
│   ├── chronos.db           # SQLite Database
│   └── requirements.txt     # Python Dependencies
├── frontend/
│   ├── src/
│   │   ├── app/             # Next.js Pages (timeline, sprint, phone-link, onboarding)
│   │   └── components/      # Glassmorphic UI & Canvas Components
│   └── package.json         # Node Dependencies
└── README.md                # System Documentation
```

---

## 🚀 Quick Start (Development)

### Prerequisites
- **Python 3.10+** & `pip`
- **Node.js 18+** & `npm`
- **Ollama** (optional, for local model execution using `gemma2:2b`)

---

### 1️⃣ Run the Backend Server

```bash
cd backend
# Install dependencies
pip install -r requirements.txt

# Start Flask
python app.py
```
*The API will start running on [http://localhost:5000](http://localhost:5000).*

---

### 2️⃣ Run the Next.js Frontend

```bash
cd frontend
# Install dependencies
npm install

# Start Next.js Development Server
npm run dev
```
*Open your browser and navigate to [http://localhost:3000](http://localhost:3000).*

---

## 🔧 AI Engine Configurations
To edit the AI Provider:
1. Navigate to the onboarding portal or click **AI Core Settings** in the dashboard.
2. Select **Gemini** (requires key) or **Ollama** (runs locally on port 11434).
3. If using Ollama, ensure your local instance is active and has the model pulled:
   ```bash
   ollama pull gemma2:2b
   ```

---
*Built with ❤️ for the Chronos Deadline Defense Core.*