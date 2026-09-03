export interface MindManifest {
  schema_version: 1 | 2;
  id: string;
  name: string;
  description?: string;
  language?: string;
  version?: string;
  default_language?: string;
  core?: string;
  [key: string]: unknown;
}

export interface InstalledMind {
  manifest: MindManifest;
  directory: string;
}

export type MessageRole = "user" | "mind";
export type MessageStatus = "completed" | "interrupted" | "failed";
export type ResponseMode = "full" | "chat";

export interface Conversation {
  id: string;
  codexThreadId: string | null;
  mindId: string;
  mindVersion: string;
  appVersion: string | null;
  promptContract: number | null;
  model: string | null;
  responseMode: ResponseMode;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NativeThreadSummary {
  id: string;
  mindId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  conversationId: string;
  mindId: string | null;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  createdAt: string;
}
