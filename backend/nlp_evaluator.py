"""
nlp_evaluator.py – Evaluates interview answers statelessly using the Groq LLM API.
Replaces the heavy Pytorch NLP pipeline to fit Vercel constraints.
"""

import os
import json
from groq import Groq


class AnswerEvaluator:
    """
    Scores a candidate's answer against the question by prompting Groq Llama-3.1.
    """

    SYSTEM_PROMPT = """
You are an expert technical interviewer evaluating a candidate's answer.
You must return only a valid JSON response exactly like this format:
{
    "keyword_score": 85.0,
    "relevance_score": 75.0,
    "clarity_score": 90.0,
    "overall_score": 82.5,
    "matched_keywords": ["keyword1", "keyword2"],
    "feedback": "Your qualitative feedback here."
}
Scores must be out of 100.
"""

    def __init__(self):
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise EnvironmentError("GROQ_API_KEY not set.")
        self.client = Groq(api_key=api_key)
        self.model = "llama-3.1-8b-instant"
        print("[NLPEvaluator] Initialized Statless LLM Evaluator.")

    def evaluate(self, question: str, answer: str, expected_keywords: list) -> dict:
        if not answer or not answer.strip():
            return self._empty_result()

        prompt = f"""
Question: {question}
Expected Keywords: {', '.join(expected_keywords)}

Candidate Answer: {answer}

Evaluate the candidate's answer objectively. Return JSON only.
"""
        try:
            res = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.4,
                max_tokens=500,
            )
            data = json.loads(res.choices[0].message.content)
            
            # Ensure safe outputs
            overall = float(data.get("overall_score", 50))
            return {
                "overall_score": overall,
                "keyword_score": float(data.get("keyword_score", 50)),
                "relevance_score": float(data.get("relevance_score", 50)),
                "clarity_score": float(data.get("clarity_score", 50)),
                "matched_keywords": data.get("matched_keywords", []),
                "feedback": data.get("feedback", "No feedback provided by the evaluator."),
            }

        except Exception as e:
            print(f"[NLPEvaluator] Groq evaluation failed: {e}")
            return self._empty_result()

    def _empty_result(self):
        return {
            "overall_score": 0.0,
            "keyword_score": 0.0,
            "relevance_score": 0.0,
            "clarity_score": 0.0,
            "matched_keywords": [],
            "feedback": "No answer was provided or evaluation failed.",
        }
