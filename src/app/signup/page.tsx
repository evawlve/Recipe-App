import SignUpFormClient from "./sign-up-form-client";

export default function SignUpPage() {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">Sign Up</h1>
      <p className="text-sm text-muted-foreground">Create your account to continue.</p>
      <SignUpFormClient />
    </div>
  );
}


