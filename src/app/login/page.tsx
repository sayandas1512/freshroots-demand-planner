import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Freshroots" };

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Freshroots</h1>
        <p className="muted">Demand planner. Sign in with your Freshroots account.</p>
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
