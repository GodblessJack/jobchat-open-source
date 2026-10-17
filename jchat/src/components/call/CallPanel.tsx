/**
 * CallPanel — main orchestrator that manages a Qwen-Omni Realtime voice/video
 * call via a WebSocket proxy (server/call/ws-proxy.ts).
 *
 * Architecture:
 *   Browser WS (/ws/call)  ←→  server proxy  ←→  Qwen WS (dashscope)
 *
 * State machine: idle -> connecting -> connected -> speaking|listening -> ended|error
 */

import { useReducer, useRef, useEffect, useCallback } from 'react';
import { AgentVideoArea } from './AgentVideoArea';
import { UserVideoArea } from './UserVideoArea';
import { CallControlBar } from './CallControlBar';
import { useUiStore } from '../../store/ui';
import { useAuthStore } from '../../store/auth';

// ---------------------------------------------------------------------------
// State machine types (unchanged)
// ---------------------------------------------------------------------------

type CallStatus = 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'ended' | 'error';

interface CallState {
  status: CallStatus;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isScreenSharing: boolean;
  aiVolume: number;
  userVolume: number;
  isAiSpeaking: boolean;
  sessionId: string | null;
  errorMessage: string | null;
}

type CallAction =
  | { type: 'SET_STATUS'; status: CallStatus }
  | { type: 'SET_MUTED'; isMuted: boolean }
  | { type: 'SET_VIDEO'; isVideoEnabled: boolean }
  | { type: 'SET_SCREEN_SHARE'; isScreenSharing: boolean }
  | { type: 'SET_AI_VOLUME'; aiVolume: number }
  | { type: 'SET_USER_VOLUME'; userVolume: number }
  | { type: 'SET_AI_SPEAKING'; isAiSpeaking: boolean }
  | { type: 'SET_SESSION_ID'; sessionId: string }
  | { type: 'SET_ERROR'; errorMessage: string }
  | { type: 'RESET' };

const INITIAL_STATE: CallState = {
  status: 'idle',
  isMuted: false,
  isVideoEnabled: true,
  isScreenSharing: false,
  aiVolume: 0,
  userVolume: 0,
  isAiSpeaking: false,
  sessionId: null,
  errorMessage: null,
};

function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.status };
    case 'SET_MUTED':
      return { ...state, isMuted: action.isMuted };
    case 'SET_VIDEO':
      return { ...state, isVideoEnabled: action.isVideoEnabled };
    case 'SET_SCREEN_SHARE':
      return { ...state, isScreenSharing: action.isScreenSharing };
    case 'SET_AI_VOLUME':
      return { ...state, aiVolume: action.aiVolume };
    case 'SET_USER_VOLUME':
      return { ...state, userVolume: action.userVolume };
    case 'SET_AI_SPEAKING':
      return { ...state, isAiSpeaking: action.isAiSpeaking };
    case 'SET_SESSION_ID':
      return { ...state, sessionId: action.sessionId };
    case 'SET_ERROR':
      return { ...state, status: 'error', errorMessage: action.errorMessage };
    case 'RESET':
      return { ...INITIAL_STATE };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CallPanelProps {
  conversationId: string;
  agentId: string;
  agentName: string;
  agentRole?: string | null;
  agentAvatarUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Audio / encoding helpers
// ---------------------------------------------------------------------------

/** PCM16 sample rate used for the Qwen-Omni Realtime API. */
const SAMPLE_RATE = 24000;

/**
 * Convert a Float32Array of samples in [-1, 1] to a base64-encoded PCM16
 * (16-bit signed integer, little-endian) buffer.
 */
function float32ToPcm16Base64(samples: Float32Array): string {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return arrayBufferToBase64(int16.buffer);
}

/**
 * Convert a base64-encoded PCM24 (24-bit signed integer, little-endian) buffer
 * into a Float32Array of samples in [-1, 1].
 */
function pcm24Base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);

  const numSamples = Math.floor(len / 3);
  const float32 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = i * 3;
    let sample = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    // Sign-extend 24-bit to 32-bit.
    if (sample & 0x800000) sample |= ~0xffffff;
    float32[i] = sample / 8388608; // 2^23
  }
  return float32;
}

