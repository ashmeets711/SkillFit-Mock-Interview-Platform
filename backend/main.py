"""
main.py – Flask application entry point for the Mock Interview AI platform.
"""

import os
from dotenv import load_dotenv

load_dotenv()  # Loads variables from .env into os.environ

from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

from database import db, init_db, create_interview_session, store_answer, get_report
from question_bank import LLMQuestionGenerator
from nlp_evaluator import AnswerEvaluator
from follow_up import generate_follow_up
from interview_engine import InterviewEngine
from vision import generate_frames

# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")
MODELS_DIR = os.path.join(BASE_DIR, "..", "models")
os.makedirs(MODELS_DIR, exist_ok=True)

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "mock-interview-secret-key-2024")

# Database configuration
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(MODELS_DIR, 'interviews.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

CORS(app, supports_credentials=True)
init_db(app)

# ---------------------------------------------------------------------------
# Global service instances
# ---------------------------------------------------------------------------

# These are initialised at startup; errors surface immediately.
try:
    llm_generator = LLMQuestionGenerator()
    print("[main] LLM question generator initialised.")
except EnvironmentError as e:
    print(f"[main] WARNING: {e}")
    llm_generator = None

print("[main] Loading NLP evaluator…")
evaluator = AnswerEvaluator()
print("[main] NLP evaluator ready.")

# In-memory store: session_id (str) -> InterviewEngine instance
# NB: This is process-local. For production use Redis or similar.
engines: dict[str, InterviewEngine] = {}

# ---------------------------------------------------------------------------
# Static routes
# ---------------------------------------------------------------------------

ROLES = [
    "Python Developer",
    "Frontend Developer (React)",
    "Full-Stack Engineer",
    "Data Scientist",
    "Machine Learning Engineer",
    "DevOps / Cloud Engineer",
    "Backend Engineer (Node.js)",
    "Mobile Developer (Flutter)",
    "Cybersecurity Analyst",
    "Product Manager (Technical)",
]


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "interview.html")


@app.route("/report/<int:session_id>")
def report_page(session_id):
    return send_from_directory(FRONTEND_DIR, "report.html")


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------

@app.route("/api/roles", methods=["GET"])
def get_roles():
    return jsonify({"roles": ROLES})


@app.route("/api/start_interview", methods=["POST"])
def start_interview():
    data = request.get_json(force=True)
    role = (data.get("role") or "").strip()
    skills = (data.get("skills") or "").strip()

    if not role:
        return jsonify({"error": "role is required"}), 400
    if not skills:
        return jsonify({"error": "skills are required"}), 400

    if llm_generator is None:
        return jsonify({"error": "GROQ_API_KEY is not configured on the server."}), 503

    try:
        questions = llm_generator.get_questions_for_role_and_skills(role, skills)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 502

    if not questions:
        return jsonify({"error": "No questions were generated."}), 500

    # Create DB session
    session_id = create_interview_session(role, skills)

    # Initialise engine
    engine = InterviewEngine(questions)
    engines[str(session_id)] = engine

    first_q = engine.get_current_question()

    return jsonify({
        "session_id": session_id,
        "question": _sanitise_question(first_q),
        "progress": engine.progress(),
    })


@app.route("/api/submit_answer", methods=["POST"])
def submit_answer():
    data = request.get_json(force=True)
    session_id    = str(data.get("session_id", ""))
    answer_text   = (data.get("answer") or "").strip()
    # Frontend sends True when the question being answered was itself a follow-up.
    # In that case we ALWAYS advance to the next main question – no more follow-ups.
    answering_follow_up = bool(data.get("is_follow_up", False))

    engine = engines.get(session_id)
    if engine is None:
        return jsonify({"error": "Invalid or expired session_id."}), 404

    current_q = engine.get_current_question()
    if current_q is None:
        return jsonify({"finished": True})

    # ----- Evaluate the answer -----
    evaluation = evaluator.evaluate(
        question=current_q["question"],
        answer=answer_text,
        expected_keywords=current_q.get("expected_keywords", []),
    )

    # ----- Persist to DB -----
    store_answer(
        interview_id=int(session_id),
        question_text=current_q["question"],
        answer_text=answer_text,
        score=evaluation["overall_score"],
        feedback=evaluation["feedback"],
        question_type=current_q.get("type", "general"),
    )

    # ----- Decide next question -----
    # If we're already answering a follow-up, never generate another one —
    # just advance to the next main question unconditionally.
    follow_up_text = None if answering_follow_up else generate_follow_up(current_q, evaluation)

    if follow_up_text:
        # Serve one follow-up before advancing
        is_follow_up = True
        is_finished  = False
        next_question = {
            "id": "follow_up",
            "question": follow_up_text,
            "type": "follow_up",
            "expected_keywords": current_q.get("expected_keywords", []),
            "follow_ups": current_q.get("follow_ups", {}),
        }
    else:
        # Advance to next main question
        engine.clear_follow_up_if_any()
        engine.get_next_question()          # advances current_index
        is_follow_up = False
        is_finished  = engine.is_finished()
        next_question = _sanitise_question(engine.get_current_question())

    response = {
        "evaluation": evaluation,
        "is_follow_up": is_follow_up,
        "finished": is_finished,
        "progress": engine.progress(),
    }

    if not is_finished:
        response["question"] = next_question

    return jsonify(response)


@app.route("/api/get_report/<int:session_id>", methods=["GET"])
def api_get_report(session_id):
    report = get_report(session_id)
    if report is None:
        return jsonify({"error": "Session not found."}), 404
    return jsonify(report)


# ---------------------------------------------------------------------------
# Video feed
# ---------------------------------------------------------------------------

@app.route("/video_feed")
def video_feed():
    return Response(
        generate_frames(),
        mimetype="multipart/x-mixed-replace; boundary=frame",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitise_question(q: dict | None) -> dict | None:
    """Strip internal-only fields before sending to the client."""
    if q is None:
        return None
    return {
        "id": q.get("id"),
        "question": q.get("question"),
        "type": q.get("type"),
        "expected_keywords": q.get("expected_keywords", []),
        "follow_ups": q.get("follow_ups", {}),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"[main] Starting Mock Interview AI on http://localhost:{port}")
    app.run(debug=True, port=port, threaded=True)
