declare module 'mailparser' {
  export interface Attachment {
    filename?: string;
    contentType: string;
    content: Buffer;
  }

  export interface ParsedMail {
    attachments: Attachment[];
    from?: { text?: string };
    subject?: string;
    text?: string;
    html?: string | Buffer;
  }

  export function simpleParser(source: Buffer): Promise<ParsedMail>;
}
