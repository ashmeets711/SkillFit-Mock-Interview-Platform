"""
nlp_evaluator.py – Evaluates interview answers using NLP techniques.
"""

import ssl
import certifi
import nltk
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity


# ---------------------------------------------------------------------------
# macOS SSL fix – Python venvs on macOS ship without the system CA bundle.
# Pointing ssl to certifi's bundle lets NLTK (and any urllib call) succeed.
# ---------------------------------------------------------------------------
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    # Only apply if the default context is broken (macOS venv issue)
    try:
        ssl.create_default_context(cafile=certifi.where())
    except Exception:
        ssl._create_default_https_context = _create_unverified_https_context


# ---------------------------------------------------------------------------
# NLTK data – download punkt if missing; non-fatal if network is blocked.
# ---------------------------------------------------------------------------
for _resource in ("tokenizers/punkt", "tokenizers/punkt_tab"):
    try:
        nltk.data.find(_resource)
    except LookupError:
        resource_name = _resource.split("/")[1]
        try:
            nltk.download(resource_name, quiet=True)
        except Exception as _e:
            print(f"[NLPEvaluator] Could not download NLTK '{resource_name}': {_e} (non-fatal)")
    except Exception:
        pass


class AnswerEvaluator:
    """
    Scores a candidate's answer against the question using:
      - Keyword Coverage   (30 %)
      - Semantic Relevance (50 %)
      - Clarity            (20 %)
    """

    MODEL_NAME = "all-MiniLM-L6-v2"

    # Word-count thresholds for clarity scoring
    CLARITY_MIN_WORDS = 20
    CLARITY_GOOD_WORDS = 80

    def __init__(self):
        print(f"[NLPEvaluator] Loading sentence-transformer model '{self.MODEL_NAME}' …")
        self.model = SentenceTransformer(self.MODEL_NAME)
        print("[NLPEvaluator] Model loaded.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def evaluate(self, question: str, answer: str, expected_keywords: list) -> dict:
        """
        Evaluate *answer* relative to *question* and the list of expected keywords.

        Returns:
            {
                "overall_score": float (0–100),
                "keyword_score": float (0–100),
                "relevance_score": float (0–100),
                "clarity_score": float (0–100),
                "feedback": str,
                "matched_keywords": list[str],
            }
        """
        if not answer or not answer.strip():
            return self._empty_result()

        keyword_score, matched = self._keyword_coverage(answer, expected_keywords)
        relevance_score = self._semantic_relevance(question, answer)
        clarity_score = self._clarity(answer)

        overall_score = (
            0.50 * relevance_score
            + 0.30 * keyword_score
            + 0.20 * clarity_score
        )
        overall_score = round(min(max(overall_score, 0), 100), 2)

        feedback = self._build_feedback(overall_score, keyword_score, relevance_score,
                                        clarity_score, matched, expected_keywords)

        return {
            "overall_score": overall_score,
            "keyword_score": round(keyword_score, 2),
            "relevance_score": round(relevance_score, 2),
            "clarity_score": round(clarity_score, 2),
            "feedback": feedback,
            "matched_keywords": matched,
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _keyword_coverage(self, answer: str, keywords: list):
        """Return (score 0-100, list_of_matched_keywords)."""
        if not keywords:
            return 100.0, []

        answer_lower = answer.lower()
        matched = [kw for kw in keywords if kw.lower() in answer_lower]
        score = (len(matched) / len(keywords)) * 100
        return score, matched

    def _semantic_relevance(self, question: str, answer: str) -> float:
        """Cosine similarity between question and answer embeddings, scaled to 0-100."""
        try:
            embeddings = self.model.encode([question, answer])
            sim = cosine_similarity([embeddings[0]], [embeddings[1]])[0][0]
            # cosine similarity is in [-1, 1]; map to [0, 100]
            score = float((sim + 1) / 2 * 100)
            return round(score, 2)
        except Exception:
            return 50.0   # neutral fallback

    def _clarity(self, answer: str) -> float:
        """Simple clarity score based on word count."""
        words = answer.split()
        word_count = len(words)
        if word_count >= self.CLARITY_GOOD_WORDS:
            return 100.0
        if word_count <= self.CLARITY_MIN_WORDS:
            return max(0.0, (word_count / self.CLARITY_MIN_WORDS) * 40)
        # Linear interpolation between min and good
        ratio = (word_count - self.CLARITY_MIN_WORDS) / (self.CLARITY_GOOD_WORDS - self.CLARITY_MIN_WORDS)
        return round(40 + ratio * 60, 2)

    def _build_feedback(self, overall, keyword_score, relevance_score,
                        clarity_score, matched, expected_keywords):
        parts = []

        # Overall band
        if overall >= 80:
            parts.append("Excellent answer! You demonstrated strong command of the topic.")
        elif overall >= 60:
            parts.append("Good answer. You covered the key points fairly well.")
        elif overall >= 40:
            parts.append("Adequate answer, but there is room for improvement.")
        else:
            parts.append("The answer needs significant improvement.")

        # Keyword feedback
        missing = [kw for kw in expected_keywords if kw not in matched]
        if matched:
            parts.append(f"✔ Keywords covered: {', '.join(matched)}.")
        if missing:
            parts.append(f"✘ Keywords to mention next time: {', '.join(missing)}.")

        # Clarity feedback
        if clarity_score < 40:
            parts.append("Try to elaborate more—longer, structured answers score better.")
        elif clarity_score < 70:
            parts.append("Good length; consider adding more detail or examples.")

        return " ".join(parts)

    def _empty_result(self):
        return {
            "overall_score": 0.0,
            "keyword_score": 0.0,
            "relevance_score": 0.0,
            "clarity_score": 0.0,
            "feedback": "No answer was provided.",
            "matched_keywords": [],
        }
