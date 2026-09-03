import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CodexAppServer } from "../codex-app-server.ts";
import type { MindsPaths } from "../paths.ts";
import { ConversationStore } from "../storage.ts";
import type { Conversation, InstalledMind, Message, MessageStatus, ResponseMode } from "../types.ts";

export class ChatRuntime {
  private conversation: Conversation;
  private selectedResponseMode: ResponseMode;
  private activatedKey: string | null = null;
  private activatedGeneration = 0;
  private threadHasName = false;
  private identityHandoffPending = false;

  constructor(
    private readonly server: CodexAppServer,
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
      this.conversation = this.store.getConversation(conversation.id) ?? conversation;
    }
  }

  get id(): string {
    return this.conversation.id;
  }

  get currentConversation(): Conversation {
    return this.store.getConversation(this.conversation.id) ?? this.conversation;
  }

  get model(): string | null {
    return this.currentConversation.model ?? this.requestedModel ?? null;
  }

  get responseMode(): ResponseMode {
    return this.selectedResponseMode;
  }

  private get workspace(): string {
    return join(this.paths.workspaces, "threads");
  }

  private get activationKey(): string {
    return [
      this.currentConversation.codexThreadId ?? "new",
      this.mind.manifest.id,
      this.selectedResponseMode,
      this.requestedModel ?? this.currentConversation.model ?? "default",
    ].join("\u0000");
  }

  async prepare(): Promise<void> {
    await mkdir(this.workspace, { recursive: true });
    await this.server.prepare(this.workspace);
  }

  private async ensureThread(history: Message[]): Promise<string> {
    await this.prepare();
    const key = this.activationKey;
    if (
      this.currentConversation.codexThreadId
      && this.activatedKey === key
      && this.activatedGeneration === this.server.generation
    ) {
      return this.currentConversation.codexThreadId;
    }

    const resumeThreadId = this.currentConversation.codexThreadId ?? undefined;
    const result = await this.server.start(
      this.mind,
      history,
      this.workspace,
      this.requestedModel ?? this.currentConversation.model ?? undefined,
      this.selectedResponseMode,
      resumeThreadId,
      false,
      this.identityHandoffPending,
    );

    if (!resumeThreadId) this.store.setCodexThreadId(this.conversation.id, result.threadId);
    if (result.messages.length > 0 && this.store.messageCount(this.conversation.id) === 0) {
      this.store.replaceMessages(this.conversation.id, result.messages);
    }
    if (result.model) this.store.setModel(this.conversation.id, result.model);
    this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
    this.threadHasName = result.hasName;
    this.identityHandoffPending = false;
    this.activatedGeneration = this.server.generation;
    this.activatedKey = this.activationKey;
    return result.threadId;
  }

  newConversation(): void {
    this.release();
    this.store.deleteIfEmpty(this.conversation.id);
    this.conversation = this.store.createConversation(
      this.mind.manifest.id,
      "identity",
      this.requestedModel ?? null,
      this.selectedResponseMode,
    );
    this.activatedKey = null;
    this.activatedGeneration = 0;
    this.threadHasName = false;
    this.identityHandoffPending = false;
  }

  setResponseMode(responseMode: ResponseMode): void {
    if (responseMode === this.selectedResponseMode) return;
    this.selectedResponseMode = responseMode;
    this.store.setResponseMode(this.conversation.id, responseMode);
    this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
    this.activatedKey = null;
  }

  switchMind(mind: InstalledMind): void {
    if (mind.manifest.id === this.mind.manifest.id) return;
    this.mind = mind;
    this.store.setConversationMind(this.conversation.id, mind.manifest.id);
    this.store.setLastMindId(mind.manifest.id);
    this.conversation = this.store.getConversation(this.conversation.id) ?? this.conversation;
    this.identityHandoffPending = this.conversation.codexThreadId !== null;
    this.activatedKey = null;
  }

  async ask(
    text: string,
    onDelta: (delta: string) => void,
    persistUser = true,
    onUserPersisted?: () => void,
  ): Promise<{ text: string; status: MessageStatus; error?: string }> {
    let history = this.store.messages(this.conversation.id);
    if (!persistUser && !this.currentConversation.codexThreadId) {
      const retriedPrompt = history.findLastIndex((message) => message.role === "user" && message.content === text);
      if (retriedPrompt >= 0) history = history.slice(0, retriedPrompt);
    }
    if (persistUser) {
      this.store.addMessage(this.conversation.id, "user", text);
      onUserPersisted?.();
    }
    try {
      const threadId = await this.ensureThread(history);
      if (!this.threadHasName) {
        this.threadHasName = true;
        void this.server.setThreadName(threadId, text).catch(() => {
          this.threadHasName = false;
        });
      }
      const result = await this.server.turn(threadId, text, onDelta);
      if (result.text) {
        this.store.addMessage(this.conversation.id, "mind", result.text, result.status, this.mind.manifest.id);
      }
      if (result.status === "failed") {
        return { text: result.text, status: "failed", error: result.error ?? "The response failed." };
      }
      return { text: result.text, status: result.status, error: result.error };
    } catch (error) {
      this.activatedKey = null;
      const output = error instanceof Error ? error.message : String(error);
      return { text: "", status: "failed", error: output };
    }
  }

  async interrupt(): Promise<void> {
    await this.server.interrupt();
  }

  release(): void {
    const threadId = this.currentConversation.codexThreadId;
    this.activatedKey = null;
    this.activatedGeneration = 0;
    if (threadId) void this.server.unsubscribe(threadId).catch(() => undefined);
  }
}
