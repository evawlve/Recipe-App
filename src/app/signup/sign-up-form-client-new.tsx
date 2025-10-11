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
import { CheckCircle, Mail, User, Camera } from "lucide-react";
import Link from "next/link";
import Logo from "@/components/Logo";
import Image from "next/image";

// Step 1: Name
const nameSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

// Step 2: Email and Email Confirmation
const emailSchema = z.object({
  email: z.string().email("Enter a valid email"),
  confirmEmail: z.string().email("Enter a valid email"),
});

// Step 3: Password and Password Confirmation
const passwordSchema = z.object({
  password: z.string().min(8, "At least 8 characters"),
  confirmPassword: z.string().min(8, "At least 8 characters"),
});

// Step 4: Profile Setup
const profileSchema = z.object({
  username: z.string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(/^[a-z0-9_]+$/, "Username can only contain lowercase letters, numbers, and underscores"),
  bio: z.string().max(500, "Bio must be 500 characters or less").optional(),
});

type NameInput = z.infer<typeof nameSchema>;
type EmailInput = z.infer<typeof emailSchema>;
type PasswordInput = z.infer<typeof passwordSchema>;
type ProfileInput = z.infer<typeof profileSchema>;

type SignupStep = "name" | "email" | "password" | "profile" | "confirmation";

