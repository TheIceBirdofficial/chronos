import random
import os

categories = {
    "scheduling": [
        "Leaving in {minutes} minutes preserves your arrival margin for {activity}.",
        "Your buffer window for {activity} is currently {minutes} minutes.",
        "Adjusting departure offset by {minutes} minutes defends your calendar target for {activity}.",
        "A scheduling conflict is predicted between {activity} and {task} in the next {hours} hours."
    ],
    "deadlines": [
        "Beginning {task} tonight reduces deadline risk by {percentage} percent.",
        "Your current workflow velocity on {task} indicates a {percentage} percent probability of delay.",
        "Initiating action on {task} now preserves a safety buffer of {hours} hours.",
        "The calculated point of no return for {task} is {time}."
    ],
    "focus": [
        "Your attention span on {task} has remained stable for {minutes} minutes.",
        "Establishing focus bubble for {task}. Muting active intervention channels.",
        "Focus session for {task} synced. Remaining effort is estimated at {hours} hours.",
        "Warning. Attention drift detected on {task}. Recommend a {minutes}-minute cognitive reset."
    ],
    "predictive_analysis": [
        "Historical behavior on {task} indicates increased risk of deadline decay.",
        "Previous telemetry logs suggest a procrastination spike during the {activity} window.",
        "Active Intervention System has adjusted survival probability for {task} to {percentage} percent.",
        "Predictive modeling indicates target completion of {task} is shifting by {hours} hours."
    ],
    "motivation": [
        "Completion of {task} today reduces tomorrow's workload by {percentage} percent.",
        "Executing recovery protocol on {task} now saves approximately {hours} hours of overhead.",
        "Securing this milestone for {task} mitigates cognitive fatigue for the remaining queue.",
        "You are currently {percentage} percent ahead of your weekly baseline for {activity}."
    ]
}

# Values to populate templates
values = {
    "minutes": ["five", "eight", "ten", "twelve", "fifteen", "twenty", "twenty-five", "thirty", "thirty-five", "forty", "forty-five", "fifty", "fifty-five"],
    "hours": ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fourteen", "eighteen", "twenty-four"],
    "percentage": ["twelve", "fifteen", "nineteen", "twenty-four", "thirty-one", "thirty-seven", "forty-two", "fifty-five", "sixty-one", "seventy-eight", "eighty-five", "ninety-two", "ninety-nine"],
    "time": ["one fifteen PM", "two thirty PM", "three forty-five PM", "four o'clock PM", "five fifteen PM", "six thirty PM", "seven forty-five PM", "eight o'clock PM", "nine fifteen PM", "ten thirty PM", "eleven forty-five PM", "midnight", "eight o'clock AM", "nine thirty AM", "ten forty-five AM", "noon"],
    "activity": ["your meeting", "commute", "project defense", "review cycle", "client sync", "standup call", "database migration", "deployment window", "design sprint", "system validation", "api verification", "milestone review"],
    "task": ["your presentation slides", "your api endpoints", "your deployment script", "your css styling sheets", "your security audit report", "your database index creation", "your environment variables setup", "your performance twin analysis", "your active intervention system check", "your recovery protocol setup", "the telemetry logger", "the scheduler module", "the voice daemon configuration", "the onboarding questionnaire", "the UI testing suite"]
}

def main():
    output_dir = "datasets"
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "chronos_domain_text.txt")
    generated_sentences = set()

    # Generate 3,200+ distinct sentences
    # Safe checks since total combinations are > 6,000
    while len(generated_sentences) < 3200:
        cat = random.choice(list(categories.keys()))
        template = random.choice(categories[cat])
        
        # Populate templates
        sentence = template.format(
            minutes=random.choice(values["minutes"]),
            hours=random.choice(values["hours"]),
            percentage=random.choice(values["percentage"]),
            time=random.choice(values["time"]),
            activity=random.choice(values["activity"]),
            task=random.choice(values["task"])
        )
        generated_sentences.add(sentence)

    with open(output_file, "w", encoding="utf-8") as f:
        for s in sorted(generated_sentences):
            f.write(s + "\n")

    print(f"Success: Generated {len(generated_sentences)} Chronos-specific sentences in {output_file}")

if __name__ == "__main__":
    main()
