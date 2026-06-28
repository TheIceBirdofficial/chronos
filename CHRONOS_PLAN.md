# Chronos Project Plan

## Goal (the thing judges remember)
**One-line pitch:**
Chronos predicts missed deadlines before they happen and actively helps users recover before failure.

Everything else should serve this.

## MVP Features (must-have)

### A. Deadline Intake
User enters:
- Task name
- Deadline
- Estimated effort
- Importance

**Example:**
- Mechanical Design Assignment
- Due: Friday 5 PM
- Estimated effort: 6 hours
- Importance: High

### B. Risk Engine ⭐
Chronos calculates:
- Time remaining
- Work remaining
- User activity
- Completion probability

**Output:**
- Success Probability: 42%
- Risk Level: HIGH

*This is your differentiator.*

### C. Dynamic Planning
Instead of static tasks:
- Tonight: Research topic (30 min)
- Tomorrow: Draft report (90 min)

Plan changes automatically if the user falls behind.

### D. Intervention System
Escalation levels:
- **Green**: Gentle reminder
- **Yellow**: Warning
- **Orange**: Recovery plan
- **Red**: Emergency mode

**Example:**
"You've ignored this task for 3 days. Starting recovery plan."

### E. AI Rescue Actions
Chronos should do work.
Examples:
- Generate assignment outline
- Create study checklist
- Draft email
- Summarize research

*This is where the AI feels useful.*

## Features to Skip
Do NOT build:
- ❌ Chat system
- ❌ Social features
- ❌ Team collaboration
- ❌ Complex calendar sync
- ❌ Mobile app
- ❌ Gamification
- ❌ 100 different agents

You'll die in implementation.

## Tech Stack
Since you're already deep into TS land:
- **Frontend**: Next.js, TypeScript, Tailwind, Shadcn UI
- **Backend**: Supabase
- **Tables**: users, tasks, task_events, interventions
- **AI**: OpenAI, DeepInfra, NVIDIA NIM (any one works)
- **No agent frameworks needed**

## The Dashboard
The homepage should look like mission control:

```
TASK SURVIVAL CENTER
Mechanical Assignment   92% Survival
Lab Report              61% Survival
Internship Application  23% Survival   ⚠ CRITICAL
```

That visual alone communicates the entire product.

## Judging Demo Flow
The demo should be:
1. Create task.
2. Chronos generates plan.
3. Simulate user ignoring task.
4. Risk score drops.
5. Chronos enters recovery mode.
6. Chronos generates resources and rescue plan.
7. Task returns to safe status.

That's a clean 2–3 minute demo.

## Milestones
**Phase 1**
- Authentication
- Task creation
- Dashboard

**Phase 2**
- Risk calculation engine
- Survival scores

**Phase 3**
- AI planning

**Phase 4**
- Intervention engine

**Phase 5**
- Demo polish
- Animations
- Empty states
- Presentation

## Final Scope Statement
If I were freezing the scope tonight, I'd define Chronos as:

**An AI-powered Deadline Defense System that continuously evaluates task failure risk, adapts plans in real time, and intervenes before commitments become missed deadlines.**

That is focused, implementable, and much stronger than "AI task manager."