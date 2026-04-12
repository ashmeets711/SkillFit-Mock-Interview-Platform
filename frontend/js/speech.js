/**
 * speech.js – Web Speech API wrapper (SpeechService).
 *
 * Usage:
 *   SpeechService.init(onTranscriptUpdate, onFinalResult, onError);
 *   SpeechService.start();
 *   SpeechService.stop();
 */

const SpeechService = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let recognition   = null;
  let isListening   = false;
  let finalTranscript  = '';
  let interimTranscript = '';

  // Callbacks set via init()
  let _onUpdate = () => {};
  let _onFinal  = () => {};
  let _onError  = () => {};

  // ── Availability check ───────────────────────────────────────────────────
  const isSupported = !!(
    window.SpeechRecognition || window.webkitSpeechRecognition
  );

  // ── Internal helpers ─────────────────────────────────────────────────────

  function _createRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();

    r.continuous      = true;   // keep listening until stop() is called
    r.interimResults  = true;   // stream partial results
    r.lang            = 'en-US';
    r.maxAlternatives = 1;

    r.onstart = () => {
      isListening       = true;
      finalTranscript   = '';
      interimTranscript = '';
    };

    r.onresult = (event) => {
      interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' ';
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      // Notify caller with the combined text
      _onUpdate(finalTranscript + interimTranscript);
    };

    r.onend = () => {
      isListening = false;
      // Only fire final if we actually got something
      _onFinal(finalTranscript.trim());
    };

    r.onerror = (event) => {
      console.warn('[SpeechService] Error:', event.error);
      isListening = false;

      let msg = 'Speech recognition error.';
      if (event.error === 'no-speech')        msg = 'No speech detected. Please try again.';
      else if (event.error === 'not-allowed')  msg = 'Microphone access was denied. Please allow it in browser settings.';
      else if (event.error === 'network')      msg = 'Network error during speech recognition.';
      else if (event.error === 'aborted')      return; // user cancelled – not an error

      _onError(msg);
    };

    return r;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Must be called before start() / stop().
   * @param {function} onUpdate  (text: string) => void  – called on each partial result
   * @param {function} onFinal   (text: string) => void  – called when recognition ends
   * @param {function} onError   (msg:  string) => void  – called on errors
   */
  function init(onUpdate, onFinal, onError) {
    _onUpdate = onUpdate || (() => {});
    _onFinal  = onFinal  || (() => {});
    _onError  = onError  || (() => {});

    if (!isSupported) {
      _onError('Your browser does not support the Web Speech API. Please use Chrome or Edge.');
    }
  }

  /**
   * Start capturing speech.
   */
  function start() {
    if (!isSupported) {
      _onError('Speech recognition is not available in this browser.');
      return;
    }
    if (isListening) return;

    // Create a fresh instance each time (browsers may not allow reuse)
    recognition = _createRecognition();

    try {
      recognition.start();
    } catch (e) {
      console.error('[SpeechService] Could not start:', e);
      _onError('Could not start microphone. Is it already in use?');
    }
  }

  /**
   * Stop capturing speech. The onFinal callback will fire when recognition closes.
   */
  function stop() {
    if (recognition && isListening) {
      recognition.stop();
    }
  }

  /**
   * Return current listening state.
   */
  function listening() {
    return isListening;
  }

  return { init, start, stop, listening, isSupported };
})();
