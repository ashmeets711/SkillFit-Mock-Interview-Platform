"""
database.py – SQLAlchemy models and helper functions for the Mock Interview AI.
"""

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Interview(db.Model):
    """Represents a single interview session."""
    __tablename__ = "interviews"

    id = db.Column(db.Integer, primary_key=True)
    role = db.Column(db.String(128), nullable=False)
    skills = db.Column(db.Text, nullable=True)          # comma-separated skills
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    answers = db.relationship("Answer", backref="interview", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "role": self.role,
            "skills": self.skills,
            "created_at": self.created_at.isoformat(),
        }


class Answer(db.Model):
    """Stores one answer within an interview session."""
    __tablename__ = "answers"

    id = db.Column(db.Integer, primary_key=True)
    interview_id = db.Column(db.Integer, db.ForeignKey("interviews.id"), nullable=False)

    question_text = db.Column(db.Text, nullable=False)
    answer_text = db.Column(db.Text, nullable=True)
    score = db.Column(db.Float, nullable=True)
    feedback = db.Column(db.Text, nullable=True)
    question_type = db.Column(db.String(64), nullable=True)  # technical / behavioral / case_study

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "interview_id": self.interview_id,
            "question_text": self.question_text,
            "answer_text": self.answer_text,
            "score": self.score,
            "feedback": self.feedback,
            "question_type": self.question_type,
        }


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def init_db(app):
    """Initialise the database with the Flask app context."""
    db.init_app(app)
    with app.app_context():
        db.create_all()


def create_interview_session(role: str, skills: str) -> int:
    """Create a new interview record and return its id (session_id)."""
    interview = Interview(role=role, skills=skills)
    db.session.add(interview)
    db.session.commit()
    return interview.id


def store_answer(interview_id: int, question_text: str, answer_text: str,
                 score: float, feedback: str, question_type: str = "general") -> int:
    """Persist a single answer record and return its id."""
    answer = Answer(
        interview_id=interview_id,
        question_text=question_text,
        answer_text=answer_text,
        score=score,
        feedback=feedback,
        question_type=question_type,
    )
    db.session.add(answer)
    db.session.commit()
    return answer.id


def get_report(interview_id: int) -> dict:
    """Return the full report for a given interview session."""
    interview = db.session.get(Interview, interview_id)
    if not interview:
        return None

    answers = [a.to_dict() for a in interview.answers]
    avg_score = (
        round(sum(a["score"] for a in answers if a["score"] is not None) / len(answers), 2)
        if answers else 0
    )

    return {
        "interview": interview.to_dict(),
        "answers": answers,
        "summary": {
            "total_questions": len(answers),
            "average_score": avg_score,
        },
    }
