"""
vision.py – Webcam capture + head-pose / engagement analysis using pure OpenCV.

Uses OpenCV's built-in Haar cascade (bundled with opencv-python, no download
needed) for face detection and a simple nose-position heuristic for head-pose
estimation.  This avoids any dependency on the mediapipe.solutions legacy API
that was removed in mediapipe >= 0.10.x.

Yields MJPEG frames that Flask can stream via multipart/x-mixed-replace.
"""

import time
import cv2
import numpy as np
import os


# ---------------------------------------------------------------------------
# Load Haar cascades (bundled with every opencv-python install)
# ---------------------------------------------------------------------------

_HAAR_DIR = cv2.data.haarcascades        # e.g. .../site-packages/cv2/data/

FACE_CASCADE = cv2.CascadeClassifier(
    os.path.join(_HAAR_DIR, "haarcascade_frontalface_default.xml")
)
EYE_CASCADE = cv2.CascadeClassifier(
    os.path.join(_HAAR_DIR, "haarcascade_eye.xml")
)

# ---------------------------------------------------------------------------
# Head-pose estimation (heuristic)
# ---------------------------------------------------------------------------

def _estimate_pose(face_rect, eyes, frame_w: int, frame_h: int) -> str:
    """
    Estimate head orientation from face bounding-box and eye positions.
    """
    x, y, w, h = face_rect

    face_cx = x + w / 2
    frame_cx = frame_w / 2
    h_offset = (face_cx - frame_cx) / frame_cx   # -1 … +1

    face_cy = y + h / 2
    frame_cy = frame_h / 2
    v_offset = (face_cy - frame_cy) / frame_cy   # -1 … +1

    tilt = ""
    if len(eyes) >= 2:
        ey_list = [ey for (_, ey, _, _) in eyes]
        eye_diff = abs(ey_list[0] - ey_list[1])
        if eye_diff > h * 0.08:
            tilt = " (tilted)"

    if h_offset < -0.20:
        return f"Looking Left{tilt}"
    if h_offset > 0.20:
        return f"Looking Right{tilt}"
    if v_offset < -0.22:
        return f"Looking Up{tilt}"
    if v_offset > 0.30:
        return f"Looking Down{tilt}"
    return f"Forward {chr(10003)}{tilt}"


# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------

_GREEN  = (0, 220, 80)
_ORANGE = (0, 165, 255)
_RED    = (0, 60, 220)
_DARK   = (20, 20, 20)


# ---------------------------------------------------------------------------
# Placeholder frame helper
# ---------------------------------------------------------------------------

def _placeholder_frame(message: str, sub: str = "") -> bytes:
    """Return a single MJPEG chunk showing an informational message."""
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    img[:] = (28, 28, 40)

    # Camera icon (simple lines)
    cv2.rectangle(img, (260, 160), (380, 240), (80, 80, 100), 2)
    cv2.circle(img, (320, 200), 25, (80, 80, 100), 2)

    # Main message
    words = message.split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > 38:
            lines.append(cur.strip())
            cur = w
        else:
            cur += " " + w
    if cur:
        lines.append(cur.strip())

    y = 280
    for line in lines:
        sz = cv2.getTextSize(line, cv2.FONT_HERSHEY_SIMPLEX, 0.62, 1)[0]
        x = (640 - sz[0]) // 2
        cv2.putText(img, line, (x, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.62, (180, 180, 210), 1, cv2.LINE_AA)
        y += 30

    if sub:
        sz = cv2.getTextSize(sub, cv2.FONT_HERSHEY_SIMPLEX, 0.46, 1)[0]
        x = (640 - sz[0]) // 2
        cv2.putText(img, sub, (x, y + 10),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.46, (100, 100, 140), 1, cv2.LINE_AA)

    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return b""
    return (
        b"--frame\r\n"
        b"Content-Type: image/jpeg\r\n\r\n"
        + buf.tobytes()
        + b"\r\n"
    )


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_frames():
    """
    Generator that yields MJPEG-encoded frames from the default webcam.
    Falls back to an informative placeholder if the camera is unavailable
    (e.g. permission denied on macOS, camera in use by another app, etc.).
    """
    cap = cv2.VideoCapture(0)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_FPS, 20)

    if not cap.isOpened():
        print(
            "[vision] WARNING: Could not open webcam (index 0). "
            "On macOS go to System Settings > Privacy & Security > Camera "
            "and allow Terminal (or your terminal app) to access the camera, "
            "then restart the server."
        )
        while True:
            yield _placeholder_frame(
                "Camera unavailable",
                "Allow Terminal: System Settings > Privacy > Camera",
            )
            time.sleep(0.5)
        return  # unreachable but keeps the generator clean

    print("[vision] Webcam opened successfully.")

    while True:
        ret, frame = cap.read()
        if not ret:
            # Transient read failure – yield placeholder and retry
            yield _placeholder_frame("Camera read error", "Retrying...")
            time.sleep(0.2)
            continue

        frame = cv2.flip(frame, 1)
        frame_h, frame_w = frame.shape[:2]

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)

        faces = FACE_CASCADE.detectMultiScale(
            gray,
            scaleFactor=1.2,
            minNeighbors=5,
            minSize=(80, 80),
            flags=cv2.CASCADE_SCALE_IMAGE,
        )

        pose_label   = "No face detected"
        status_color = _RED

        if len(faces) > 0:
            faces_sorted = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
            fx, fy, fw, fh = faces_sorted[0]

            cv2.rectangle(frame, (fx, fy), (fx + fw, fy + fh), _GREEN, 2)

            face_roi_gray = gray[fy: fy + fh // 2, fx: fx + fw]
            eyes = EYE_CASCADE.detectMultiScale(
                face_roi_gray, scaleFactor=1.1, minNeighbors=5, minSize=(20, 20),
            )

            for (ex, ey, ew, eh) in eyes:
                cx = fx + ex + ew // 2
                cy = fy + ey + eh // 2
                cv2.circle(frame, (cx, cy), ew // 3, _GREEN, 1)

            pose_label   = _estimate_pose((fx, fy, fw, fh), list(eyes), frame_w, frame_h)
            status_color = _GREEN if pose_label.startswith("Forward") else _ORANGE

        # Status bar
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, frame_h - 52), (frame_w, frame_h), _DARK, -1)
        cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)

        cv2.putText(
            frame, f"Head Pose: {pose_label}",
            (12, frame_h - 16),
            cv2.FONT_HERSHEY_SIMPLEX, 0.62, status_color, 2, cv2.LINE_AA,
        )

        ok, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 78])
        if not ok:
            continue

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n"
            + buffer.tobytes()
            + b"\r\n"
        )

    cap.release()
