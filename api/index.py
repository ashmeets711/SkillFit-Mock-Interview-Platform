import os
from dotenv import load_dotenv

load_dotenv()  # Loads variables from .env

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from backend.question_bank import LLMQuestionGenerator
from backend.nlp_evaluator import AnswerEvaluator
from backend.follow_up import generate_follow_up

# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, "..", "frontend")

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
CORS(app)

# Note: Vercel serverless functions are ephemeral, so we initialize these
# lazily or globally depending on the Lambda freeze.
llm_generator = None
evaluator = None

def get_generator():
    global llm_generator
    if llm_generator is None:
        llm_generator = LLMQuestionGenerator()
    return llm_generator

def get_evaluator():
    global evaluator
    if evaluator is None:
        evaluator = AnswerEvaluator()
    return evaluator


# ---------------------------------------------------------------------------
# Static routes
# ---------------------------------------------------------------------------

ROLES = [
    "Python Developer", "Frontend Developer (React)", "Full-Stack Engineer",
    "Data Scientist", "Machine Learning Engineer", "DevOps / Cloud Engineer",
    "Backend Engineer (Node.js)", "Mobile Developer (Flutter)",
    "Cybersecurity Analyst", "Product Manager (Technical)",
]

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "interview.html")

@app.route("/report/<path:dummy>")
def report_page(dummy):
    return send_from_directory(FRONTEND_DIR, "report.html")

# ---------------------------------------------------------------------------
# REST API (Stateless)
# ---------------------------------------------------------------------------

@app.route("/api/roles", methods=["GET"])
def get_roles():
    return jsonify({"roles": ROLES})


@app.route("/api/start_interview", methods=["POST"])
def start_interview():
    """Stateless: Returns a list of generated questions to the frontend directly."""
    data = request.get_json(force=True)
    role = (data.get("role") or "").strip()
    skills = (data.get("skills") or "").strip()
    
    if not role or not skills:
        return jsonify({"error": "Role and skills are required"}), 400

    try:
        gen = get_generator()
        questions = gen.get_questions_for_role_and_skills(role, skills)
        if not questions:
            return jsonify({"error": "No questions were generated."}), 500
            
        return jsonify({
            # The frontend takes ownership of iterating this list.
            "questions": questions
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/submit_answer", methods=["POST"])
def submit_answer():
    """
    Stateless: Takes a question object and the user's answer text.
    Evaluates via LLM, and returns the evaluation + (optionally) a follow up question.
    """
    data = request.get_json(force=True)
    answer_text = (data.get("answer") or "").strip()
    question_obj = data.get("question", {})
    answering_follow_up = bool(data.get("is_follow_up", False))

    if not question_obj:
        return jsonify({"error": "No question data provided"}), 400

    # ----- Evaluate the answer (Groq LLM) -----
    ev = get_evaluator()
    evaluation = ev.evaluate(
        question=question_obj.get("question", ""),
        answer=answer_text,
        expected_keywords=question_obj.get("expected_keywords", []),
    )

    # ----- Follow-Up Logic -----
    if answering_follow_up:
        follow_up_text = None
    else:
        follow_up_text = generate_follow_up(question_obj, evaluation)

    response = {
        "evaluation": evaluation,
        "is_follow_up": bool(follow_up_text),
    }

    if follow_up_text:
        response["follow_up_question"] = {
            "id": "follow_up",
            "question": follow_up_text,
            "type": "follow_up",
            "expected_keywords": question_obj.get("expected_keywords", []),
            "follow_ups": {},
        }

    return jsonify(response)


if __name__ == "__main__":
    app.run(debug=True, port=int(os.environ.get("PORT", 5000)))
