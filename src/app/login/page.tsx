import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Freshroots" };

export default function LoginPage() {
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Freshroots</h1>
        <p className="muted">Demand planner. Enter your Freshroots email and we will send you a one-time sign-in link. No password.</p>
        <Suspense><LoginForm /></Suspense>
      </div>
    </div>
  );
}
