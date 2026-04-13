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

    const isAndroid = /Android/i.test(navigator.userAgent);
    
    // Android Chrome has a known bug with continuous = true duplicating text.
    r.continuous      = isAndroid ? false : true;   
    r.interimResults  = true;   // stream partial results
    r.lang            = 'en-US';
    r.maxAlternatives = 1;

    r.onstart = () => {
      // Don't clear transcripts if Android is just automatically restarting
      if (!isListening) {
        isListening       = true;
        finalTranscript   = '';
      }
      interimTranscript = '';
    };

    r.onresult = (event) => {
      let finalStr = '';
      let interimStr = '';

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalStr += result[0].transcript + ' ';
        } else {
          interimStr += result[0].transcript;
        }
      }

      // If continuous is false (Android), event.results is only the CURRENT sentence.
      // So we append it to our global finalTranscript manually when it becomes final.
      if (!r.continuous) {
          // Find newly finalized text from this specific event
          let newFinal = '';
          for (let i = 0; i < event.results.length; i++) {
              if (event.results[i].isFinal) newFinal += event.results[i][0].transcript + ' ';
          }
          let displayFinal = finalTranscript + newFinal;
          _onUpdate(displayFinal + interimStr);
          // We will physically append newFinal to finalTranscript on end
      } else {
          finalTranscript = finalStr;
          _onUpdate(finalTranscript + interimStr);
      }
    };

    r.onend = () => {
      if (isListening) {
          // If we reached the end of a sentence on Android, but the user hasn't clicked stop
          if (!r.continuous) {
             // We need to commit the last known interim text or final text from the session
             // before restarting.
             finalTranscript += interimTranscript + ' ';
             try { 
                 r.start(); 
                 return; // Prevent triggering onFinal yet
             } catch(e) {}
          }
      }
      
      isListening = false;
      // Only fire final if we actually got something
      _onFinal(finalTranscript.trim());
    };

    r.onerror = (event) => {
      console.warn('[SpeechService] Error:', event.error);
      
      if (isAndroid && event.error === 'no-speech' && isListening) {
          // Android often throws no-speech during auto-restarts, ignore it
          return;
      }
      
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