/** Encode an ArrayBuffer to a base64 string, chunking to avoid stack overflow. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32 KB
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CallPanel({
  conversationId,
  agentId,
  agentName,
  agentRole,
  agentAvatarUrl,
}: CallPanelProps) {
  const [state, dispatch] = useReducer(callReducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const setActiveCall = useUiStore((s) => s.setActiveCall);
  const authUser = useAuthStore((s) => s.user);

  const userName = authUser?.displayName ?? authUser?.username ?? 'You';
  const userAvatarUrl = null;

  // ---- Refs ----
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const jwtRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  /** Timer handle for periodic image frame capture (1 fps). */
  const imageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Video element used as the `drawImage` source for canvas image capture.
   * Points to `localVideoRef.current` for camera, or a hidden DOM-attached
   * `<video>` for screen share.
   *
   * IMPORTANT: always a video element that is in the DOM — Chrome throttles
   * frame delivery to detached elements after ~10 s, which kills the visible
   * video when two elements share the same MediaStreamTrack.
   */
  const captureSourceRef = useRef<HTMLVideoElement | null>(null);
  /** Hidden <canvas> for extracting JPEG frames from the video stream. */
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** Screen share track — kept for UserVideoArea preview only. */
  const screenShareTrackRef = useRef<MediaStreamTrack | null>(null);
  /** Hidden DOM-attached <video> used during screen share for frame capture. */
  const screenShareVideoRef = useRef<HTMLVideoElement | null>(null);

  // ---- Audio playback queue ----
  const audioQueueRef = useRef<Float32Array[]>([]);
  const nextPlayTimeRef = useRef(0);

  function enqueueAudio(samples: Float32Array) {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    audioQueueRef.current.push(samples);
    if (audioQueueRef.current.length === 1) scheduleNextAudio(ctx);
  }

  function scheduleNextAudio(ctx: AudioContext) {
    const queue = audioQueueRef.current;
    if (queue.length === 0) return;
    const samples = queue.shift()!;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now;
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;

    source.onended = () => scheduleNextAudio(ctx);
  }

  function flushAudioQueue() {
    audioQueueRef.current = [];
    nextPlayTimeRef.current = 0;
  }

  // ---------------------------------------------------------------------------
  // Video frame capture (1 fps → input_image_buffer.append)
  // ---------------------------------------------------------------------------

  function startImageCapture() {
    const video = captureSourceRef.current;
    const canvas = captureCanvasRef.current;
    const ws = wsRef.current;
    if (!video || !canvas || !ws) return;

    // Match a reasonable resolution: 640×480 (480p).
    canvas.width = 640;
    canvas.height = 480;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    imageTimerRef.current = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
        const jpegBase64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        ws.send(JSON.stringify({ type: 'input_image_buffer.append', image: jpegBase64 }));
      } catch {
        // Canvas draw may fail if video isn't ready yet — ignore.
      }
    }, 1000);
  }

  function stopImageCapture() {
    if (imageTimerRef.current) {
      clearInterval(imageTimerRef.current);
      imageTimerRef.current = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Audio capture (PCM16 via ScriptProcessorNode)
  // ---------------------------------------------------------------------------

  function startAudioCapture(stream: MediaStream) {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioCtxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessorNode is deprecated but is the simplest API for raw PCM
    // access without a separate AudioWorklet file.  Buffer size 4096 samples at
    // 24 kHz = ~170 ms per chunk.
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    scriptProcessorRef.current = processor;

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const inputData = e.inputBuffer.getChannelData(0);
      // Skip near-silent frames to save bandwidth.
      if (isSilent(inputData)) return;
      const base64 = float32ToPcm16Base64(inputData);
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    };

    source.connect(processor);
    // ScriptProcessorNode requires an output path to fire onaudioprocess, but
    // we must NOT connect directly to ctx.destination (speakers) — that creates
    // a feedback loop (mic → speakers → mic).  Route through a zero-gain node
    // instead so the graph stays alive without producing audible output.
    const silence = ctx.createGain();
    silence.gain.value = 0;
    processor.connect(silence);
    silence.connect(ctx.destination);
  }

  function stopAudioCapture() {
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  /** Return true if every sample is within the silence threshold (-45 dBFS). */
  function isSilent(samples: Float32Array): boolean {
    const threshold = 0.0056; // ~ -45 dBFS
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > threshold) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // startCall
  // ---------------------------------------------------------------------------

  const startCall = useCallback(async () => {
    dispatch({ type: 'SET_STATUS', status: 'connecting' });

    // hangup() may null sessionIdRef/jwtRef concurrently during the
    // WebSocket handshake. Capture locals so the catch block can still
    // send its fallback /api/call/end even if hangup wins the race.
    let capturedSid: string | null = null;
    let capturedJwt: string | null = null;

    try {
      // 1. JWT
      const jwt = useAuthStore.getState().getJwt();
      if (!jwt) throw new Error('No auth session available');
      jwtRef.current = jwt;
      capturedJwt = jwt;

      // 2. Create call session
      const startRes = await fetch('/api/call/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ conversationId }),
      });
      if (!startRes.ok) throw new Error(`Session start failed: ${startRes.status}`);
      const { sessionId } = await startRes.json();
      sessionIdRef.current = sessionId;
      capturedSid = sessionId;
      dispatch({ type: 'SET_SESSION_ID', sessionId });

      // 3. Fetch persona / system instruction
      let instructions = `You are ${agentName}. Have a natural conversation with the user. Be helpful, concise, and friendly.`;
      try {
        const personaRes = await fetch(
          `/api/call/persona?conversationId=${encodeURIComponent(conversationId)}`,
          { headers: { Authorization: `Bearer ${jwt}` } }
        );
        if (personaRes.ok) {
          const persona = await personaRes.json();
          if (persona.systemInstruction) instructions = persona.systemInstruction;
        }
      } catch {
        // Non-critical; fall back to default instructions.
      }

      // 4. Get user media (audio + video)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;

      // Sync track state with pre-call UI toggles (mute/video-off).
      const cur = stateRef.current;
      if (cur.isMuted) stream.getAudioTracks().forEach(t => { t.enabled = false; });
      if (!cur.isVideoEnabled) stream.getVideoTracks().forEach(t => { t.enabled = false; });

      // 5. Show local video preview — this same element is used as the
      // drawImage source for canvas capture.  (Avoid a second <video> sharing
      // the MediaStreamTrack — Chrome throttles frame delivery to detached
      // elements, which leaks to the visible element ~10 s in.)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }
      captureSourceRef.current = localVideoRef.current;
      // Hidden canvas for JPEG extraction.
      captureCanvasRef.current = document.createElement('canvas');

      // 6. Open WebSocket to /ws/call
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/call?token=${encodeURIComponent(jwt)}&sessionId=${encodeURIComponent(sessionId)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 15000);

        ws.onopen = () => {
          // Keep the timeout alive for the full handshake (WS open + proxy.ready).
        };

        ws.onmessage = (event: MessageEvent) => {
          try {
            const evt = JSON.parse(event.data);
            if (evt.type === 'proxy.ready') {
              clearTimeout(timeout);
              // Send session configuration upstream.
              ws.send(JSON.stringify({
                type: 'session.update',
                session: {
                  modalities: ['text', 'audio'],

                  instructions,
                  input_audio_format: 'pcm16',
                  output_audio_format: 'pcm24',
                  turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 800 },
                },
              }));
              resolve();
            }
          } catch {
            // Keep waiting for proxy.ready.
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket connection failed'));
        };

        ws.onclose = () => {
          clearTimeout(timeout);
          reject(new Error('WebSocket closed before ready'));
        };
      });

      // 7. Wire up the WS message handler for the rest of the call lifecycle.
      ws.onmessage = (event: MessageEvent) => {
        try {
          const evt = JSON.parse(event.data);
          dispatchCallEvent(evt);
        } catch {
          // Ignore malformed messages.
        }
      };

      ws.onerror = () => {
        dispatch({ type: 'SET_ERROR', errorMessage: 'Connection lost' });
      };

      ws.onclose = () => {
        // If the call hasn't been explicitly ended, treat as error.
        if (sessionIdRef.current) {
          dispatch({ type: 'SET_ERROR', errorMessage: 'Call disconnected' });
        }
      };

      // 8. Start audio capture (PCM16 → WS).
      startAudioCapture(stream);

      // 9. Start image capture (1 fps → WS).
      startImageCapture();

      // 10. Mark as connected.
      dispatch({ type: 'SET_STATUS', status: 'connected' });
      setActiveCall({
        sessionId,
        conversationId: conversationId as never,
        agentId: agentId as never,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start call';
      dispatch({ type: 'SET_ERROR', errorMessage: message });

      // Clean up partial resources.
      stopAudioCapture();
      stopImageCapture();
      wsRef.current?.close();
      wsRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;

      const sid = capturedSid;
      const jwt = capturedJwt;
      if (sid) {
        fetch('/api/call/end', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
          body: JSON.stringify({ sessionId: sid, status: 'error' }),
        }).catch(() => {});
        sessionIdRef.current = null;
      }
    }
  }, [agentId, agentName, conversationId, setActiveCall]);

  // ---------------------------------------------------------------------------
  // WS event dispatcher
  // ---------------------------------------------------------------------------

  function dispatchCallEvent(evt: any) {
    switch (evt.type) {
      case 'input_audio_buffer.speech_started':
        dispatch({ type: 'SET_STATUS', status: 'listening' });
        break;

      case 'input_audio_buffer.speech_stopped':
        dispatch({ type: 'SET_STATUS', status: 'connected' });
        break;

      case 'response.created':
        dispatch({ type: 'SET_STATUS', status: 'speaking' });
        dispatch({ type: 'SET_AI_SPEAKING', isAiSpeaking: true });
        flushAudioQueue();
        break;

      case 'response.done':
        dispatch({ type: 'SET_STATUS', status: 'connected' });
        dispatch({ type: 'SET_AI_SPEAKING', isAiSpeaking: false });
        break;

      case 'response.audio.delta':
        if (evt.delta) {
          const samples = pcm24Base64ToFloat32(evt.delta);
          enqueueAudio(samples);
        }
        break;

      case 'response.text.delta':
        // Handled by ws-proxy transcript interception; no-op here.
        break;

      case 'session.created':
      case 'session.updated':
        // Logged server-side; no UI action needed.
        break;

      case 'error':
        dispatch({ type: 'SET_ERROR', errorMessage: evt.message ?? 'Unknown error' });
        break;

      default:
        // Other events (e.g., proxy.ready after reconnect, conversation.item.*)
        // are handled elsewhere or are informational.
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // hangup
  // ---------------------------------------------------------------------------

  const hangup = useCallback(() => {
    // Stop audio pipeline.
    stopAudioCapture();
    flushAudioQueue();

    // Stop image capture.
    stopImageCapture();

    // Capture session info and null out refs BEFORE closing the WebSocket.
    // ws.close() fires onclose synchronously — if sessionIdRef is still set at
    // that point, onclose dispatches SET_ERROR ("Call disconnected") for what
    // is actually a normal user-initiated hangup.
    const sid = sessionIdRef.current;
    const jwt = jwtRef.current;
    sessionIdRef.current = null;
    jwtRef.current = null;

    // Close WebSocket.
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop media tracks.
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    // Clean up screen share video if active.
    if (screenShareVideoRef.current) {
      screenShareVideoRef.current.pause();
      screenShareVideoRef.current.srcObject = null;
      screenShareVideoRef.current.remove();
      screenShareVideoRef.current = null;
    }
    captureSourceRef.current = null;
    captureCanvasRef.current = null;

    // Stop screen share track if active.
    if (screenShareTrackRef.current) {
      screenShareTrackRef.current.stop();
      screenShareTrackRef.current = null;
    }

    // Notify server to end the session (persistCallToMemory).
    if (sid) {
      fetch('/api/call/end', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ sessionId: sid, status: 'completed' }),
      }).catch(() => { /* fire-and-forget */ });
    }

    dispatch({ type: 'SET_STATUS', status: 'ended' });
    setActiveCall(null);

    // Restore panel to profile tab with default width.
    useUiStore.getState().setDetailPanelActiveTab('profile');
    useUiStore.getState().setDetailPanelWidth(320);
  }, [setActiveCall]);

  // ---------------------------------------------------------------------------
  // Toggle controls (unchanged from WebRTC version — operate on MediaStream)
  // ---------------------------------------------------------------------------

  const toggleMute = useCallback(() => {
    const next = !state.isMuted;
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
    }
    dispatch({ type: 'SET_MUTED', isMuted: next });
  }, [state.isMuted]);

  const toggleVideo = useCallback(() => {
    const next = !state.isVideoEnabled;
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = next;
      });
    }
    dispatch({ type: 'SET_VIDEO', isVideoEnabled: next });
  }, [state.isVideoEnabled]);

  const toggleScreenShare = useCallback(async () => {
    const isSharing = state.isScreenSharing;
    if (isSharing) {
      // Stop screen share, restore camera.
      if (screenShareTrackRef.current) {
        screenShareTrackRef.current.stop();
        screenShareTrackRef.current = null;
      }
      // Tear down the hidden screen-share video; switch capture source back to
      // the visible local video element.
      if (screenShareVideoRef.current) {
        screenShareVideoRef.current.pause();
        screenShareVideoRef.current.srcObject = null;
        screenShareVideoRef.current.remove();
        screenShareVideoRef.current = null;
      }
      captureSourceRef.current = localVideoRef.current;
      dispatch({ type: 'SET_SCREEN_SHARE', isScreenSharing: false });
    } else {
      try {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const displayTrack = displayStream.getVideoTracks()[0];
        screenShareTrackRef.current = displayTrack;

        // Create a DOM-attached hidden video for screen-share frame capture.
        // It MUST be in the DOM (display:none) so Chrome doesn't throttle its
        // frame delivery after ~10 s.
        const hiddenVideo = document.createElement('video');
        hiddenVideo.srcObject = displayStream;
        hiddenVideo.muted = true;
        hiddenVideo.playsInline = true;
        hiddenVideo.style.display = 'none';
        document.body.appendChild(hiddenVideo);
        hiddenVideo.play().catch(() => {});
        screenShareVideoRef.current = hiddenVideo;
        captureSourceRef.current = hiddenVideo;

        displayTrack.onended = () => {
          // User stopped sharing via browser UI — restore camera.
          if (screenShareVideoRef.current) {
            screenShareVideoRef.current.pause();
            screenShareVideoRef.current.srcObject = null;
            screenShareVideoRef.current.remove();
            screenShareVideoRef.current = null;
          }
          captureSourceRef.current = localVideoRef.current;
          screenShareTrackRef.current = null;
          dispatch({ type: 'SET_SCREEN_SHARE', isScreenSharing: false });
        };

        dispatch({ type: 'SET_SCREEN_SHARE', isScreenSharing: true });
      } catch {
        // User cancelled the screen share picker.
      }
    }
  }, [state.isScreenSharing]);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      // End the call session on the server before tearing down media.
      const sid = sessionIdRef.current;
      const jwt = jwtRef.current;
      if (sid) {
        // Fire-and-forget — best effort.
        const body = JSON.stringify({ sessionId: sid, status: 'completed' });
        fetch('/api/call/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
          body,
        }).catch(() => {});
        // sendBeacon fallback for tab-close races.
        try {
          navigator.sendBeacon('/api/call/end', new Blob([JSON.stringify({ sessionId: sid, status: 'completed', jwt })], { type: 'application/json' }));
        } catch { /* sendBeacon is best-effort during teardown. */ }
      }
      // Clear the active-call state so the amber status bar disappears.
      useUiStore.getState().setActiveCall(null);

      stopAudioCapture();
      stopImageCapture();
      flushAudioQueue();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (screenShareVideoRef.current) {
        screenShareVideoRef.current.pause();
        screenShareVideoRef.current.srcObject = null;
        screenShareVideoRef.current.remove();
        screenShareVideoRef.current = null;
      }
      captureSourceRef.current = null;
      captureCanvasRef.current = null;
      if (screenShareTrackRef.current) {
        screenShareTrackRef.current.stop();
        screenShareTrackRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="relative flex flex-col h-full bg-zinc-900">
      {/* Agent video area — top half */}
      <AgentVideoArea
        agentName={agentName}
        agentRole={agentRole}
        agentAvatarUrl={agentAvatarUrl}
        isSpeaking={state.isAiSpeaking}
        aiVolume={state.aiVolume}
        status={state.status}
        onStartCall={state.status === 'idle' ? startCall : undefined}
      />

      {/* User video area — bottom half */}
      <UserVideoArea
        userName={userName}
        userAvatarUrl={userAvatarUrl}
        isMuted={state.isMuted}
        userVolume={state.userVolume}
        isVideoEnabled={state.isVideoEnabled}
        isScreenSharing={state.isScreenSharing}
        localVideoRef={localVideoRef}
      />

      {/* Call control bar — fixed at bottom */}
      <CallControlBar
        isMuted={state.isMuted}
        isVideoEnabled={state.isVideoEnabled}
        isScreenSharing={state.isScreenSharing}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        onHangup={hangup}
      />

      {/* Error overlay */}
      {state.status === 'error' && state.errorMessage && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 max-w-sm rounded-xl bg-zinc-800 p-6 text-center">
            <p className="mb-2 text-sm font-medium text-red-400">Call Error</p>
            <p className="text-sm text-zinc-300">{state.errorMessage}</p>
            <button
              onClick={() => {
                dispatch({ type: 'RESET' });
                useUiStore.getState().setActiveCall(null);
                useUiStore.getState().setDetailPanelActiveTab('profile');
                useUiStore.getState().setDetailPanelWidth(320);
              }}
              className="mt-4 rounded-lg bg-zinc-700 px-4 py-1.5 text-sm text-white hover:bg-zinc-600"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
