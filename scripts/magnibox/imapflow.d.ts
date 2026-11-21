declare module "imapflow" {
  export type ImapFlowOptions = {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    tls?: { rejectUnauthorized?: boolean; minVersion?: string; ca?: string | Buffer };
    logger?: boolean;
    connectionTimeout?: number;
    greetingTimeout?: number;
    socketTimeout?: number;
  };

  export class ImapFlow {
    constructor(options: ImapFlowOptions);
    mailbox?: {
      uidValidity?: bigint | number | string;
      uidNext?: bigint | number | string;
      highestModseq?: bigint | number | string;
    };
    connect(): Promise<void>;
    getMailboxLock(path: string, options?: { description?: string }): Promise<{ release(): void }>;
    search(criteria: { header: Record<string, string> }, options?: { uid?: boolean }): Promise<number[] | false | undefined>;
    append(path: string, content: Buffer, flags?: string[], internalDate?: Date): Promise<{
      uid?: number | bigint;
      uidValidity?: number | bigint;
    } | false>;
    logout(): Promise<void>;
  }
}