export default function SignUpFormClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/recipes";
  
  const [currentStep, setCurrentStep] = useState<SignupStep>("name");
  const [serverMessage, setServerMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [signupData, setSignupData] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    username: string;
    bio: string;
  }>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    username: "",
    bio: "",
  });

  const nameForm = useForm<NameInput>({
    resolver: zodResolver(nameSchema),
    defaultValues: { firstName: "", lastName: "" },
  });

  const emailForm = useForm<EmailInput>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: "", confirmEmail: "" },
  });

  const passwordForm = useForm<PasswordInput>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const profileForm = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: { username: "", bio: "" },
  });

  async function handleNameSubmit(values: NameInput) {
    setSignupData(prev => ({ ...prev, ...values }));
    setCurrentStep("email");
  }

  async function handleEmailSubmit(values: EmailInput) {
    if (values.confirmEmail !== values.email) {
      emailForm.setError("confirmEmail", {
        type: "manual",
        message: "Emails do not match"
      });
      return;
    }
    setSignupData(prev => ({ ...prev, email: values.email }));
    setCurrentStep("password");
  }

  async function handlePasswordSubmit(values: PasswordInput) {
    if (values.confirmPassword !== values.password) {
      passwordForm.setError("confirmPassword", {
        type: "manual",
        message: "Passwords do not match"
      });
      return;
    }
    setSignupData(prev => ({ ...prev, password: values.password }));
    setCurrentStep("profile");
  }

  // Username validation
  const validateUsername = async (value: string) => {
    if (!value.trim()) {
      setUsernameError(null);
      return;
    }

    // Basic regex validation
    if (!/^[a-z0-9_]+$/.test(value)) {
      setUsernameError('Username can only contain lowercase letters, numbers, and underscores');
      return;
    }

    if (value.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }

    if (value.length > 20) {
      setUsernameError('Username must be at most 20 characters');
      return;
    }

    // Check uniqueness
    setIsCheckingUsername(true);
    try {
      const response = await fetch(`/api/users/search?exact=${encodeURIComponent(value)}`);
      if (response.ok) {
        const users = await response.json();
        if (users.length > 0) {
          setUsernameError('Username is already taken');
        } else {
          setUsernameError(null);
        }
      }
    } catch (error) {
      console.error('Error checking username:', error);
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const handleUsernameChange = (value: string) => {
    const username = value.toLowerCase();
    setSignupData(prev => ({ ...prev, username }));
    setUsernameError(null);
    
    // Debounce validation
    const timeoutId = setTimeout(() => {
      validateUsername(username);
    }, 500);
    
    return () => clearTimeout(timeoutId);
  };

  async function handleProfileSubmit(values: ProfileInput) {
    if (usernameError) return;
    
    // Update signup data with profile values
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
            first_name: updatedSignupData.firstName,
            last_name: updatedSignupData.lastName,
            name: `${updatedSignupData.firstName} ${updatedSignupData.lastName}`,
            username: updatedSignupData.username,
            bio: updatedSignupData.bio,
          },
        },
      });

      if (error) {
        setServerMessage(error.message);
        setCurrentStep("name");
        return;
      }

      setServerMessage("Account created successfully!");
    } catch (error) {
      setServerMessage("An unexpected error occurred. Please try again.");
      setCurrentStep("name");
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
    if (currentStep === "email") {
      setCurrentStep("name");
    } else if (currentStep === "password") {
      setCurrentStep("email");
    } else if (currentStep === "profile") {
      setCurrentStep("password");
    } else if (currentStep === "confirmation") {
      setCurrentStep("profile");
    }
  }

  const firstNameError = nameForm.formState.errors.firstName?.message;
  const lastNameError = nameForm.formState.errors.lastName?.message;
  const emailError = emailForm.formState.errors.email?.message;
  const confirmEmailError = emailForm.formState.errors.confirmEmail?.message;
  const passwordError = passwordForm.formState.errors.password?.message;
  const confirmPasswordError = passwordForm.formState.errors.confirmPassword?.message;
  const usernameFormError = profileForm.formState.errors.username?.message;
  const bioError = profileForm.formState.errors.bio?.message;

  // Check if user has started filling out the form
  const hasFormData = () => {
    return signupData.firstName || 
           signupData.lastName ||
           signupData.email || 
           signupData.password || 
           signupData.username ||
           signupData.bio ||
           nameForm.watch("firstName") ||
           nameForm.watch("lastName") ||
           emailForm.watch("email") ||
           emailForm.watch("confirmEmail") ||
           passwordForm.watch("password") ||
           passwordForm.watch("confirmPassword") ||
           profileForm.watch("username") ||
           profileForm.watch("bio");
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
            currentStep === "name" ? "bg-primary text-primary-foreground" : 
            ["email", "password", "profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <User className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            ["email", "password", "profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "email" ? "bg-primary text-primary-foreground" : 
            ["password", "profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <Mail className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            ["password", "profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "password" ? "bg-primary text-primary-foreground" : 
            ["profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <User className="w-4 h-4" />
          </div>
          <div className={`w-6 h-0.5 ${
            ["profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"
          }`} />
          <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
            currentStep === "profile" ? "bg-primary text-primary-foreground" : 
            currentStep === "confirmation" ? "bg-primary/20 text-primary" : 
            "bg-muted text-muted-foreground"
          }`}>
            <Camera className="w-4 h-4" />
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
        {/* Step 1: Name */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "name" 
            ? "translate-x-0 opacity-100" 
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>What's your name?</CardTitle>
              <CardDescription>
                Tell us your first and last name
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

                <Button type="submit" className="w-full">
                  Continue
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
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

        {/* Step 2: Email */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "email" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "name"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>What's your email?</CardTitle>
              <CardDescription>
                We'll use this to sign you in and send you updates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={emailForm.handleSubmit(handleEmailSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    {...emailForm.register("email")}
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
                  <label htmlFor="confirmEmail" className="block text-sm font-medium">
                    Confirm Email
                  </label>
                  <Input
                    id="confirmEmail"
                    type="email"
                    {...emailForm.register("confirmEmail")}
                    aria-invalid={!!confirmEmailError}
                    aria-describedby={confirmEmailError ? "confirmEmail-error" : undefined}
                    className={`${
                      emailForm.watch("confirmEmail") && 
                      emailForm.watch("confirmEmail") === emailForm.watch("email")
                        ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                        : emailForm.watch("confirmEmail") && 
                          emailForm.watch("confirmEmail") !== emailForm.watch("email")
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : ""
                    }`}
                  />
                  {confirmEmailError ? (
                    <p id="confirmEmail-error" className="text-sm text-destructive mt-1">
                      {confirmEmailError}
                    </p>
                  ) : emailForm.watch("confirmEmail") && 
                    emailForm.watch("confirmEmail") === emailForm.watch("email") ? (
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

        {/* Step 3: Password */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "password" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "email"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>Create a password</CardTitle>
              <CardDescription>
                Choose a strong password to secure your account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="password"
                    type="password"
                    {...passwordForm.register("password")}
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? "password-error" : undefined}
                  />
                  {passwordError ? (
                    <p id="password-error" className="text-sm text-destructive mt-1">
                      {passwordError}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium">
                    Confirm Password
                  </label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    {...passwordForm.register("confirmPassword")}
                    aria-invalid={!!confirmPasswordError}
                    aria-describedby={confirmPasswordError ? "confirmPassword-error" : undefined}
                    className={`${
                      passwordForm.watch("confirmPassword") && 
                      passwordForm.watch("confirmPassword") === passwordForm.watch("password")
                        ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                        : passwordForm.watch("confirmPassword") && 
                          passwordForm.watch("confirmPassword") !== passwordForm.watch("password")
                        ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                        : ""
                    }`}
                  />
                  {confirmPasswordError ? (
                    <p id="confirmPassword-error" className="text-sm text-destructive mt-1">
                      {confirmPasswordError}
                    </p>
                  ) : passwordForm.watch("confirmPassword") && 
                    passwordForm.watch("confirmPassword") === passwordForm.watch("password") ? (
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

        {/* Step 4: Profile Setup */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "profile" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "password"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>Set up your profile</CardTitle>
              <CardDescription>
                Choose your username and tell us about yourself
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={profileForm.handleSubmit(handleProfileSubmit)} className="space-y-4">
                {/* Avatar Section */}
                <div className="flex flex-col items-center space-y-4">
                  <div className="relative group">
                    <div className="rounded-full size-24 bg-muted text-2xl font-semibold grid place-items-center overflow-hidden">
                      <div className="w-full h-full bg-green-100 flex items-center justify-center text-2xl font-bold text-green-600">
                        {signupData.firstName.charAt(0).toUpperCase()}
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <Camera className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Click to change avatar picture
                  </p>
                </div>

                {/* Username */}
                <div>
                  <label htmlFor="username" className="block text-sm font-medium">
                    Username
                  </label>
                  <div className="relative">
                    <Input
                      id="username"
                      value={signupData.username}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                      placeholder="Choose a username"
                      aria-invalid={!!usernameError || !!usernameFormError}
                      aria-describedby={usernameError || usernameFormError ? "username-error" : undefined}
                    />
                    {isCheckingUsername && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                      </div>
                    )}
                  </div>
                  {usernameError ? (
                    <p id="username-error" className="text-sm text-red-600 mt-1">{usernameError}</p>
                  ) : usernameFormError ? (
                    <p id="username-error" className="text-sm text-destructive mt-1">{usernameFormError}</p>
                  ) : signupData.username && !usernameError ? (
                    <p className="text-sm text-green-600 mt-1">@{signupData.username}</p>
                  ) : null}
                </div>

                {/* Bio */}
                <div>
                  <label htmlFor="bio" className="block text-sm font-medium">
                    Bio <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input
                    id="bio"
                    value={signupData.bio}
                    onChange={(e) => setSignupData(prev => ({ ...prev, bio: e.target.value }))}
                    placeholder="Tell us about yourself"
                    aria-invalid={!!bioError}
                    aria-describedby={bioError ? "bio-error" : undefined}
                  />
                  {bioError ? (
                    <p id="bio-error" className="text-sm text-destructive mt-1">
                      {bioError}
                    </p>
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
                  <Button 
                    type="submit" 
                    disabled={loading || usernameError || isCheckingUsername} 
                    className="flex-1"
                  >
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
            : currentStep === "profile"
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
