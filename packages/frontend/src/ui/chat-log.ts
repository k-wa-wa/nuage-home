export type ChatRole = "user" | "assistant" | "error";

/**
 * 会話ログ・書き起こし行の表示管理。
 * 書き起こしは断片で届くため、話者が変わるまで同一の行に追記し、完了または話者交代で改行する。
 */
export class ChatLog {
  private currentLine: { role: "user" | "assistant"; el: HTMLLIElement } | null = null;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  append(role: ChatRole, text: string): void {
    if (role !== "error" && this.currentLine?.role === role) {
      this.currentLine.el.textContent += text;
    } else {
      const li = document.createElement("li");
      li.className = `log-${role}`;
      li.textContent = text;
      this.container.prepend(li);
      this.currentLine = role === "error" ? null : { role, el: li };
    }
  }

  resetCurrentLine(): void {
    this.currentLine = null;
  }

  clear(): void {
    this.container.innerHTML = "";
    this.currentLine = null;
  }
}
