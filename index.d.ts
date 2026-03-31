export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlockBase64 {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export interface ImageBlockUrl {
  type: 'image';
  source: { type: 'url'; url: string; media_type?: string };
}

export interface ImageBlockInline {
  inlineData: { mimeType: string; data: string };
}

export interface ImageBlockFile {
  fileData: { mimeType: string; fileUri: string };
}

export type ImageBlock = ImageBlockBase64 | ImageBlockUrl | ImageBlockInline | ImageBlockFile;

export interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  name: string;
  content: string | Record<string, unknown>;
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (args: Record<string, unknown>, ctx?: { toolCallId: string }) => Promise<unknown>;
}

export type Tools = Record<string, ToolDefinition>;

export interface SafetySetting {
  category: string;
  threshold: string;
}

export interface GenerationParams {
  model?: string | { modelId?: string; id?: string };
  system?: string;
  messages: Message[];
  tools?: Tools;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  safetySettings?: SafetySetting[];
}

// --- streamGemini ---

export interface StartStepEvent { type: 'start-step' }
export interface TextDeltaEvent { type: 'text-delta'; textDelta: string }
export interface ToolCallEvent { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
export interface ToolResultEvent { type: 'tool-result'; toolCallId: string; toolName: string; args: Record<string, unknown>; result: unknown }
export interface FinishStepEvent { type: 'finish-step'; finishReason: 'stop' | 'tool-calls' | 'error' }
export interface ErrorEvent { type: 'error'; error: Error }

export type StreamEvent = StartStepEvent | TextDeltaEvent | ToolCallEvent | ToolResultEvent | FinishStepEvent | ErrorEvent;

export interface StreamResult {
  fullStream: AsyncIterable<StreamEvent>;
  warnings: Promise<unknown[]>;
}

export interface StreamParams extends GenerationParams {
  onStepFinish?: () => Promise<void> | void;
}

export function streamGemini(params: StreamParams): StreamResult;

// --- generateGemini ---

export interface GenerateResult {
  text: string;
  parts: unknown[];
  response: unknown;
}

export function generateGemini(params: GenerationParams): Promise<GenerateResult>;

// --- utilities ---

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export function convertMessages(messages: Message[]): GeminiContent[];
export function convertTools(tools: Tools): Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
export function cleanSchema(schema: unknown): unknown;

export class GeminiError extends Error {
  name: 'GeminiError';
  status?: number;
  code?: string | number;
  retryable: boolean;
  constructor(message: string, options?: { status?: number; code?: string | number; retryable?: boolean });
}
