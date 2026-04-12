"""
question_bank.py – Generates a structured interview question set using the Groq LLM API.
"""

import os
import json
import random
from groq import Groq


SYSTEM_PROMPT = """
You are an expert technical interviewer. Your task is to generate a complete, structured mock interview 
for the given role and skills. You must respond ONLY with a valid JSON object—no explanations, no markdown.

The JSON structure must be exactly as follows:
{
  "technical": [
    {
      "id": "t1",
      "question": "<question text>",
      "expected_keywords": ["keyword1", "keyword2"],
      "follow_ups": {
        "low_score": "<follow-up for weak answer>",
        "medium_score": "<follow-up for adequate answer>",
        "generic": "<a generic follow-up>"
      }
    }
  ],
  "behavioral": [
    {
      "id": "b1",
      "question": "<behavioral question>",
      "expected_keywords": ["structured", "teamwork", "outcome"],
      "follow_ups": {
        "low_score": "<follow-up for weak answer>",
        "medium_score": "<follow-up for adequate answer>",
        "generic": "<a generic follow-up>"
      }
    }
  ],
  "case_study": [
    {
      "id": "cs1",
      "question": "<case study or scenario question>",
      "expected_keywords": ["scalability", "trade-offs", "design"],
      "follow_ups": {
        "low_score": "<follow-up for weak answer>",
        "medium_score": "<follow-up for adequate answer>",
        "generic": "<a generic follow-up>"
      }
    }
  ]
}

Generate 4 technical, 3 behavioral, and 2 case_study questions. Tailor them specifically to the role and skills provided.
Ensure each question is specific, challenging, and directly related to the provided skills.
"""


class LLMQuestionGenerator:
    """Generates interview questions using the Groq LLM API."""

    def __init__(self):
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise EnvironmentError(
                "GROQ_API_KEY environment variable is not set. "
                "Please export it before running the application."
            )
        self.client = Groq(api_key=api_key)
        self.model = "llama-3.1-8b-instant"

    def get_questions_for_role_and_skills(self, role: str, skills: str) -> list:
        """
        Call the Groq API to generate a structured interview and return a
        combined, shuffled list of all question objects.

        Args:
            role:   The target job role (e.g., "Python Developer").
            skills: Comma-separated list of skills (e.g., "Django, AWS, Docker").

        Returns:
            A list of question dicts, each containing 'id', 'question',
            'expected_keywords', 'follow_ups', and 'type'.
        """
        user_message = (
            f"Generate a complete mock interview for a '{role}' with expertise in: {skills}. "
            "Follow the JSON structure exactly as instructed."
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                response_format={"type": "json_object"},
                temperature=0.7,
                max_tokens=4096,
            )

            raw_content = response.choices[0].message.content
            data = json.loads(raw_content)

        except Exception as exc:
            raise RuntimeError(f"Groq API call failed: {exc}") from exc

        # Combine and annotate all question types
        all_questions = []
        for q_type in ("technical", "behavioral", "case_study"):
            for q in data.get(q_type, []):
                q["type"] = q_type
                all_questions.append(q)

        random.shuffle(all_questions)
        return all_questions
