
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Message } from '../types';
import type { VrAssistantState } from '../App';
import { ai } from '../services/geminiService';
import { streamChat, textToSpeech } from '../services/apiService';
import type { Part, LiveServerMessage, Blob as GeminiBlob } from '@google/genai';
import { Modality } from '@google/genai';
import { SendIcon, CloseIcon, BotIcon, MicrophoneIcon, SpeakerIcon, SpeakerOffIcon, PaperclipIcon } from './icons';

// Infer the LiveSession type from the SDK method's return type.
type LiveSession = Awaited<ReturnType<typeof ai.live.connect>>;

// TypeScript definitions for the Web Speech API
interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
}
interface SpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
    readonly length: number;
    item(index: number): SpeechRecognitionResult;
    [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string;
}
interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    lang: string;
    interimResults: boolean;
    onresult: (this: SpeechRecognition, ev: SpeechRecognitionEvent) => any;
    onend: (this: SpeechRecognition, ev: Event) => any;
    onerror: (this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any;
    start(): void;
    stop(): void;
}
declare global {
    interface Window {
        SpeechRecognition: { new(): SpeechRecognition };
        webkitSpeechRecognition: { new(): SpeechRecognition };
        ImageCapture: any;
    }
}

interface ChatbotProps {
    isOpen: boolean;
    onClose: () => void;
    capturedImage?: { data: string; mimeType: string; } | null;
    onCaptureHandled: () => void;
    isVrMode: boolean;
    onDeactivateVrMode: () => void;
    vrAssistantState: VrAssistantState;
    setVrAssistantState: React.Dispatch<React.SetStateAction<VrAssistantState>>;
    onTriggerCapture: () => void;
}

// Audio encoding/decoding utilities
function encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Optimized PCM Decoder using Int16Array for speed
async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sourceSampleRate: number, 
    numChannels: number,
): Promise<AudioBuffer> {
    // Create a Float32 buffer to hold the normalized data
    // 16-bit PCM = 2 bytes per sample
    const sampleLength = data.length / 2;
    const float32 = new Float32Array(sampleLength);
    
    // Use Int16Array to read 2 bytes at a time (Little Endian is standard for PCM)
    // This is much faster than DataView in a loop
    const dataInt16 = new Int16Array(data.buffer, data.byteOffset, sampleLength);
    
    for (let i = 0; i < sampleLength; i++) {
        // Normalize to [-1.0, 1.0]
        float32[i] = dataInt16[i] / 32768.0;
    }

    // Create buffer at the SOURCE sample rate. Web Audio API handles resampling automatically.
    const audioBuffer = ctx.createBuffer(numChannels, sampleLength / numChannels, sourceSampleRate);

    if (numChannels === 1) {
        audioBuffer.copyToChannel(float32, 0);
    } else {
        for (let ch = 0; ch < numChannels; ch++) {
            const channelData = audioBuffer.getChannelData(ch);
            for (let i = 0; i < audioBuffer.length; i++) {
                channelData[i] = float32[i * numChannels + ch];
            }
        }
    }
    
    return audioBuffer;
}

