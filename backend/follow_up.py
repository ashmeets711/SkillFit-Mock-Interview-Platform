"""
follow_up.py – Selects an appropriate follow-up question based on evaluation score.
"""


def generate_follow_up(question_data: dict, evaluation: dict) -> str | None:
    """
    Choose the right follow-up question string based on the evaluation score.

    Args:
        question_data:  The original question dict (must contain 'follow_ups').
        evaluation:     The dict returned by AnswerEvaluator.evaluate().

    Returns:
        A follow-up question string, or None if the answer was strong enough
        that a follow-up is unnecessary.
    """
    score = evaluation.get("overall_score", 0)
    follow_ups = question_data.get("follow_ups", {})

    # No follow-up for very strong answers
    if score >= 85:
        return None

    if score < 45:
        key = "low_score"
    elif score < 70:
        key = "medium_score"
    else:
        key = "generic"

    return follow_ups.get(key) or follow_ups.get("generic")
