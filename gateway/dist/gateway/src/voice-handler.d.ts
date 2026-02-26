/**
 * Voice I/O Handler for the ForgeTeam Gateway.
 *
 * Provides integration points for:
 * - Whisper STT (Speech-to-Text) for voice input
 * - ElevenLabs TTS (Text-to-Speech) for voice output
 * - Arabic language support
 *
 * This module provides the full API call structure and processing pipeline.
 * Actual API calls require valid API keys set via environment variables.
 */
import { EventEmitter } from 'eventemitter3';
/** Supported languages for voice I/O */
export type VoiceLanguage = 'en' | 'ar' | 'en-US' | 'ar-SA';
/** Configuration for the voice handler */
export interface VoiceConfig {
    /** Whisper API endpoint (OpenAI-compatible) */
    whisperEndpoint: string;
    /** Whisper API key */
    whisperApiKey: string;
    /** Whisper model to use */
    whisperModel: string;
    /** ElevenLabs API endpoint */
    elevenLabsEndpoint: string;
    /** ElevenLabs API key */
    elevenLabsApiKey: string;
    /** Default ElevenLabs voice ID */
    defaultVoiceId: string;
    /** Whether Arabic support is enabled */
    arabicEnabled: boolean;
    /** Default language */
    defaultLanguage: VoiceLanguage;
    /** Audio sample rate for STT */
    sampleRate: number;
    /** Maximum audio duration in seconds */
    maxDurationSeconds: number;
}
/** Result of a speech-to-text transcription */
export interface STTResult {
    id: string;
    text: string;
    language: VoiceLanguage;
    confidence: number;
    durationMs: number;
    /** Word-level timestamps if available */
    words: {
        word: string;
        start: number;
        end: number;
    }[];
    timestamp: string;
}
/** Request for text-to-speech synthesis */
export interface TTSRequest {
    text: string;
    language: VoiceLanguage;
    voiceId?: string;
    /** Speed multiplier (0.5 = half speed, 2.0 = double speed) */
    speed?: number;
    /** Stability setting for ElevenLabs [0.0, 1.0] */
    stability?: number;
    /** Similarity boost for ElevenLabs [0.0, 1.0] */
    similarityBoost?: number;
}
/** Result of a text-to-speech synthesis */
export interface TTSResult {
    id: string;
    /** Base64 encoded audio data */
    audioBase64: string;
    mimeType: string;
    durationMs: number;
    language: VoiceLanguage;
    timestamp: string;
}
/** Events emitted by the VoiceHandler */
export interface VoiceHandlerEvents {
    'voice:stt-started': (id: string) => void;
    'voice:stt-completed': (result: STTResult) => void;
    'voice:stt-error': (id: string, error: string) => void;
    'voice:tts-started': (id: string) => void;
    'voice:tts-completed': (result: TTSResult) => void;
    'voice:tts-error': (id: string, error: string) => void;
}
export declare class VoiceHandler extends EventEmitter<VoiceHandlerEvents> {
    private config;
    /** Track processing state */
    private activeTranscriptions;
    private activeSyntheses;
    constructor(config?: Partial<VoiceConfig>);
    /**
     * Returns whether the voice handler is configured with valid API keys.
     */
    isConfigured(): {
        stt: boolean;
        tts: boolean;
    };
    /**
     * Returns whether Arabic language support is enabled.
     */
    isArabicEnabled(): boolean;
    /**
     * Transcribes audio data to text using Whisper STT.
     *
     * @param audioBuffer - Raw audio data (WAV, MP3, M4A, etc.)
     * @param language - Language hint for transcription
     * @returns Transcription result
     */
    transcribe(audioBuffer: Buffer, language?: VoiceLanguage): Promise<STTResult>;
    /**
     * Synthesizes text to speech using ElevenLabs TTS.
     *
     * @param request - TTS request parameters
     * @returns Synthesized audio result
     */
    synthesize(request: TTSRequest): Promise<TTSResult>;
    /**
     * Returns the current processing status.
     */
    getStatus(): {
        activeTranscriptions: number;
        activeSyntheses: number;
        configured: {
            stt: boolean;
            tts: boolean;
        };
        arabicEnabled: boolean;
    };
    /**
     * Updates the voice handler configuration.
     */
    updateConfig(config: Partial<VoiceConfig>): void;
}
//# sourceMappingURL=voice-handler.d.ts.map