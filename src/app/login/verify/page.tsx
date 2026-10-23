import { VerifyForm } from "./VerifyForm";

export const metadata = { title: "Confirm sign-in · Freshroots" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Confirm sign-in</h1>
        <p className="muted">One more click. This keeps email scanners from using up your link.</p>
        <VerifyForm token={typeof token === "string" ? token : ""} />
      </div>
    </div>
  );
}