const Chatbot: React.FC<ChatbotProps> = ({ isOpen, onClose, capturedImage, onCaptureHandled, isVrMode, onDeactivateVrMode, vrAssistantState, setVrAssistantState, onTriggerCapture }) => {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'model', text: 'Xin chào! Tôi là hướng dẫn viên ảo của bạn. Hãy hỏi tôi bất cứ điều gì về Quảng Trị nhé!' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isLiveSessionActive, setIsLiveSessionActive] = useState(false);
    const [liveError, setLiveError] = useState<string | null>(null);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [volume, setVolume] = useState(1.0);
    const [currentlyPlayingIndex, setCurrentlyPlayingIndex] = useState<number | null>(null);
    const [imageToSend, setImageToSend] = useState<{ data: string; mimeType: string; preview: string; } | null>(null);
    
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    
    const liveSessionRef = useRef<LiveSession | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
    const masterGainNodeRef = useRef<GainNode | null>(null);
    const microphoneStreamRef = useRef<MediaStream | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const currentUserTranscriptionRef = useRef('');
    const currentModelTranscriptionRef = useRef('');
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const speechTimeoutRef = useRef<number | null>(null);
    
    // Audio Queues & Scheduling
    const audioQueueRef = useRef<{ audioData: string; messageIndex: number | null }[]>([]);
    const isAudioPlayingRef = useRef(false);
    const isSchedulingRef = useRef(false);
    const nextStartTimeRef = useRef(0);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    // TTS Pipeline Queue
    const ttsPromiseQueueRef = useRef<{ promise: Promise<string | null>; messageIndex: number }[]>([]);
    const isProcessingTtsRef = useRef(false);
    
    const wakeWord = "hướng dẫn viên ơi";
    const stopWord = "tắt chế độ trò chuyện";
    const captureCommand = "tôi đang ở đâu";

    const playPingSound = useCallback(() => {
        const audioContext = outputAudioContextRef.current;
        if (!audioContext) return;
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);

        if (compressorNodeRef.current) {
            gainNode.connect(compressorNodeRef.current);
        } else if (masterGainNodeRef.current) {
            gainNode.connect(masterGainNodeRef.current);
        } else {
            gainNode.connect(audioContext.destination);
        }

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    }, []);

    // Effect for one-time initialization
    useEffect(() => {
        try {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            outputAudioContextRef.current = audioContext;

            // Master Gain for Volume
            const masterGain = audioContext.createGain();
            masterGain.gain.setValueAtTime(1.0, audioContext.currentTime);
            masterGain.connect(audioContext.destination);
            masterGainNodeRef.current = masterGain;

            // Natural Compressor Settings to prevent clipping
            const compressor = audioContext.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-12, audioContext.currentTime);
            compressor.knee.setValueAtTime(30, audioContext.currentTime);
            compressor.ratio.setValueAtTime(12, audioContext.currentTime);
            compressor.attack.setValueAtTime(0.003, audioContext.currentTime);
            compressor.release.setValueAtTime(0.25, audioContext.currentTime);
            
            compressor.connect(masterGain);
            compressorNodeRef.current = compressor;
        } catch (e) {
            console.error("Web Audio API is not supported in this browser.", e);
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
        }

        return () => {
            recognitionRef.current?.stop();
            liveSessionRef.current?.close();
            inputAudioContextRef.current?.close();
            outputAudioContextRef.current?.close();
            if (speechTimeoutRef.current) clearTimeout(speechTimeoutRef.current);
        };
    }, []);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        if (masterGainNodeRef.current && outputAudioContextRef.current) {
            masterGainNodeRef.current.gain.setTargetAtTime(newVolume, outputAudioContextRef.current.currentTime, 0.1);
        }
    };

    // CORE AUDIO SCHEDULER
    const scheduleAudio = useCallback(async () => {
        if (isSchedulingRef.current) return;
        isSchedulingRef.current = true;

        const audioContext = outputAudioContextRef.current;
        if (!audioContext) {
            isSchedulingRef.current = false;
            return;
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        try {
            while (audioQueueRef.current.length > 0) {
                const item = audioQueueRef.current[0];
                const audioBuffer = await decodeAudioData(decode(item.audioData), audioContext, 24000, 1);
                audioQueueRef.current.shift();
                
                if (isOpen && item.messageIndex !== null) {
                    setCurrentlyPlayingIndex(item.messageIndex);
                }

                const currentTime = audioContext.currentTime;
                if (nextStartTimeRef.current < currentTime) {
                    nextStartTimeRef.current = currentTime + 0.05;
                }

                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;

                if (compressorNodeRef.current) {
                    source.connect(compressorNodeRef.current);
                } else if (masterGainNodeRef.current) {
                    source.connect(masterGainNodeRef.current);
                } else {
                    source.connect(audioContext.destination);
                }

                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;

                audioSourceRef.current = source;
                isAudioPlayingRef.current = true;

                source.onended = () => {
                    if (audioQueueRef.current.length === 0 && Math.abs(nextStartTimeRef.current - audioContext.currentTime) < 0.5) {
                        if (isOpen) setCurrentlyPlayingIndex(null);
                        isAudioPlayingRef.current = false;
                    }
                };
            }
        } catch (e) {
            console.error("Audio scheduling error:", e);
        } finally {
            isSchedulingRef.current = false;
            if (audioQueueRef.current.length > 0) {
                scheduleAudio();
            }
        }
    }, [isOpen]);

    // --- Live Session Logic ---
    const stopLiveSession = useCallback(() => {
        liveSessionRef.current?.close();
        liveSessionRef.current = null;
        
        microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
        microphoneStreamRef.current = null;
        
        audioWorkletNodeRef.current?.port.close();
        audioWorkletNodeRef.current?.disconnect();
        audioWorkletNodeRef.current = null;
        
        inputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;
        
        setIsLiveSessionActive(false);
    }, []);

    const startLiveSession = useCallback(async () => {
        setIsLiveSessionActive(true);
        setLiveError(null);
        setMessages(prev => [...prev, { role: 'user', text: '...' }]);

        const handleLiveMessage = (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
                currentUserTranscriptionRef.current += message.serverContent.inputTranscription.text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage.role === 'user') {
                        lastMessage.text = currentUserTranscriptionRef.current + '...';
                    }
                    return newMessages;
                });
            }
            if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                if (!currentModelTranscriptionRef.current) {
                    setMessages(prev => [...prev, { role: 'model', text: '' }]);
                }
                currentModelTranscriptionRef.current += text;
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage.role === 'model') {
                        lastMessage.text = currentModelTranscriptionRef.current;
                    }
                    return newMessages;
                });
            }
            const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) {
                audioQueueRef.current.push({ audioData, messageIndex: null });
                scheduleAudio(); 
            }
            if (message.serverContent?.turnComplete) {
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastUserMessage = newMessages.slice().reverse().find(m => m.role === 'user');
                    if (lastUserMessage && lastUserMessage.text.endsWith('...')) {
                         lastUserMessage.text = currentUserTranscriptionRef.current;
                    }
                    return newMessages;
                });
                currentUserTranscriptionRef.current = '';
                currentModelTranscriptionRef.current = '';
            }
        };

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    noiseSuppression: true,
                    echoCancellation: true,
                    autoGainControl: true,
                }
            });
            microphoneStreamRef.current = stream;
            
            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: {
                    onopen: async () => {
                        try {
                            inputAudioContextRef.current = new (window.AudioContext)({ sampleRate: 16000 });
                            
                            const workletCode = `
                                class PcmProcessor extends AudioWorkletProcessor {
                                    _bufferSize = 4096;
                                    _buffer = new Float32Array(this._bufferSize);
                                    _bytesWritten = 0;

                                    process(inputs, outputs, parameters) {
                                        const input = inputs[0];
                                        if (!input || !input.length) return true;
                                        
                                        const channelData = input[0];
                                        if (!channelData) return true;

                                        for (let i = 0; i < channelData.length; i++) {
                                            this._buffer[this._bytesWritten++] = channelData[i];
                                            
                                            if (this._bytesWritten >= this._bufferSize) {
                                                this.port.postMessage(this._buffer.slice());
                                                this._bytesWritten = 0;
                                            }
                                        }
                                        return true;
                                    }
                                }
                                registerProcessor('pcm-processor', PcmProcessor);
                            `;
                            
                            const blob = new Blob([workletCode], { type: 'application/javascript' });
                            const workletUrl = URL.createObjectURL(blob);
                            
                            await inputAudioContextRef.current.audioWorklet.addModule(workletUrl);
                            
                            const source = inputAudioContextRef.current.createMediaStreamSource(stream);
                            const processor = new AudioWorkletNode(inputAudioContextRef.current, 'pcm-processor');
                            
                            processor.port.onmessage = (e) => {
                                const inputData = e.data;
                                const pcmBlob = createPcmBlob(inputData);
                                sessionPromise.then(session => {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                });
                            };
                            
                            source.connect(processor);
                            processor.connect(inputAudioContextRef.current.destination);
                            audioWorkletNodeRef.current = processor;
                            
                        } catch (err) {
                            console.error("Error initializing audio input:", err);
                            setLiveError("Lỗi khởi tạo âm thanh đầu vào.");
                        }
                    },
                    onmessage: handleLiveMessage,
                    onclose: () => {
                        console.log("Live session closed");
                        setIsLiveSessionActive(false);
                    },
                    onerror: (e) => {
                        console.error("Live session error:", e);
                        setIsLiveSessionActive(false);
                        setLiveError("Lỗi kết nối máy chủ. Vui lòng thử lại sau.");
                        setTimeout(() => setLiveError(null), 5000);
                    }
                },
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    systemInstruction: "Bạn là hướng dẫn viên du lịch ảo tại Quảng Trị. Hãy trả lời ngắn gọn, thú vị.",
                }
            });
            liveSessionRef.current = await sessionPromise;
        } catch (err) {
            console.error("Failed to start live session:", err);
            setIsLiveSessionActive(false);
            setLiveError("Không thể truy cập microphone hoặc lỗi kết nối.");
            setTimeout(() => setLiveError(null), 5000);
        }
    }, [scheduleAudio]);

    function createPcmBlob(data: Float32Array): GeminiBlob {
        const l = data.length;
        const int16 = new Int16Array(l);
        for (let i = 0; i < l; i++) {
            const s = Math.max(-1, Math.min(1, data[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return {
            data: encode(new Uint8Array(int16.buffer)),
            mimeType: 'audio/pcm;rate=16000',
        };
    }

    // --- TTS & Text Chat Logic ---
    const handleSendMessage = async () => {
        if ((!input.trim() && !imageToSend) || isLoading) return;

        const userMessage: Message = { role: 'user', text: input, imageData: imageToSend?.preview };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setImageToSend(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setIsLoading(true);

        try {
            const parts: Part[] = [];
            if (userMessage.text) parts.push({ text: userMessage.text });
            if (imageToSend) {
                parts.push({
                    inlineData: {
                        mimeType: imageToSend.mimeType,
                        data: imageToSend.data
                    }
                });
            }

            setMessages(prev => [...prev, { role: 'model', text: '' }]);
            
            const stream = streamChat(messages.concat(userMessage), parts);
            
            let fullText = '';
            
            for await (const chunk of stream) {
                if (chunk.text) {
                    fullText += chunk.text;
                    
                    setMessages(prev => {
                        const newMessages = [...prev];
                        const lastMessage = newMessages[newMessages.length - 1];
                        if (lastMessage.role === 'model') {
                            lastMessage.text = fullText;
                        }
                        return newMessages;
                    });

                    if (isAudioEnabled && !isLiveSessionActive) {
                         if (chunk.text.length > 10 || chunk.text.match(/[.!?]/)) {
                             processTtsQueue(chunk.text, messages.length);
                         }
                    }
                }
            }
        } catch (error) {
            console.error("Error sending message:", error);
            setMessages(prev => [...prev, { role: 'model', text: "Xin lỗi, tôi gặp sự cố khi kết nối." }]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const processTtsQueue = async (text: string, messageIndex: number) => {
       if (!text.trim()) return;
       const ttsPromise = textToSpeech(text);
       ttsPromiseQueueRef.current.push({ promise: ttsPromise, messageIndex });
       
       if (!isProcessingTtsRef.current) {
           processNextTts();
       }
    };

    const processNextTts = async () => {
        if (ttsPromiseQueueRef.current.length === 0) {
            isProcessingTtsRef.current = false;
            return;
        }
        isProcessingTtsRef.current = true;
        const { promise, messageIndex } = ttsPromiseQueueRef.current.shift()!;
        try {
            const audioData = await promise;
            if (audioData) {
                audioQueueRef.current.push({ audioData, messageIndex });
                scheduleAudio();
            }
        } catch (e) { console.error("TTS error", e); }
        processNextTts();
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                const parts = base64String.split(',');
                const mimeType = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
                const data = parts[1];
                
                setImageToSend({ data, mimeType, preview: base64String });
            };
            reader.readAsDataURL(file);
        }
    };

    const removeImage = () => {
        setImageToSend(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const toggleAudio = () => {
        setIsAudioEnabled(!isAudioEnabled);
        if (isAudioEnabled) {
             if (audioSourceRef.current) try { audioSourceRef.current.stop(); } catch(e) {}
             audioQueueRef.current = [];
             setCurrentlyPlayingIndex(null);
        }
    };

    useEffect(() => {
        if (capturedImage) {
            setImageToSend({
                data: capturedImage.data,
                mimeType: capturedImage.mimeType,
                preview: `data:${capturedImage.mimeType};base64,${capturedImage.data}`
            });
            onCaptureHandled();
        }
    }, [capturedImage, onCaptureHandled]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (!recognitionRef.current || isLiveSessionActive) return;

        const recognition = recognitionRef.current;
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'vi-VN';

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            const lastResultIndex = event.results.length - 1;
            const transcript = event.results[lastResultIndex][0].transcript.trim().toLowerCase();
            if (transcript.includes(wakeWord) || transcript.includes("hướng dẫn")) {
                if (isVrMode) {
                    setVrAssistantState('active');
                    playPingSound();
                }
            } else if (transcript.includes(stopWord)) {
                onDeactivateVrMode();
                setVrAssistantState('idle');
            } else if (transcript.includes(captureCommand) || transcript.includes("ở đâu")) {
                onTriggerCapture();
            }
        };
        
        if (isVrMode && vrAssistantState === 'idle') {
            try { recognition.start(); } catch(e) { }
        } else {
             recognition.stop();
        }
        return () => { recognition.stop(); };
    }, [isVrMode, vrAssistantState, isLiveSessionActive, isOpen, onDeactivateVrMode, onTriggerCapture, playPingSound, setVrAssistantState]);


    if (!isOpen) return null;

    // Styles for Glassmorphism and animations
    const glassPanelClass = "backdrop-blur-xl bg-white/80 border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.12)]";
    const gradientHeaderClass = "bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500";
    const userBubbleClass = "bg-gradient-to-br from-indigo-600 to-blue-600 text-white rounded-tr-none shadow-md";
    const botBubbleClass = "bg-white/90 text-gray-800 rounded-tl-none shadow-sm border border-gray-100";

    return (
        <div className={`fixed bottom-24 right-6 w-[26rem] h-[36rem] max-h-[80vh] rounded-3xl flex flex-col overflow-hidden z-50 transition-all duration-500 ease-out transform origin-bottom-right scale-100 ${glassPanelClass} font-sans`}>
            
            {/* Header */}
            <div className={`${gradientHeaderClass} p-4 flex justify-between items-center text-white shadow-lg z-10`}>
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 backdrop-blur-sm p-2 rounded-full border border-white/20 shadow-inner">
                        <BotIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h2 className="font-bold text-lg leading-none tracking-wide text-shadow-sm">Virtual Guide</h2>
                        <span className="text-[10px] opacity-90 font-light uppercase tracking-wider">Quang Tri Tour</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                     {/* Volume Control - Mini */}
                     <div className="group relative flex items-center justify-center">
                        <button className="hover:bg-white/20 p-2 rounded-full transition-colors">
                             {volume > 0 ? <span className="text-xs font-bold">{Math.round(volume * 100)}%</span> : <span className="text-xs">Muted</span>}
                        </button>
                        <div className="absolute top-full right-0 mt-2 w-32 bg-white rounded-lg shadow-xl p-2 hidden group-hover:block animate-fade-in z-50">
                             <input 
                                type="range" 
                                min="0" 
                                max="1.5" 
                                step="0.1" 
                                value={volume} 
                                onChange={handleVolumeChange}
                                className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                            />
                        </div>
                     </div>

                    <button onClick={toggleAudio} className={`hover:bg-white/20 p-2 rounded-full transition-colors ${!isAudioEnabled ? 'opacity-50' : ''}`}>
                        {isAudioEnabled ? <SpeakerIcon className="h-5 w-5" /> : <SpeakerOffIcon className="h-5 w-5" />}
                    </button>
                    <button onClick={onClose} className="hover:bg-white/20 hover:text-red-200 p-2 rounded-full transition-colors">
                        <CloseIcon className="h-5 w-5" />
                    </button>
                </div>
            </div>
            
            {/* Live Error Notification */}
            {liveError && (
                <div className="bg-red-50 text-red-800 text-xs font-semibold p-2 text-center border-b border-red-100 animate-fade-in flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
                    {liveError}
                </div>
            )}

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-gradient-to-b from-transparent to-white/40" ref={messagesContainerRef}>
                {messages.map((msg, idx) => (
                    <div key={idx} className={`flex w-full animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        
                        {msg.role === 'model' && (
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-pink-400 to-indigo-400 flex items-center justify-center text-white text-xs font-bold shadow-md mr-2 mt-1 flex-shrink-0">
                                AI
                            </div>
                        )}

                        <div className={`max-w-[80%] p-3.5 rounded-2xl text-sm leading-relaxed relative backdrop-blur-sm ${
                            msg.role === 'user' ? userBubbleClass : botBubbleClass
                        }`}>
                            {msg.imageData && (
                                <div className="mb-2 rounded-lg overflow-hidden border border-white/30 shadow-sm">
                                    <img src={msg.imageData} alt="Uploaded" className="w-full h-auto object-cover" />
                                </div>
                            )}
                            
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                            
                            {/* Audio Playing Indicator */}
                            {msg.role === 'model' && currentlyPlayingIndex === idx && (
                                <div className="absolute -right-2 -top-2">
                                     <span className="relative flex h-4 w-4">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-4 w-4 bg-pink-500 border-2 border-white"></span>
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                
                {isLoading && (
                    <div className="flex justify-start animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-gray-200 mr-2"></div>
                        <div className="bg-white/60 px-4 py-3 rounded-2xl rounded-tl-none shadow-sm">
                            <div className="flex space-x-1">
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                            </div>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area / Footer */}
            <div className="p-4 pt-2 bg-white/60 backdrop-blur-md border-t border-white/50">
                
                {/* Live Mode Visualizer */}
                {isLiveSessionActive ? (
                    <div className="h-16 rounded-2xl bg-gradient-to-r from-rose-500 to-red-600 shadow-lg shadow-red-500/30 flex items-center justify-between px-6 animate-pulse-slow relative overflow-hidden">
                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4yKSIvPjwvc3ZnPg==')] opacity-30"></div>
                        
                        <div className="flex items-center gap-3 text-white z-10">
                            <div className="p-2 bg-white/20 rounded-full animate-ping-slow">
                                <MicrophoneIcon />
                            </div>
                            <div>
                                <div className="font-bold text-sm tracking-wide">LIVE VOICE ACTIVE</div>
                                <div className="text-[10px] opacity-80">Listening...</div>
                            </div>
                        </div>

                        <div className="flex items-end gap-1 h-8 z-10">
                            {[1,2,3,4,5].map(i => (
                                <div key={i} className="w-1 bg-white/80 rounded-full animate-visualizer" style={{ height: `${Math.random() * 100}%`, animationDelay: `${i * 0.1}s` }}></div>
                            ))}
                        </div>

                        <button 
                            onClick={stopLiveSession}
                            className="ml-4 bg-white text-red-600 text-xs font-bold px-3 py-1.5 rounded-full shadow-sm hover:bg-red-50 transition-colors z-10"
                        >
                            END
                        </button>
                    </div>
                ) : (
                    /* Standard Input */
                    <div className="flex flex-col gap-2">
                        {imageToSend && (
                            <div className="flex items-center gap-3 p-2 bg-indigo-50 rounded-xl border border-indigo-100 animate-fade-in">
                                <img src={imageToSend.preview} alt="Preview" className="h-10 w-10 object-cover rounded-lg shadow-sm" />
                                <span className="text-xs font-medium text-indigo-700 truncate flex-1">Image attached</span>
                                <button onClick={removeImage} className="text-gray-400 hover:text-red-500 p-1 transition-colors">
                                    <CloseIcon className="h-4 w-4" />
                                </button>
                            </div>
                        )}
                        
                        <div className="flex items-center gap-2 relative">
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleImageUpload} 
                                accept="image/*" 
                                className="hidden" 
                            />
                            
                            <div className="flex-1 relative group">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                                    placeholder="Ask about Quang Tri..."
                                    className="w-full bg-white border border-gray-200 rounded-full pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100/50 transition-all shadow-sm text-gray-700 placeholder-gray-400"
                                    disabled={isLoading}
                                />
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-indigo-600 p-1.5 rounded-full hover:bg-indigo-50 transition-colors"
                                >
                                    <PaperclipIcon />
                                </button>
                            </div>
                            
                            {input || imageToSend ? (
                                <button 
                                    onClick={handleSendMessage}
                                    disabled={isLoading}
                                    className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white p-3 rounded-full shadow-lg hover:shadow-indigo-500/30 transform hover:scale-105 transition-all active:scale-95 flex-shrink-0"
                                >
                                    <SendIcon />
                                </button>
                            ) : (
                                <button 
                                    onClick={startLiveSession}
                                    className="bg-gradient-to-r from-rose-500 to-pink-500 text-white p-3 rounded-full shadow-lg hover:shadow-pink-500/30 transform hover:scale-105 transition-all active:scale-95 flex-shrink-0 group"
                                    title="Start Live Voice Chat"
                                >
                                    <MicrophoneIcon />
                                    <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Live Mode</span>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* CSS Styles for custom animations and scrollbar */}
            <style>{`
                /* Custom Scrollbar */
                ::-webkit-scrollbar {
                    width: 6px;
                }
                ::-webkit-scrollbar-track {
                    background: transparent; 
                }
                ::-webkit-scrollbar-thumb {
                    background: rgba(0, 0, 0, 0.1); 
                    border-radius: 10px;
                }
                ::-webkit-scrollbar-thumb:hover {
                    background: rgba(0, 0, 0, 0.2); 
                }

                /* Animations */
                @keyframes slide-up {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                .animate-slide-up {
                    animation: slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                
                @keyframes visualizer {
                    0%, 100% { height: 20%; }
                    50% { height: 80%; }
                }
                .animate-visualizer {
                    animation: visualizer 0.8s infinite ease-in-out;
                }

                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.2s ease-out forwards;
                }
                
                .text-shadow-sm {
                    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
                
                .animate-pulse-slow {
                    animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }
            `}</style>
        </div>
    );
};

export default Chatbot;
