declare module "nodemailer" {
  export function createTransport(options: Record<string, unknown>): {
    sendMail(message: Record<string, unknown>): Promise<{
      messageId?: string;
      accepted?: unknown[];
      rejected?: unknown[];
    }>;
  };
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
