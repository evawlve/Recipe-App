"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle, Mail, User } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/Logo";

// Step 1: Email and Password
const emailPasswordSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "At least 8 characters"),
});

// Step 2: Email Confirmation
const emailConfirmationSchema = z.object({
  confirmEmail: z.string().email("Enter a valid email"),
});

// Step 3: Password Confirmation
const passwordConfirmationSchema = z.object({
  confirmPassword: z.string().min(8, "At least 8 characters"),
});

// Step 4: Name
const nameSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

type EmailPasswordInput = z.infer<typeof emailPasswordSchema>;
type EmailConfirmationInput = z.infer<typeof emailConfirmationSchema>;
type PasswordConfirmationInput = z.infer<typeof passwordConfirmationSchema>;
type NameInput = z.infer<typeof nameSchema>;

type SignupStep = "email-password" | "email-confirmation" | "password-confirmation" | "name" | "confirmation";

export default function SignUpFormClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/recipes";
  
  const [currentStep, setCurrentStep] = useState<SignupStep>("email-password");
  const [serverMessage, setServerMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [signupData, setSignupData] = useState<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }>({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
  });

  const emailPasswordForm = useForm<EmailPasswordInput>({
    resolver: zodResolver(emailPasswordSchema),
    defaultValues: { email: "", password: "" },
  });

  const emailConfirmationForm = useForm<EmailConfirmationInput>({
    resolver: zodResolver(emailConfirmationSchema),
    defaultValues: { confirmEmail: "" },
  });

  const passwordConfirmationForm = useForm<PasswordConfirmationInput>({
    resolver: zodResolver(passwordConfirmationSchema),
    defaultValues: { confirmPassword: "" },
  });

  const nameForm = useForm<NameInput>({
    resolver: zodResolver(nameSchema),
    defaultValues: { firstName: "", lastName: "" },
  });

  async function handleEmailPasswordSubmit(values: EmailPasswordInput) {
    setSignupData(prev => ({ ...prev, ...values }));
    setCurrentStep("email-confirmation");
  }

  async function handleEmailConfirmationSubmit(values: EmailConfirmationInput) {
    if (values.confirmEmail !== signupData.email) {
      emailConfirmationForm.setError("confirmEmail", {
        type: "manual",
        message: "Emails do not match"
      });
      return;
    }
    setCurrentStep("password-confirmation");
  }

  async function handlePasswordConfirmationSubmit(values: PasswordConfirmationInput) {
    if (values.confirmPassword !== signupData.password) {
      passwordConfirmationForm.setError("confirmPassword", {
        type: "manual",
        message: "Passwords do not match"
      });
      return;
    }
    setCurrentStep("name");
  }

  async function handleNameSubmit(values: NameInput) {
    // Update signup data with the name values
    const updatedSignupData = { ...signupData, ...values };
    setSignupData(updatedSignupData);
    setCurrentStep("confirmation");
    
    // Now perform the actual signup
    setLoading(true);
    setServerMessage("");
    
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signUp({
        email: updatedSignupData.email,
        password: updatedSignupData.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(
            redirectTo
          )}&newUser=true`,
          data: {
            first_name: values.firstName,
            last_name: values.lastName,
            name: `${values.firstName} ${values.lastName}`,
          },
        },
      });

      if (error) {
        setServerMessage(error.message);
        setCurrentStep("email-password");
        return;
      }

      setServerMessage("Account created successfully!");
    } catch (error) {
      setServerMessage("An unexpected error occurred. Please try again.");
      setCurrentStep("email-password");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setOauthLoading(true);
    setServerMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(
            redirectTo
          )}&newUser=true`,
        },
      });
      if (error) setServerMessage(`Google sign in failed: ${error.message}`);
    } finally {
      setOauthLoading(false);
    }
  }

  function goBack() {
    if (currentStep === "email-confirmation") {
      setCurrentStep("email-password");
    } else if (currentStep === "password-confirmation") {
      setCurrentStep("email-confirmation");
    } else if (currentStep === "name") {
      setCurrentStep("password-confirmation");
    } else if (currentStep === "confirmation") {
      setCurrentStep("name");
    }
  }

  const emailError = emailPasswordForm.formState.errors.email?.message;
  const passwordError = emailPasswordForm.formState.errors.password?.message;
  const confirmEmailError = emailConfirmationForm.formState.errors.confirmEmail?.message;
  const confirmPasswordError = passwordConfirmationForm.formState.errors.confirmPassword?.message;
  const firstNameError = nameForm.formState.errors.firstName?.message;
  const lastNameError = nameForm.formState.errors.lastName?.message;

  // Check if user has started filling out the form
  const hasFormData = () => {
    return signupData.email || 
           signupData.password || 
           signupData.firstName || 
           signupData.lastName ||
           emailPasswordForm.watch("email") ||
           emailPasswordForm.watch("password") ||
           emailConfirmationForm.watch("confirmEmail") ||
           passwordConfirmationForm.watch("confirmPassword") ||
           nameForm.watch("firstName") ||
           nameForm.watch("lastName");
  };

  const handleLogoClick = (e: React.MouseEvent) => {
    if (hasFormData()) {
      const confirmed = window.confirm(
        "You've started filling out the signup form. Are you sure you want to leave and go to the home page? Your progress will be lost."
      );
      if (!confirmed) {
        e.preventDefault();
      }
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Logo */}
      <div className="flex justify-center mb-4 -mt-8">
        <Link 
          href="/" 
          onClick={handleLogoClick}
          className="hover:opacity-80 transition-opacity cursor-pointer"
        >
          <Logo withText size="lg" />
        </Link>
      </div>
      
      {/* Progress indicator */}
      <div className="flex justify-center mb-6">
        <div className="flex items-center space-x-2">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "email-password" ? "bg-primary text-primary-foreground" : 
            ["email-confirmation", "password-confirmation", "name", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <Mail className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            ["email-confirmation", "password-confirmation", "name", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "email-confirmation" ? "bg-primary text-primary-foreground" : 
            ["password-confirmation", "name", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <Mail className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            ["password-confirmation", "name", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "password-confirmation" ? "bg-primary text-primary-foreground" : 
            ["name", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <User className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            ["name", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "name" ? "bg-primary text-primary-foreground" : 
            currentStep === "confirmation" ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <User className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            currentStep === "confirmation" ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "confirmation" ? "bg-primary text-primary-foreground" : 
            "bg-muted text-muted-foreground"
          }`}>
            <CheckCircle className="w-4 h-4" />
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden">
        {/* Step 1: Email and Password */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "email-password" 
            ? "translate-x-0 opacity-100" 
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>
                Enter your email and password to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={emailPasswordForm.handleSubmit(handleEmailPasswordSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    {...emailPasswordForm.register("email")}
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? "email-error" : undefined}
                  />
                  {emailError ? (
                    <p id="email-error" className="text-sm text-destructive mt-1">
                      {emailError}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    {...emailPasswordForm.register("password")}
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? "password-error" : undefined}
                  />
                  {passwordError ? (
                    <p id="password-error" className="text-sm text-destructive mt-1">
                      {passwordError}
                    </p>
                  ) : null}
                </div>

                <Button type="submit" className="w-full">
                  Continue
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-bg px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={oauthLoading}
                variant="outline"
                className="w-full"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {oauthLoading ? "Continuing..." : "Continue with Google"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Step 2: Email Confirmation */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "email-confirmation" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "email-password"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>Confirm your email</CardTitle>
              <CardDescription>
                Please re-enter your email address to confirm
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={emailConfirmationForm.handleSubmit(handleEmailConfirmationSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="confirmEmail" className="block text-sm font-medium">
                    Confirm Email
                  </label>
                  <Input
                    id="confirmEmail"
                    type="email"
                    {...emailConfirmationForm.register("confirmEmail")}
                    aria-invalid={!!confirmEmailError}
                    aria-describedby={confirmEmailError ? "confirmEmail-error" : undefined}
                    className={`${
                      emailConfirmationForm.watch("confirmEmail") && 
                      emailConfirmationForm.watch("confirmEmail") === signupData.email
                        ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                        : emailConfirmationForm.watch("confirmEmail") && 
                          emailConfirmationForm.watch("confirmEmail") !== signupData.email
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : ""
                    }`}
                  />
                  {confirmEmailError ? (
                    <p id="confirmEmail-error" className="text-sm text-destructive mt-1">
                      {confirmEmailError}
                    </p>
                  ) : emailConfirmationForm.watch("confirmEmail") && 
                    emailConfirmationForm.watch("confirmEmail") === signupData.email ? (
                    <p className="text-sm text-green-600 mt-1">✓ Emails match</p>
                  ) : null}
                </div>

                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBack}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button type="submit" className="flex-1">
                    Continue
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Step 3: Password Confirmation */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "password-confirmation" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "email-confirmation"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>Confirm your password</CardTitle>
              <CardDescription>
                Please re-enter your password to confirm
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={passwordConfirmationForm.handleSubmit(handlePasswordConfirmationSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium">
                    Confirm Password
                  </label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    {...passwordConfirmationForm.register("confirmPassword")}
                    aria-invalid={!!confirmPasswordError}
                    aria-describedby={confirmPasswordError ? "confirmPassword-error" : undefined}
                    className={`${
                      passwordConfirmationForm.watch("confirmPassword") && 
                      passwordConfirmationForm.watch("confirmPassword") === signupData.password
                        ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                        : passwordConfirmationForm.watch("confirmPassword") && 
                          passwordConfirmationForm.watch("confirmPassword") !== signupData.password
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : ""
                    }`}
                  />
                  {confirmPasswordError ? (
                    <p id="confirmPassword-error" className="text-sm text-destructive mt-1">
                      {confirmPasswordError}
                    </p>
                  ) : passwordConfirmationForm.watch("confirmPassword") && 
                    passwordConfirmationForm.watch("confirmPassword") === signupData.password ? (
                    <p className="text-sm text-green-600 mt-1">✓ Passwords match</p>
                  ) : null}
                </div>

                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBack}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button type="submit" className="flex-1">
                    Continue
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Step 4: Name */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "name" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "password-confirmation"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>Tell us about yourself</CardTitle>
              <CardDescription>
                We'd love to know your name
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={nameForm.handleSubmit(handleNameSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium">
                      First Name
                    </label>
                    <Input
                      id="firstName"
                      {...nameForm.register("firstName")}
                      aria-invalid={!!firstNameError}
                      aria-describedby={firstNameError ? "firstName-error" : undefined}
                    />
                    {firstNameError ? (
                      <p id="firstName-error" className="text-sm text-destructive mt-1">
                        {firstNameError}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium">
                      Last Name
                    </label>
                    <Input
                      id="lastName"
                      {...nameForm.register("lastName")}
                      aria-invalid={!!lastNameError}
                      aria-describedby={lastNameError ? "lastName-error" : undefined}
                    />
                    {lastNameError ? (
                      <p id="lastName-error" className="text-sm text-destructive mt-1">
                        {lastNameError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={goBack}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? "Creating account..." : "Create account"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Step 5: Confirmation */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "confirmation" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "name"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                We've sent a confirmation link to <strong>{signupData.email}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to verify your account and complete the signup process.
                </p>
                <p className="text-sm text-muted-foreground">
                  You can close this page - we'll redirect you automatically once you click the link.
                </p>
              </div>

              <div className="flex space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={goBack}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="flex-1"
                >
                  Try again
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {serverMessage ? (
        <Alert className="mt-4">
          <AlertDescription>{serverMessage}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}