import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { decode, encode, decodeAudioData, createPcmBlob } from '../utils/audioUtils';

export type CallStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'connecting' | 'connected' | 'error';
export type VoiceName = 'Aoede' | 'Charon' | 'Fenrir' | 'Kore' | 'Puck' | 'Zephyr';

export interface TranscriptionEntry {
    id: string;
    sender: 'user' | 'gemini';
    text: string;
    timestamp: number;
}

export interface UseAudioCallOptions {
  user: any;
  systemInstruction: string;
  sessionId: string | null;
  jwt: string | null;
}

// "Native Audio" model is optimized for low-latency voice interaction.
const LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025';
// [CURRENT_SPEC] Using gemini-3 as defined in the current stable code flow.
const NOTES_MODEL = 'models/gemini-3-flash-preview';

export function useAudioCall(opts: UseAudioCallOptions) {
    const currentUser = opts.user;

    // Sync external props to refs to avoid closure staleness in intervals
    // and in Gemini Live `onmessage` callbacks (which are bound once at
    // connect() time but need to read sessionId/jwt that arrive later).
    const userRef = useRef(currentUser);
    const sessionIdRef = useRef<string | null>(opts.sessionId);
    const jwtRef = useRef<string | null>(opts.jwt);

    useEffect(() => { userRef.current = opts.user; }, [opts.user]);
    useEffect(() => { sessionIdRef.current = opts.sessionId; }, [opts.sessionId]);
    useEffect(() => { jwtRef.current = opts.jwt; }, [opts.jwt]);

    const [status, setStatus] = useState<CallStatus>('idle');
    const [isAiSpeaking, setIsAiSpeaking] = useState(false);
    const [aiVolume, setAiVolume] = useState(0);
    const [userVolume, setUserVolume] = useState(0);
    const [isAudioSuspended, setIsAudioSuspended] = useState(false);

    // Gemini specific state
    const [history, setHistory] = useState<TranscriptionEntry[]>([]);
    const [title, setTitle] = useState<string>('');
    const [notes, setNotes] = useState<string>('');
    const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isMuted, setIsMuted] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);

    const sessionRef = useRef<any>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const screenStreamRef = useRef<MediaStream | null>(null);
    const videoIntervalRef = useRef<number | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Audio Contexts
    const audioContextRef = useRef<AudioContext | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const geminiAnalyserRef = useRef<AnalyserNode | null>(null);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const nextStartTimeRef = useRef<number>(0);

    const lastProcessedIndex = useRef(0);

    const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

    // === jchat REST integration ===
    // Read sessionId/jwt via refs (not closure on opts.*) — onmessage callback
    // is bound at connect() time when sessionId is still null; only the ref
    // sees the post-/api/call/start value.
    async function postTranscribe(entry: { id: string; sender: 'user' | 'gemini'; text: string; timestamp: number }) {
      const sessionId = sessionIdRef.current;
      const jwt = jwtRef.current;
      if (!sessionId || !jwt) return;
      try {
        await fetch('/api/call/transcribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`
          },
          body: JSON.stringify({
            sessionId,
            transcriptEntryId: entry.id,
            sender: entry.sender,
            text: entry.text,
            timestamp: entry.timestamp
          })
        });
      } catch (err) {
        console.warn('[useAudioCall] /api/call/transcribe failed', err);
      }
    }

    async function endRemote(status: 'completed' | 'error' = 'completed') {
      const sessionId = sessionIdRef.current;
      const jwt = jwtRef.current;
      if (!sessionId) return;
      try {
        await fetch('/api/call/end', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {})
          },
          body: JSON.stringify({ sessionId, status })
        });
      } catch { /* ignore */ }
    }

    // Cleanup function
    const cleanup = useCallback(() => {
        if (videoIntervalRef.current !== null) {
            window.clearInterval(videoIntervalRef.current);
            videoIntervalRef.current = null;
        }
        if (sessionRef.current) {
            try { sessionRef.current.close?.(); } catch (e) { }
            sessionRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
            setStream(null);
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => track.stop());
            screenStreamRef.current = null;
        }
        setIsScreenSharing(false);
        isScreenSharingRef.current = false;
        sourcesRef.current.forEach(source => { try { source.stop(); } catch (e) { } });
        sourcesRef.current.clear();

        if (inputAudioContextRef.current) inputAudioContextRef.current.close().catch(() => { });
        if (audioContextRef.current) audioContextRef.current.close().catch(() => { });

        setStatus('idle');
        setIsAiSpeaking(false);
        setAiVolume(0);
        setUserVolume(0);
        nextStartTimeRef.current = 0;
    }, []);

    const connect = useCallback(async () => {
        setStatus('connecting');
        try {
            const ms = await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true },
                video: { width: 1280, height: 720 }
            });

            streamRef.current = ms;
            setStream(ms);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = ms;
            }

            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const inputAudioContext = new AudioContext({ sampleRate: 16000 });
            const outputAudioContext = new AudioContext({ sampleRate: 24000 });
            inputAudioContextRef.current = inputAudioContext;
            audioContextRef.current = outputAudioContext;

            if (outputAudioContext.state === 'suspended') setIsAudioSuspended(true);

            const analyser = outputAudioContext.createAnalyser();
            analyser.fftSize = 256;
            geminiAnalyserRef.current = analyser;

            const outputNode = outputAudioContext.createGain();
            outputNode.connect(analyser);
            analyser.connect(outputAudioContext.destination);

            const sessionPromise = ai.live.connect({
                model: LIVE_MODEL,
                callbacks: {
                    onopen: () => {
                        setStatus('connected');

                        const source = inputAudioContext.createMediaStreamSource(ms);
                        const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);

                            let sum = 0;
                            for (let i = 0; i < inputData.length; i++) sum += inputData[i] * inputData[i];
                            setUserVolume(Math.min(100, Math.sqrt(sum / inputData.length) * 500) / 100);

                            if (!isMutedRef.current) {
                                const pcmBlob = createPcmBlob(inputData);
                                sessionRef.current.sendRealtimeInput({ media: pcmBlob });
                            }
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContext.destination);

                        if (!canvasRef.current) {
                            canvasRef.current = document.createElement('canvas');
                        }

                        videoIntervalRef.current = window.setInterval(() => {
                            if (!localVideoRef.current || !canvasRef.current) return;
                            const shouldSend = isVideoEnabledRef.current || isScreenSharingRef.current;
                            if (!shouldSend) return;

                            const ctx = canvasRef.current.getContext('2d');
                            if (ctx && localVideoRef.current.readyState >= 2) {
                                canvasRef.current.width = localVideoRef.current.videoWidth;
                                canvasRef.current.height = localVideoRef.current.videoHeight;
                                ctx.drawImage(localVideoRef.current, 0, 0);
                                canvasRef.current.toBlob((blob) => {
                                    if (blob) {
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                            const base64 = (reader.result as string).split(',')[1];
                                            sessionRef.current.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
                                        };
                                        reader.readAsDataURL(blob);
                                    }
                                }, 'image/jpeg', 0.5);
                            }
                        }, 300);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        // Helper to update transcript history with merging logic
                        const updateTranscript = (text: string, sender: 'user' | 'gemini') => {
                            let entryToPost: { id: string; sender: 'user' | 'gemini'; text: string; timestamp: number } | null = null;
                            setHistory(prev => {
                                const last = prev[prev.length - 1];
                                // Merge if same sender and recent (<2s)
                                if (last && last.sender === sender && (Date.now() - last.timestamp < 2000)) {
                                    const merged = { ...last, text: last.text + text, timestamp: Date.now() };
                                    entryToPost = merged;
                                    return [...prev.slice(0, -1), merged];
                                } else {
                                    const fresh = {
                                        id: Math.random().toString(),
                                        sender,
                                        text,
                                        timestamp: Date.now()
                                    };
                                    entryToPost = fresh;
                                    return [...prev, fresh];
                                }
                            });
                            // Post to jchat after the state update commits
                            if (entryToPost) void postTranscribe(entryToPost);
                        };

                        // 1. Handle AI Speech Transcription (Output)
                        if (message.serverContent?.outputTranscription?.text) {
                            updateTranscript(message.serverContent.outputTranscription.text, 'gemini');
                        }

                        // 2. Handle User Speech Transcription (Input)
                        if (message.serverContent?.inputTranscription?.text) {
                            updateTranscript(message.serverContent.inputTranscription.text, 'user');
                        }

                        // 3. Handle Audio Output
                        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio) {
                            setIsAiSpeaking(true);
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContextRef.current?.currentTime || 0);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);

                            const source = outputAudioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputNode);
                            source.addEventListener('ended', () => {
                                sourcesRef.current.delete(source);
                                if (sourcesRef.current.size === 0) setIsAiSpeaking(false);
                            });
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            sourcesRef.current.add(source);
                        }
                    },
                    onerror: (e) => {
                        console.error('Session Error', e);
                        setStatus('error');
                        void endRemote('error');
                        cleanup();
                    },
                    onclose: () => {
                        void endRemote('completed');
                        cleanup();
                    }
                },
                config: {
                    // Start of Config Fixes:
                    // 1. Use AUDIO modality only (Native Audio model Requirement)
                    responseModalities: [Modality.AUDIO],

                    // 2. Define System Instruction
                    systemInstruction: { parts: [{ text: opts.systemInstruction }] },

                    // 3. Use 'Zephyr' voice (Stable default)
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
                    },

                    // 4. Enable Side-Channel Transcription (Required since Modality.TEXT is off)
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },


            });
            sessionRef.current = await sessionPromise;

        } catch (err) {
            console.error(err);
            setStatus('error');
            cleanup();
        }
    }, [cleanup]);

    const isMutedRef = useRef(isMuted);
    useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

    const isVideoEnabledRef = useRef(isVideoEnabled);
    useEffect(() => { isVideoEnabledRef.current = isVideoEnabled; }, [isVideoEnabled]);

    const isScreenSharingRef = useRef(isScreenSharing);
    useEffect(() => { isScreenSharingRef.current = isScreenSharing; }, [isScreenSharing]);

    // Use a ref to access latest history inside the interval callback without resetting the timer
    const historyRef = useRef(history);
    useEffect(() => { historyRef.current = history; }, [history]);




    const isGeneratingNotesRef = useRef(isGeneratingNotes);
    useEffect(() => { isGeneratingNotesRef.current = isGeneratingNotes; }, [isGeneratingNotes]);

    useEffect(() => {
        const generateNotes = async () => {
            // Check if we have new history to process
            if (historyRef.current.length > lastProcessedIndex.current && !isGeneratingNotesRef.current) {
                setIsGeneratingNotes(true);
                try {
                    const ai = new GoogleGenAI({ apiKey: API_KEY });

                    const userName = userRef.current?.name || 'You';
                    const transcriptText = historyRef.current.map(h => `${h.sender === 'user' ? userName : 'AI'}: ${h.text}`).join('\n');

                    // Request streaming response for dynamic effect
                    const result = await ai.models.generateContentStream({
                        model: NOTES_MODEL,
                        contents: `Role: Professional Meeting Secretary.
Task: Create a comprehensive meeting record based on the transcript.

Format Requirements:
1. The VERY FIRST line must be the meeting title formatted exactly as: "# Title: [Meeting Title]"
2. The rest of the content must be the meeting minutes in Markdown.

Input Transcript:
${transcriptText}

Output Template:
# Title: ...
# Meeting Minutes
## Executive Summary
...
## Key Discussion Points
...
## Decisions Made
...
## Action Items
- [ ] ...`
                    });

                    let fullText = '';
                    for await (const chunk of result) {
                        const chunkText = chunk.text || '';
                        fullText += chunkText;

                        // Parse Title and Body
                        const firstLineEnd = fullText.indexOf('\n');
                        if (firstLineEnd !== -1) {
                            const firstLine = fullText.substring(0, firstLineEnd).trim();
                            if (firstLine.startsWith('# Title:')) {
                                setTitle(firstLine.replace('# Title:', '').trim());
                                setNotes(fullText.substring(firstLineEnd + 1));
                            } else {
                                // Fallback if no title format found yet
                                setNotes(fullText);
                            }
                        } else {
                            setNotes(fullText);
                        }
                    }

                    lastProcessedIndex.current = historyRef.current.length;

                } catch (e) {
                    console.error('Notes gen error', e);
                } finally {
                    setIsGeneratingNotes(false);
                }
            }
        };

        // Use setInterval instead of setTimeout to ensure continuous checks
        const intervalId = setInterval(generateNotes, 5000);
        return () => clearInterval(intervalId);
    }, []); // Empty dependency array to keep the interval running stably



    useEffect(() => {
        let animId: number;
        const updateVol = () => {
            if (geminiAnalyserRef.current) {
                const data = new Uint8Array(geminiAnalyserRef.current.frequencyBinCount);
                geminiAnalyserRef.current.getByteFrequencyData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i++) sum += data[i];
                const vol = sum / data.length;
                setAiVolume(vol / 255);
            }
            animId = requestAnimationFrame(updateVol);
        };
        updateVol();
        return () => cancelAnimationFrame(animId);
    }, []);

    // Tab-close fallback: sendBeacon can't set headers, so we put the JWT in the body.
    // Server-side /api/call/end accepts this dual-auth path. Cron sweeper handles
    // the worst case where even sendBeacon drops.
    useEffect(() => {
        function onBeforeUnload() {
            if (!opts.sessionId || !opts.jwt) return;
            const data = JSON.stringify({ sessionId: opts.sessionId, status: 'completed', jwt: opts.jwt });
            try {
                navigator.sendBeacon('/api/call/end', new Blob([data], { type: 'application/json' }));
            } catch { /* ignore */ }
        }
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [opts.sessionId, opts.jwt]);

    const toggleMute = () => setIsMuted(p => !p);
    const toggleVideo = () => {
        if (isScreenSharing) return;
        setIsVideoEnabled(p => !p);
    };

    const resumeAudio = async () => {
        if (audioContextRef.current?.state === 'suspended') {
            await audioContextRef.current.resume();
            setIsAudioSuspended(false);
        }
    };

    const stopScreenShare = useCallback(() => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        setIsScreenSharing(false);
        // Restore camera stream
        if (localVideoRef.current && streamRef.current) {
            localVideoRef.current.srcObject = streamRef.current;
            localVideoRef.current.play().catch(console.error);
        }
    }, []);

    const shareScreen = async () => {
        if (isScreenSharing) {
            stopScreenShare();
            return;
        }

        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: 1920, height: 1080 },
                audio: false
            });
            screenStreamRef.current = displayStream;
            setIsScreenSharing(true);

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = displayStream;
                localVideoRef.current.play().catch(console.error);
            }

            displayStream.getVideoTracks()[0].onended = () => {
                stopScreenShare();
            };
        } catch (e) {
            console.error("Screen share failed", e);
        }
    };

    // [NOT_HOOKED_UP] This function is defined but currently not triggered by any main UI elements.
    const interrupt = () => {

        sourcesRef.current.forEach(s => s.stop());
        sourcesRef.current.clear();
        setIsAiSpeaking(false);
        nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
        sessionRef.current?.send({ clientContent: { turnComplete: true } });
    };

    return {
        status,
        isAiSpeaking,
        aiVolume,
        userVolume,
        connect,
        disconnect: cleanup,
        interrupt,
        isAudioSuspended,
        resumeAudio,
        shareScreen,

        history,
        title,
        notes,
        stream,
        localVideoRef,
        isMuted,
        toggleMute,
        isVideoEnabled,
        toggleVideo,
        isScreenSharing,
    };
}
