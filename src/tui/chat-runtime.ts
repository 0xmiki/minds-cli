import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CodexAppServer } from "../codex-app-server.ts";
import type { MindsPaths } from "../paths.ts";
import { ConversationStore } from "../storage.ts";
import type { Conversation, InstalledMind, MessageStatus, NativeThreadSummary, ResponseMode } from "../types.ts";

export class ChatRuntime {
  private server: CodexAppServer | null = null;
  private started = false;
  private pendingThreadId: string | null = null;
  private conversation: Conversation;
  private selectedResponseMode: ResponseMode;

  constructor(
    private mind: InstalledMind,
    private readonly store: ConversationStore,
    private readonly paths: MindsPaths,
    conversation: Conversation,
    private readonly requestedModel?: string,
    requestedResponseMode?: ResponseMode,
  ) {
    this.conversation = conversation;
    this.selectedResponseMode = requestedResponseMode ?? conversation.responseMode;
    if (requestedResponseMode && requestedResponseMode !== conversation.responseMode) {
      this.store.setResponseMode(conversation.id, requestedResponseMode);
    }
  }

  get id(): string {
    return this.conversation.id;
  }

  get currentConversation(): Conversation {
    return this.store.getConversation(this.conversation.id) ?? this.conversation;
  }

  get model(): string | null {
    return this.server?.model ?? this.currentConversation.model ?? this.requestedModel ?? null;
  }

  get responseMode(): ResponseMode {
    return this.selectedResponseMode;
  }

  private get workspace(): string {
    return join(this.paths.workspaces, "threads");
  }

  async prepare(): Promise<void> {
    this.server?.close();
    this.server = new CodexAppServer();
    this.started = false;
    this.pendingThreadId = null;
    await mkdir(this.workspace, { recursive: true });
    await this.server.prepare(this.workspace);
  }

  async start(identityHandoff = false): Promise<void> {
    if (!this.server) await this.prepare();
    const server = this.server!;
    const history = this.store.messages(this.conversation.id);
    const legacyConversation = !this.conversation.codexThreadId && history.length > 0;
    const result = await server.start(
      this.mind,
      history,
      this.workspace,
      this.requestedModel ?? this.conversation.model ?? undefined,
      this.selectedResponseMode,
      this.conversation.codexThreadId ?? undefined,
      legacyConversation,
      identityHandoff,
    );
    if (!legacyConversation && !this.conversation.codexThreadId) this.pendingThreadId = result.threadId;
    if (result.messages.length > 0 && this.store.messageCount(this.conversation.id) === 0) {
      this.store.replaceMessages(this.conversation.id, result.messages);
    }
    if (server.model) this.store.setModel(this.conversation.id, server.model);
    this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
    this.started = true;
  }

  async listThreads(minds: InstalledMind[]): Promise<NativeThreadSummary[]> {
    if (!this.server) await this.prepare();
    const workspaces = await Promise.all([
      { mindId: this.mind.manifest.id, workspace: this.workspace },
      ...minds.map((mind) => ({ mindId: mind.manifest.id, workspace: join(this.paths.workspaces, mind.manifest.id) })),
    ].map(async (item) => {
      await mkdir(item.workspace, { recursive: true });
      return item;
    }));
    return this.server!.listThreads(workspaces);
  }

  async newConversation(): Promise<void> {
    this.store.deleteIfEmpty(this.conversation.id);
    this.conversation = this.store.createConversation(
      this.mind.manifest.id,
      this.mind.manifest.version,
      this.requestedModel ?? null,
      this.selectedResponseMode,
    );
    await this.prepare();
  }

  async setResponseMode(responseMode: ResponseMode): Promise<void> {
    if (responseMode === this.selectedResponseMode) return;
    this.selectedResponseMode = responseMode;
    this.store.setResponseMode(this.conversation.id, responseMode);
    this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
    if (this.started || this.conversation.codexThreadId) await this.start();
  }

  async switchMind(mind: InstalledMind): Promise<void> {
    if (mind.manifest.id === this.mind.manifest.id) return;
    this.mind = mind;
    this.store.setConversationMind(this.conversation.id, mind.manifest.id, mind.manifest.version);
    this.store.setLastMindId(mind.manifest.id);
    this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
    if (this.started || this.conversation.codexThreadId) await this.start(true);
  }

  async ask(
    text: string,
    onDelta: (delta: string) => void,
    persistUser = true,
    onUserPersisted?: () => void,
  ): Promise<{ text: string; status: MessageStatus }> {
    try {
      if (!this.started) await this.start();
      if (persistUser) {
        this.store.addMessage(this.conversation.id, "user", text);
        onUserPersisted?.();
      }
      const result = await this.server!.turn(text, onDelta);
      if (this.pendingThreadId) {
        this.store.setCodexThreadId(this.conversation.id, this.pendingThreadId);
        this.pendingThreadId = null;
        this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
      }
      const output = result.text || result.error || "The turn ended without a response.";
      this.store.addMessage(this.conversation.id, "mind", output, result.status, this.mind.manifest.id);
      return { text: output, status: result.status };
    } catch (error) {
      const output = error instanceof Error ? error.message : String(error);
      this.store.addMessage(this.conversation.id, "mind", output, "failed", this.mind.manifest.id);
      return { text: output, status: "failed" };
    }
  }

  async interrupt(): Promise<void> {
    await this.server?.interrupt();
  }

  close(): void {
    this.server?.close();
    this.server = null;
    this.started = false;
    this.pendingThreadId = null;
  }
}
