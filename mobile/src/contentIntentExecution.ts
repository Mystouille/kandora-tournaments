export interface ContentIntentExecutionTicket {
  generation: number;
  key: string;
}

export class ContentIntentExecutionGate {
  private generation = 0;
  private active: ContentIntentExecutionTicket | null = null;

  supersede(): number {
    this.generation += 1;
    return this.generation;
  }

  isExecutingKey(key: string): boolean {
    return this.active?.key === key;
  }

  tryStart(key: string): ContentIntentExecutionTicket | null {
    if (this.active?.generation === this.generation) {
      return null;
    }
    const ticket = { generation: this.generation, key };
    this.active = ticket;
    return ticket;
  }

  isCurrent(
    ticket: ContentIntentExecutionTicket,
    pendingKey: string | null
  ): boolean {
    return ticket.generation === this.generation && pendingKey === ticket.key;
  }

  finish(ticket: ContentIntentExecutionTicket): void {
    if (
      this.active?.generation === ticket.generation &&
      this.active.key === ticket.key
    ) {
      this.active = null;
    }
  }
}
