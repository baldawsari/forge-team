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
import { v4 as uuid } from 'uuid';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  words: { word: string; start: number; end: number }[];
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

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: VoiceConfig = {
  whisperEndpoint: 'https://api.openai.com/v1/audio/transcriptions',
  whisperApiKey: process.env.WHISPER_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
  whisperModel: 'whisper-1',
  elevenLabsEndpoint: 'https://api.elevenlabs.io/v1/text-to-speech',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  defaultVoiceId: 'pNInz6obpgDQGcFmaJgB', // Adam voice
  arabicEnabled: true,
  defaultLanguage: 'en',
  sampleRate: 16000,
  maxDurationSeconds: 300,
};

// ---------------------------------------------------------------------------
// Voice Handler
// ---------------------------------------------------------------------------

export class VoiceHandler extends EventEmitter<VoiceHandlerEvents> {
  private config: VoiceConfig;
  /** Track processing state */
  private activeTranscriptions: Set<string> = new Set();
  private activeSyntheses: Set<string> = new Set();

  constructor(config?: Partial<VoiceConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Returns whether the voice handler is configured with valid API keys.
   */
  isConfigured(): { stt: boolean; tts: boolean } {
    return {
      stt: this.config.whisperApiKey.length > 0,
      tts: this.config.elevenLabsApiKey.length > 0,
    };
  }

  /**
   * Returns whether Arabic language support is enabled.
   */
  isArabicEnabled(): boolean {
    return this.config.arabicEnabled;
  }

  /**
   * Transcribes audio data to text using Whisper STT.
   *
   * @param audioBuffer - Raw audio data (WAV, MP3, M4A, etc.)
   * @param language - Language hint for transcription
   * @returns Transcription result
   */
  async transcribe(
    audioBuffer: Buffer,
    language?: VoiceLanguage
  ): Promise<STTResult> {
    const id = uuid();
    this.activeTranscriptions.add(id);
    this.emit('voice:stt-started', id);

    const resolvedLanguage = language ?? this.config.defaultLanguage;
    const startTime = Date.now();

    try {
      if (!this.config.whisperApiKey) {
        throw new Error('Whisper API key not configured. Set OPENAI_API_KEY environment variable.');
      }

      // Validate audio size (rough check: 16kHz * 16bit * maxDuration)
      const maxBytes = this.config.sampleRate * 2 * this.config.maxDurationSeconds;
      if (audioBuffer.length > maxBytes) {
        throw new Error(
          `Audio too long: ${audioBuffer.length} bytes exceeds max ${maxBytes} bytes (${this.config.maxDurationSeconds}s)`
        );
      }

      // Build multipart form data for Whisper API
      const boundary = `----FormBoundary${uuid().replace(/-/g, '')}`;
      const formParts: Buffer[] = [];

      // File field
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      ));
      formParts.push(audioBuffer);
      formParts.push(Buffer.from('\r\n'));

      // Model field
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${this.config.whisperModel}\r\n`
      ));

      // Language field (map to ISO 639-1)
      const isoLang = resolvedLanguage.startsWith('ar') ? 'ar' : 'en';
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${isoLang}\r\n`
      ));

      // Response format
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
      ));

      // Timestamp granularity
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\nword\r\n`
      ));

      formParts.push(Buffer.from(`--${boundary}--\r\n`));

      const body = Buffer.concat(formParts);

      const response = await fetch(this.config.whisperEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.whisperApiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Whisper API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as {
        text: string;
        language: string;
        duration: number;
        words?: { word: string; start: number; end: number }[];
      };

      const result: STTResult = {
        id,
        text: data.text,
        language: resolvedLanguage,
        confidence: 0.95, // Whisper doesn't return confidence in this format
        durationMs: Date.now() - startTime,
        words: data.words ?? [],
        timestamp: new Date().toISOString(),
      };

      this.emit('voice:stt-completed', result);
      return result;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown STT error';
      console.error(`[VoiceHandler] STT error:`, message);
      this.emit('voice:stt-error', id, message);

      // Return a failed result rather than throwing
      return {
        id,
        text: '',
        language: resolvedLanguage,
        confidence: 0,
        durationMs: Date.now() - startTime,
        words: [],
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.activeTranscriptions.delete(id);
    }
  }

  /**
   * Synthesizes text to speech using ElevenLabs TTS.
   *
   * @param request - TTS request parameters
   * @returns Synthesized audio result
   */
  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const id = uuid();
    this.activeSyntheses.add(id);
    this.emit('voice:tts-started', id);

    const startTime = Date.now();

    try {
      if (!this.config.elevenLabsApiKey) {
        throw new Error('ElevenLabs API key not configured. Set ELEVENLABS_API_KEY environment variable.');
      }

      const voiceId = request.voiceId ?? this.config.defaultVoiceId;
      const url = `${this.config.elevenLabsEndpoint}/${voiceId}`;

      const body = {
        text: request.text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: request.stability ?? 0.5,
          similarity_boost: request.similarityBoost ?? 0.75,
          speed: request.speed ?? 1.0,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.elevenLabsApiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
      }

      const audioArrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(audioArrayBuffer);
      const audioBase64 = audioBuffer.toString('base64');

      // Estimate duration from file size (MP3 at ~128kbps)
      const estimatedDurationMs = (audioBuffer.length * 8) / 128;

      const result: TTSResult = {
        id,
        audioBase64,
        mimeType: 'audio/mpeg',
        durationMs: estimatedDurationMs,
        language: request.language,
        timestamp: new Date().toISOString(),
      };

      this.emit('voice:tts-completed', result);
      return result;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown TTS error';
      console.error(`[VoiceHandler] TTS error:`, message);
      this.emit('voice:tts-error', id, message);

      // Return an empty result rather than throwing
      return {
        id,
        audioBase64: '',
        mimeType: 'audio/mpeg',
        durationMs: 0,
        language: request.language,
        timestamp: new Date().toISOString(),
      };
    } finally {
      this.activeSyntheses.delete(id);
    }
  }

  /**
   * Returns the current processing status.
   */
  getStatus(): {
    activeTranscriptions: number;
    activeSyntheses: number;
    configured: { stt: boolean; tts: boolean };
    arabicEnabled: boolean;
  } {
    return {
      activeTranscriptions: this.activeTranscriptions.size,
      activeSyntheses: this.activeSyntheses.size,
      configured: this.isConfigured(),
      arabicEnabled: this.config.arabicEnabled,
    };
  }

  /**
   * Updates the voice handler configuration.
   */
  updateConfig(config: Partial<VoiceConfig>): void {
    this.config = { ...this.config, ...config };
  }
}
