"use client";

import { useState, useEffect } from "react";
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
import { AvatarEditor } from "@/components/account/AvatarEditor";

// Step 1: Name
const nameSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(), // Last name is optional
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
  bio: z.string().max(500, "Bio must be 500 characters or less").optional(),
});

type NameInput = z.infer<typeof nameSchema>;
type EmailInput = z.infer<typeof emailSchema>;
type PasswordInput = z.infer<typeof passwordSchema>;
type ProfileInput = z.infer<typeof profileSchema>;

type SignupStep = "name" | "email" | "password" | "verification" | "profile" | "confirmation";

export default function SignUpFormClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") || "/recipes";
  const isVerified = searchParams.get("verified") === "true";
  const isGoogle = searchParams.get("google") === "true";
  const verifiedEmail = searchParams.get("email");
  
  // Initialize isGoogleUser from URL parameter immediately (must be before useEffect that uses it)
  const [isGoogleUser, setIsGoogleUser] = useState(isGoogle);
  // Add a flag to track if we've determined the flow type (prevents flash of wrong flow)
  const [flowDetermined, setFlowDetermined] = useState(!!isGoogle || !!isVerified);
  const [currentStep, setCurrentStep] = useState<SignupStep>("name");
  const [serverMessage, setServerMessage] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  
  // Debug logging (client-side only)
  useEffect(() => {
    console.log('=== SIGNUP FORM DEBUG ===');
    console.log('Current URL:', window.location.href);
      console.log('Search params:', Object.fromEntries(searchParams.entries()));
      console.log('isVerified:', isVerified);
      console.log('isGoogle (URL param):', isGoogle);
      console.log('isGoogleUser (state):', isGoogleUser);
      console.log('currentStep:', currentStep);
      console.log('verifiedEmail:', verifiedEmail);
      console.log('redirectTo:', redirectTo);
    console.log('==========================');
  }, [searchParams, isVerified, isGoogle, isGoogleUser, currentStep, verifiedEmail, redirectTo]);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSignupComplete, setIsSignupComplete] = useState(false);
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState<string | null>(null);
  const [usernameTimeoutRef, setUsernameTimeoutRef] = useState<NodeJS.Timeout | null>(null);
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
    defaultValues: { bio: "" },
  });

  const supabase = createSupabaseBrowserClient();

  // Sync form fields when signupData changes and we're on the name step for Google users
  // This must be after all state and form declarations
  useEffect(() => {
    const isGoogleOAuthUser = isGoogleUser || isGoogle;
    if (isGoogleOAuthUser && currentStep === "name" && signupData.firstName) {
      // Use setTimeout to ensure DOM is ready
      const timeoutId = setTimeout(() => {
        try {
          nameForm.reset({
            firstName: signupData.firstName,
            lastName: signupData.lastName || "", // Use empty string if lastName is null/undefined
          });
        } catch (error) {
          // Form might not be mounted yet, ignore error
          console.log('Form reset skipped:', error);
        }
      }, 150);
      
      return () => clearTimeout(timeoutId);
    }
  }, [currentStep, isGoogleUser, isGoogle, signupData.firstName, signupData.lastName]); // Don't include nameForm in deps

  // Check if user is already authenticated on component mount - only run once
  useEffect(() => {
    let isMounted = true;
    const checkAuth = async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        
        // Log full user object for debugging
        console.log('=== FULL USER OBJECT DEBUG ===');
        console.log('User:', user);
        console.log('User email:', user?.email);
        console.log('User metadata:', (user as any)?.user_metadata);
        console.log('User app_metadata:', (user as any)?.app_metadata);
        console.log('User identities:', (user as any)?.identities);
        console.log('User error:', userError);
        console.log('=============================');
        
        if (user && isMounted) {
          console.log('User is already authenticated:', user.email);
          setIsAuthenticated(true);
          
          // Check if user has completed profile setup by fetching from database
          try {
            const response = await fetch('/api/whoami');
            if (response.ok && isMounted) {
              const dbUser = await response.json();
              
              console.log('=== DATABASE USER DEBUG ===');
              console.log('DB User:', dbUser);
              console.log('===========================');
              
              // If user has username, they're fully set up
              if (dbUser.username) {
                router.push("/recipes?newUser=true");
                return;
              }
              
              // User needs to complete profile setup
              const firstName = dbUser.firstName || (user as any).user_metadata?.first_name || "";
              const lastName = dbUser.lastName || (user as any).user_metadata?.last_name || "";
              const email = user.email || "";
              
              // Check if user signed up with Google OAuth by checking multiple sources
              // 1. URL parameter (google=true) - most reliable if present
              // 2. Supabase identities array - VERY reliable (check for Google identity)
              // 3. app_metadata.provider - sometimes not set correctly
              // 4. Check if user has first_name/last_name in metadata (Google OAuth always provides this)
              const hasGoogleIdentity = (user as any).identities?.some((identity: any) => identity.provider === 'google');
              const isGoogleProvider = (user as any).app_metadata?.provider === 'google';
              const hasGoogleMetadata = !!(user as any).user_metadata?.first_name || (user as any).user_metadata?.last_name;
              // If user has Google metadata (first_name/last_name) and is verified, likely Google OAuth
              const isGoogleOAuthUser = isGoogle || hasGoogleIdentity || isGoogleProvider || (hasGoogleMetadata && isVerified);
              
              console.log('=== SIGNUP FORM AUTH CHECK ===');
              console.log('isGoogle (URL param):', isGoogle);
              console.log('isVerified:', isVerified);
              console.log('hasGoogleIdentity:', hasGoogleIdentity);
              console.log('isGoogleProvider:', isGoogleProvider);
              console.log('hasGoogleMetadata (first_name/last_name):', hasGoogleMetadata);
              console.log('isGoogleOAuthUser (final):', isGoogleOAuthUser);
              console.log('Identities:', (user as any).identities);
              console.log('User metadata keys:', Object.keys((user as any)?.user_metadata || {}));
              console.log('App metadata keys:', Object.keys((user as any)?.app_metadata || {}));
              console.log('============================');
              
              // For Google OAuth users, ALWAYS start with name confirmation step (even if they have firstName/lastName)
              // This allows them to confirm/edit their name before setting username
              // For regular users, go directly to profile setup
              if (isGoogleOAuthUser) {
                setCurrentStep("name");
                setIsGoogleUser(true);
                
                // Always populate form fields with data from database or metadata
                setSignupData(prev => ({
                  ...prev,
                  firstName: firstName,
                  lastName: lastName,
                  email: email,
                }));
              } else {
                setCurrentStep("profile");
                setSignupData(prev => ({
                  ...prev,
                  firstName: firstName,
                  lastName: lastName,
                  email: email,
                }));
              }
            }
          } catch (dbError) {
            console.error('Error fetching user from database:', dbError);
            // Fallback to metadata if database fetch fails
            if (isMounted && !(user as any).user_metadata?.username) {
              const firstName = (user as any).user_metadata?.first_name || "";
              const lastName = (user as any).user_metadata?.last_name || "";
              const email = user.email || "";
              
              // Check if user signed up with Google OAuth by checking multiple sources
              const hasGoogleIdentity = (user as any).identities?.some((identity: any) => identity.provider === 'google');
              const isGoogleProvider = (user as any).app_metadata?.provider === 'google';
              const isGoogleOAuthUser = isGoogle || hasGoogleIdentity || isGoogleProvider;
              
              // For Google OAuth users, ALWAYS start with name confirmation step
              if (isGoogleOAuthUser) {
                setCurrentStep("name");
                setIsGoogleUser(true);
                setSignupData(prev => ({
                  ...prev,
                  firstName: firstName,
                  lastName: lastName,
                  email: email,
                }));
              } else {
                setCurrentStep("profile");
                setSignupData(prev => ({
                  ...prev,
                  firstName: firstName,
                  lastName: lastName,
                  email: email,
                }));
              }
            }
          }
        } else if (isMounted && (isVerified || isGoogle)) {
          // User is not authenticated but we have verified=true or google=true parameter
          // This means they need to complete the signup process
          // Try to get user data from Supabase session and database
          try {
            const { data: { user: sessionUser } } = await supabase.auth.getUser();
            if (sessionUser && isMounted) {
              // Try to fetch from database first
              try {
                const response = await fetch('/api/whoami');
                if (response.ok && isMounted) {
                  const dbUser = await response.json();
                  const firstName = dbUser.firstName || (sessionUser as any).user_metadata?.first_name || "";
                  const lastName = dbUser.lastName || (sessionUser as any).user_metadata?.last_name || "";
                  const email = sessionUser.email || "";
                  
                  // Check if user signed up with Google OAuth by checking multiple sources
                  const hasGoogleIdentity = (sessionUser as any).identities?.some((identity: any) => identity.provider === 'google');
                  const isGoogleProvider = (sessionUser as any).app_metadata?.provider === 'google';
                  const isGoogleOAuthUser = isGoogle || hasGoogleIdentity || isGoogleProvider;
                  
                  if (isGoogleOAuthUser) {
                    // Google OAuth user - ALWAYS start with name confirmation
                    setCurrentStep("name");
                    setIsGoogleUser(true);
                    setSignupData(prev => ({
                      ...prev,
                      firstName: firstName,
                      lastName: lastName,
                      email: email,
                    }));
                  } else {
                    // Regular email verification - go to profile setup
                    setCurrentStep("profile");
                    setSignupData(prev => ({
                      ...prev,
                      firstName: firstName,
                      lastName: lastName,
                      email: email,
                    }));
                  }
                }
              } catch (dbError) {
                // Fallback to metadata
                if (isMounted) {
                  const firstName = (sessionUser as any).user_metadata?.first_name || "";
                  const lastName = (sessionUser as any).user_metadata?.last_name || "";
                  const email = sessionUser.email || "";
                  
                  // Check if user signed up with Google OAuth by checking multiple sources
                  const hasGoogleIdentity = (sessionUser as any).identities?.some((identity: any) => identity.provider === 'google');
                  const isGoogleProvider = (sessionUser as any).app_metadata?.provider === 'google';
                  const isGoogleOAuthUser = isGoogle || hasGoogleIdentity || isGoogleProvider;
                  
                  if (isGoogleOAuthUser) {
                    setCurrentStep("name");
                    setIsGoogleUser(true);
                    setSignupData(prev => ({
                      ...prev,
                      firstName: firstName,
                      lastName: lastName,
                      email: email,
                    }));
                  } else {
                    setCurrentStep("profile");
                  }
                }
              }
            } else if (isMounted) {
              // If we can't get session, default behavior
              if (isGoogle) {
                setCurrentStep("name");
                setIsGoogleUser(true);
              } else {
                setCurrentStep("profile");
              }
            }
          } catch (sessionError) {
            // If we can't get session, default behavior
            if (isMounted) {
              if (isGoogle) {
                setCurrentStep("name");
                setIsGoogleUser(true);
              } else {
                setCurrentStep("profile");
              }
            }
          }
        }
      } catch (error) {
        console.error("Error checking authentication:", error);
      } finally {
        // Mark flow as determined after auth check completes
        if (isMounted) {
          setFlowDetermined(true);
        }
      }
    };

    // If we already have Google or verified in URL, we know the flow immediately
    if (isGoogle || isVerified) {
      setFlowDetermined(true);
    } else {
      // Otherwise, check auth to determine flow
      checkAuth();
    }
    
    return () => {
      isMounted = false;
    };
  }, [supabase, router, isVerified, isGoogle]); // Removed nameForm from dependencies

  // Guard: If Google user is on email/password/verification steps, redirect to profile
  useEffect(() => {
    const isGoogleOAuthUser = isGoogleUser || isGoogle;
    if (isGoogleOAuthUser && (currentStep === "email" || currentStep === "password" || currentStep === "verification")) {
      console.log('Google user detected on wrong step, redirecting to profile');
      setCurrentStep("profile");
    }
  }, [currentStep, isGoogleUser, isGoogle]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (usernameTimeoutRef) {
        clearTimeout(usernameTimeoutRef);
      }
    };
  }, [usernameTimeoutRef]);

  // Poll for email verification
  useEffect(() => {
    if (currentStep === "verification") {
      setIsVerifying(true);
      const interval = setInterval(async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user && user.email_confirmed_at) {
            clearInterval(interval);
            setIsVerifying(false);
            setCurrentStep("profile");
          }
        } catch (error) {
          console.error('Error checking verification status:', error);
        }
      }, 2000); // Check every 2 seconds

      return () => clearInterval(interval);
    }
  }, [currentStep]);

  // Load user data when coming from email verification - simplified to avoid conflicts
  // This is now handled by the main checkAuth useEffect above

  // Prevent navigation away from signup if not complete
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isSignupComplete && (isAuthenticated || isVerified || isGoogle)) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to leave? Your signup is not complete.';
        return 'Are you sure you want to leave? Your signup is not complete.';
      }
    };

    const handlePopState = (e: PopStateEvent) => {
      if (!isSignupComplete && (isAuthenticated || isVerified || isGoogle)) {
        e.preventDefault();
        // Push the current state back to prevent navigation
        window.history.pushState(null, '', window.location.href);
        alert('Please complete your signup before navigating away.');
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('popstate', handlePopState);

    // Push initial state to prevent back navigation
    if (!isSignupComplete && (isAuthenticated || isVerified || isGoogle)) {
      window.history.pushState(null, '', window.location.href);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isSignupComplete, isAuthenticated, isVerified, isGoogle]);

  async function handleNameSubmit(values: NameInput) {
    setSignupData(prev => ({ ...prev, ...values }));
    
    // For Google OAuth users, skip email and password steps
    // Check both isGoogleUser (from provider metadata) and isGoogle (from URL parameter)
    if (isGoogleUser || isGoogle) {
      console.log('Google user detected, skipping to profile step');
      setCurrentStep("profile");
    } else {
      console.log('Regular user, going to email step');
      setCurrentStep("email");
    }
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
    
    // Now create the account and send verification email
    setLoading(true);
    setServerMessage("");
    
    try {
      const { error } = await supabase.auth.signUp({
        email: signupData.email,
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?newUser=true`,
          data: {
            first_name: signupData.firstName,
            last_name: signupData.lastName || null,
            name: signupData.lastName 
              ? `${signupData.firstName} ${signupData.lastName}`
              : signupData.firstName,
          },
        },
      });

      if (error) {
        setServerMessage(error.message);
        return;
      }

      // Move to verification step
      setCurrentStep("verification");
    } catch (error) {
      setServerMessage("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Username validation
  const validateUsername = async (value: string) => {
    console.log('=== VALIDATE USERNAME DEBUG ===');
    console.log('Validating username:', value);
    console.log('Username length:', value.length);
    console.log('Username trimmed:', value.trim());
    console.log('===============================');
    
    if (!value.trim()) {
      setUsernameError(null);
      return;
    }

    // Basic regex validation
    if (!/^[a-z0-9_]+$/.test(value)) {
      console.log('Username failed regex validation');
      setUsernameError('Username can only contain lowercase letters, numbers, and underscores');
      return;
    }

    if (value.length < 3) {
      console.log('Username too short:', value.length);
      setUsernameError('Username must be at least 3 characters');
      return;
    }

    if (value.length > 20) {
      console.log('Username too long:', value.length);
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
      } else {
        setUsernameError('Error checking username availability');
      }
    } catch (error) {
      console.error('Error checking username:', error);
      setUsernameError('Error checking username availability');
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const handleUsernameChange = (value: string) => {
    const username = value.toLowerCase();
    
    // Force console output
    console.log('=== USERNAME CHANGE DEBUG ===');
    console.log('Input value:', value);
    console.log('Processed username:', username);
    console.log('Username length:', username.length);
    console.log('Current usernameError:', usernameError);
    console.log('============================');
    
    // Also show alert for debugging
    if (value === 'diegazo') {
      alert('Username change detected: ' + value + ' (length: ' + value.length + ')');
    }
    
    setSignupData(prev => ({ ...prev, username }));
    
    // Clear previous error immediately
    setUsernameError(null);
    
    // Clear existing timeout
    if (usernameTimeoutRef) {
      clearTimeout(usernameTimeoutRef);
    }
    
    // Set new timeout for validation
    const timeoutId = setTimeout(() => {
      validateUsername(username);
    }, 500);
    
    setUsernameTimeoutRef(timeoutId);
  };

  async function handleProfileSubmit(values: ProfileInput) {
    console.log('=== PROFILE SUBMIT DEBUG ===');
    console.log('Form values:', values);
    console.log('Username from signupData:', signupData.username);
    console.log('Username error:', usernameError);
    console.log('============================');
    
    if (usernameError) return;
    
    // Validate username before submission
    if (!signupData.username || signupData.username.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }
    
    if (!/^[a-z0-9_]+$/.test(signupData.username)) {
      setUsernameError('Username can only contain lowercase letters, numbers, and underscores');
      return;
    }
    
    if (signupData.username.length > 20) {
      setUsernameError('Username must be at most 20 characters');
      return;
    }
    
    // Validate firstName is provided and non-empty
    if (!signupData.firstName || signupData.firstName.trim().length === 0) {
      setServerMessage('First name is required');
      return;
    }
    
    // Update signup data with profile values
    const updatedSignupData = { ...signupData, ...values };
    setSignupData(updatedSignupData);
    
    // Update the user's profile in the database
    setLoading(true);
    setServerMessage("");
    
    try {
      const response = await fetch('/api/account', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: updatedSignupData.firstName.trim(), // Required, must be non-empty
          lastName: updatedSignupData.lastName?.trim() || null, // Optional, can be null
          name: updatedSignupData.lastName?.trim()
            ? `${updatedSignupData.firstName.trim()} ${updatedSignupData.lastName.trim()}`
            : updatedSignupData.firstName.trim(), // Use only firstName if lastName is empty
          username: updatedSignupData.username,
          bio: updatedSignupData.bio,
          ...(avatarUrl && { avatarUrl: avatarUrl }), // Only include avatarUrl if it exists
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setServerMessage(errorData.error || 'Failed to update profile');
        return;
      }

      // If coming from email verification or user is already authenticated, redirect to app
      if (isVerified || isAuthenticated) {
        // Mark signup as complete before redirecting
        setIsSignupComplete(true);
        // For verified users, always redirect to /recipes (the main app page)
        router.push(`/recipes?newUser=true&welcome=true&message=${encodeURIComponent('Profile setup complete! Welcome to Recipe App!')}`);
        return;
      }

      setCurrentStep("confirmation");
    } catch (error) {
      setServerMessage("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setOauthLoading(true);
    setServerMessage("");
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      // Always include google=true and newUser=true in the callback URL to identify Google OAuth flow
      // This ensures the callback route knows it's a Google OAuth signup, even for existing users
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { 
          redirectTo: origin ? `${origin}/auth/callback?google=true&newUser=true&redirectTo=${encodeURIComponent(redirectTo)}` : undefined,
          queryParams: {
            prompt: 'select_account', // Force account selection
            access_type: 'offline',
          },
        },
      });
      if (error) setServerMessage(`Google sign in failed: ${error.message}`);
    } finally {
      setOauthLoading(false);
    }
  }

  function goBack() {
    // Check if user is Google OAuth user (from state or URL parameter)
    const isGoogleOAuthUser = isGoogleUser || isGoogle;
    
    if (currentStep === "email") {
      setCurrentStep("name");
    } else if (currentStep === "password") {
      setCurrentStep("email");
    } else if (currentStep === "verification") {
      setCurrentStep("password");
    } else if (currentStep === "profile") {
      // For Google OAuth users, go back to name step
      // For regular users, go back to verification step
      if (isGoogleOAuthUser) {
        setCurrentStep("name");
      } else {
        setCurrentStep("verification");
      }
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
  // Removed usernameFormError - using only custom validation
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
      <div className="flex justify-center -mb-16">
        <Link 
          href="/" 
          onClick={handleLogoClick}
          className="hover:opacity-80 transition-opacity cursor-pointer"
        >
          <Logo withText size="xl" />
        </Link>
      </div>
      
      {/* Progress indicator */}
      <div className="flex justify-center mb-6">
        {(isGoogleUser || isGoogle) ? (
          // Simplified progress for Google OAuth users: name → profile → confirmation
          (() => {
            const steps = ["name", "profile", "confirmation"] as const;
            type GoogleStep = typeof steps[number];
            // For Google OAuth users, currentStep should only be one of the Google steps
            // If somehow it's not (e.g., "verification"), default to "name"
            const googleStep: GoogleStep = (steps.includes(currentStep as GoogleStep) ? currentStep : "name") as GoogleStep;
            const currentIndex = steps.indexOf(googleStep);
            
            return (
              <div className="flex items-center space-x-2">
                {steps.map((step, index) => {
                  const isCurrent = googleStep === step;
                  const isCompleted = currentIndex > index;
                  const isUpcoming = currentIndex < index;
                  // Line after this step should be green if we've completed this step
                  const lineAfterIsCompleted = isCompleted;
                  
                  return (
                    <div key={step} className="flex items-center">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                        isCurrent 
                          ? "bg-amber-500 text-white ring-2 ring-amber-600 ring-offset-2" 
                          : isCompleted
                          ? "bg-green-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {step === "name" && <User className="w-4 h-4" />}
                        {step === "profile" && <Camera className="w-4 h-4" />}
                        {step === "confirmation" && <CheckCircle className="w-4 h-4" />}
                      </div>
                      {index < steps.length - 1 && (
                        <div className={`w-6 h-0.5 transition-colors ${
                          lineAfterIsCompleted
                            ? "bg-green-500"
                            : "bg-muted"
                        }`} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()
        ) : (
          // Full progress for regular email signup: name → email → password → verification → profile → confirmation
          (() => {
            const steps = ["name", "email", "password", "verification", "profile", "confirmation"] as const;
            const currentIndex = steps.indexOf(currentStep);
            
            return (
              <div className="flex items-center space-x-2">
                {steps.map((step, index) => {
                  const isCurrent = currentStep === step;
                  const isCompleted = currentIndex > index;
                  const isUpcoming = currentIndex < index;
                  // Line after this step should be green if we've completed this step
                  const lineAfterIsCompleted = isCompleted;
                  
                  return (
                    <div key={step} className="flex items-center">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                        isCurrent 
                          ? "bg-amber-500 text-white ring-2 ring-amber-600 ring-offset-2" 
                          : isCompleted
                          ? "bg-green-500 text-white"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {step === "name" && <User className="w-4 h-4" />}
                        {step === "email" && <Mail className="w-4 h-4" />}
                        {step === "password" && <User className="w-4 h-4" />}
                        {step === "verification" && <CheckCircle className="w-4 h-4" />}
                        {step === "profile" && <Camera className="w-4 h-4" />}
                        {step === "confirmation" && <CheckCircle className="w-4 h-4" />}
                      </div>
                      {index < steps.length - 1 && (
                        <div className={`w-6 h-0.5 transition-colors ${
                          lineAfterIsCompleted
                            ? "bg-green-500"
                            : "bg-muted"
                        }`} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>

      {/* Show different message for verified users */}
      {isVerified && (
        <div className="text-center mb-4">
          <div className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            <CheckCircle className="w-4 h-4 mr-2" />
            Email verified! Now let's set up your profile
          </div>
        </div>
      )}

      <div className="relative overflow-hidden">
        {/* Step 1: Name */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "name" 
            ? "translate-x-0 opacity-100" 
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>
                {(isGoogleUser || isGoogle) ? "Confirm your name" : "What's your name?"}
              </CardTitle>
              <CardDescription>
                {(isGoogleUser || isGoogle)
                  ? "We've pre-filled your name from Google. You can edit it if needed, then continue to set up your profile."
                  : "Tell us your name (last name is optional)"
                }
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
                      Last Name <span className="text-muted-foreground">(optional)</span>
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

              {/* Only show Google OAuth option for non-Google users */}
              {!(isGoogleUser || isGoogle) && (
                <>
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
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Step 2: Email - Only show for non-Google users */}
        {!isGoogle && (
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
        )}

        {/* Step 3: Password - Only show for non-Google users */}
        {!isGoogle && (
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
        )}

        {/* Step 4: Email Verification - Only show for non-Google users */}
        {!isGoogle && (
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "verification" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "password"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <Mail className="w-8 h-8 text-blue-600" />
              </div>
              <CardTitle>Check your email</CardTitle>
              <CardDescription>
                We've sent a verification link to <strong>{signupData.email}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to verify your account and continue setting up your profile.
                </p>
                <p className="text-sm text-muted-foreground">
                  Once verified, you'll be able to upload an avatar and set your username.
                </p>
                {isVerifying && (
                  <div className="flex items-center justify-center space-x-2 mt-4">
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                    <span className="text-sm text-muted-foreground">Waiting for verification...</span>
                  </div>
                )}
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
                  Resend email
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Step 5: Profile Setup */}
        <div className={`transition-all duration-500 ease-in-out ${
          currentStep === "profile" 
            ? "translate-x-0 opacity-100" 
            : currentStep === "verification"
            ? "-translate-x-full opacity-0 absolute inset-0"
            : "translate-x-full opacity-0 absolute inset-0"
        }`}>
          <Card>
            <CardHeader>
              <CardTitle>
                {isVerified ? "Complete your profile" : "Set up your profile"}
              </CardTitle>
              <CardDescription>
                {isVerified 
                  ? "Choose your username and tell us about yourself to finish setting up your account"
                  : "Choose your username and tell us about yourself"
                }
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={profileForm.handleSubmit(handleProfileSubmit)} className="space-y-4">
                {/* Avatar Section */}
                <AvatarEditor
                  onImageChange={(url) => setAvatarUrl(url)}
                  currentImage={avatarUrl}
                  className="w-full"
                  uploadPath="avatars"
                  maxSize={5 * 1024 * 1024} // 5MB
                  acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
                  initials={signupData.firstName ? signupData.firstName.charAt(0).toUpperCase() : 'U'}
                  isGoogleAvatar={(isGoogleUser || isGoogle) && !!googleAvatarUrl}
                />

                {/* Username with real-time validation */}
                <div>
                  <label htmlFor="username" className="block text-sm font-medium">
                    Username
                  </label>
                  <div className="relative">
                    <input
                      id="username"
                      type="text"
                      value={signupData.username}
                      onChange={(e) => {
                        const value = e.target.value.toLowerCase();
                        console.log('USERNAME CHANGED:', value);
                        setSignupData(prev => ({ ...prev, username: value }));
                        validateUsername(value);
                      }}
                      placeholder="Choose a username"
                      className="w-full p-2 border rounded pr-10"
                    />
                    {isCheckingUsername && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                      </div>
                    )}
                  </div>
                  
                  {/* Real-time username feedback */}
                  {signupData.username && (
                    <div className="mt-2">
                      {usernameError ? (
                        <p className="text-sm text-red-600">{usernameError}</p>
                      ) : isCheckingUsername ? (
                        <p className="text-sm text-blue-600">Checking availability...</p>
                      ) : (
                        <p className="text-sm text-green-600">@{signupData.username}</p>
                      )}
                    </div>
                  )}
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
                    disabled={loading || !!usernameError || isCheckingUsername} 
                    className="flex-1"
                  >
                    {loading 
                      ? (isVerified ? "Saving profile..." : "Creating account...") 
                      : (isVerified ? "Complete setup" : "Create account")
                    }
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Step 6: Confirmation */}
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
