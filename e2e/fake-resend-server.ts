import { createServer } from "node:http";

/** A stand-in Resend for the end-to-end run. POST /emails records the message; GET /__emails lists what was "sent". */
const emails: { to: string[]; subject: string; text: string; from: string; auth: string | undefined }[] = [];

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:4013");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/__emails") {
    res.end(JSON.stringify({ emails }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (req.method === "POST" && url.pathname === "/emails") {
    const b = JSON.parse(Buffer.concat(chunks).toString() || "{}") as { to?: string[]; subject?: string; text?: string; from?: string };
    emails.push({ to: b.to ?? [], subject: b.subject ?? "", text: b.text ?? "", from: b.from ?? "", auth: req.headers.authorization });
    res.end(JSON.stringify({ id: `fake-${emails.length}` }));
    return;
  }
  res.statusCode = 404;
  res.end("{}");
}).listen(4013, () => console.log("fake resend on 4013"));
