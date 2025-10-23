"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SignUpFormClient;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const zod_1 = require("zod");
const react_hook_form_1 = require("react-hook-form");
const zod_2 = require("@hookform/resolvers/zod");
const client_1 = require("@/lib/supabase/client");
const input_1 = require("@/components/ui/input");
const button_1 = require("@/components/ui/button");
const alert_1 = require("@/components/ui/alert");
const card_1 = require("@/components/ui/card");
const lucide_react_1 = require("lucide-react");
const link_1 = __importDefault(require("next/link"));
const Logo_1 = __importDefault(require("@/components/Logo"));
const SimpleAvatarUploader_1 = require("@/components/account/SimpleAvatarUploader");
// Step 1: Name
const nameSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(1, "First name is required"),
    lastName: zod_1.z.string().min(1, "Last name is required"),
});
// Step 2: Email and Email Confirmation
const emailSchema = zod_1.z.object({
    email: zod_1.z.string().email("Enter a valid email"),
    confirmEmail: zod_1.z.string().email("Enter a valid email"),
});
// Step 3: Password and Password Confirmation
const passwordSchema = zod_1.z.object({
    password: zod_1.z.string().min(8, "At least 8 characters"),
    confirmPassword: zod_1.z.string().min(8, "At least 8 characters"),
});
// Step 4: Profile Setup
const profileSchema = zod_1.z.object({
    bio: zod_1.z.string().max(500, "Bio must be 500 characters or less").optional(),
});
function SignUpFormClient() {
    const router = (0, navigation_1.useRouter)();
    const searchParams = (0, navigation_1.useSearchParams)();
    const redirectTo = searchParams.get("redirectTo") || "/recipes";
    const isVerified = searchParams.get("verified") === "true";
    const isGoogle = searchParams.get("google") === "true";
    const verifiedEmail = searchParams.get("email");
    // Debug logging (client-side only)
    (0, react_1.useEffect)(() => {
        console.log('=== SIGNUP FORM DEBUG ===');
        console.log('Current URL:', window.location.href);
        console.log('Search params:', Object.fromEntries(searchParams.entries()));
        console.log('isVerified:', isVerified);
        console.log('isGoogle:', isGoogle);
        console.log('verifiedEmail:', verifiedEmail);
        console.log('redirectTo:', redirectTo);
        console.log('==========================');
    }, [searchParams, isVerified, verifiedEmail, redirectTo]);
    const [currentStep, setCurrentStep] = (0, react_1.useState)("name");
    const [serverMessage, setServerMessage] = (0, react_1.useState)("");
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [oauthLoading, setOauthLoading] = (0, react_1.useState)(false);
    const [isGoogleUser, setIsGoogleUser] = (0, react_1.useState)(false);
    const [usernameError, setUsernameError] = (0, react_1.useState)(null);
    const [isCheckingUsername, setIsCheckingUsername] = (0, react_1.useState)(false);
    const [isVerifying, setIsVerifying] = (0, react_1.useState)(false);
    const [avatarUrl, setAvatarUrl] = (0, react_1.useState)(null);
    const [isAuthenticated, setIsAuthenticated] = (0, react_1.useState)(false);
    const [isSignupComplete, setIsSignupComplete] = (0, react_1.useState)(false);
    const [usernameTimeoutRef, setUsernameTimeoutRef] = (0, react_1.useState)(null);
    const [signupData, setSignupData] = (0, react_1.useState)({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        username: "",
        bio: "",
    });
    const nameForm = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_2.zodResolver)(nameSchema),
        defaultValues: { firstName: "", lastName: "" },
    });
    const emailForm = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_2.zodResolver)(emailSchema),
        defaultValues: { email: "", confirmEmail: "" },
    });
    const passwordForm = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_2.zodResolver)(passwordSchema),
        defaultValues: { password: "", confirmPassword: "" },
    });
    const profileForm = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_2.zodResolver)(profileSchema),
        defaultValues: { bio: "" },
    });
    const supabase = (0, client_1.createSupabaseBrowserClient)();
    // Check if user is already authenticated on component mount
    (0, react_1.useEffect)(() => {
        const checkAuth = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    console.log('User is already authenticated:', user.email);
                    setIsAuthenticated(true);
                    // If user is authenticated but doesn't have a username, go to appropriate step
                    if (!user.user_metadata?.username) {
                        // For Google OAuth users, start with name confirmation
                        // For regular users, go directly to profile setup
                        if (isGoogle) {
                            setCurrentStep("name");
                            setIsGoogleUser(true);
                        }
                        else {
                            setCurrentStep("profile");
                        }
                        setSignupData(prev => ({
                            ...prev,
                            firstName: user.user_metadata?.first_name || "",
                            lastName: user.user_metadata?.last_name || "",
                            email: user.email || "",
                        }));
                    }
                    else {
                        // User is fully set up, redirect to app
                        router.push("/recipes?newUser=true");
                    }
                }
                else if (isVerified || isGoogle) {
                    // User is not authenticated but we have verified=true or google=true parameter
                    // This means they need to complete the signup process
                    if (isGoogle) {
                        // Google OAuth user - start with name confirmation
                        setCurrentStep("name");
                        setIsGoogleUser(true);
                        // Pre-populate with Google data if available
                        if (user?.user_metadata) {
                            setSignupData(prev => ({
                                ...prev,
                                firstName: user.user_metadata?.first_name || "",
                                lastName: user.user_metadata?.last_name || "",
                                email: user?.email || "",
                            }));
                        }
                    }
                    else {
                        // Regular email verification - go to profile setup
                        setCurrentStep("profile");
                    }
                }
            }
            catch (error) {
                console.error("Error checking authentication:", error);
            }
        };
        checkAuth();
    }, [supabase, router, isVerified]);
    // Cleanup timeout on unmount
    (0, react_1.useEffect)(() => {
        return () => {
            if (usernameTimeoutRef) {
                clearTimeout(usernameTimeoutRef);
            }
        };
    }, [usernameTimeoutRef]);
    // Poll for email verification
    (0, react_1.useEffect)(() => {
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
                }
                catch (error) {
                    console.error('Error checking verification status:', error);
                }
            }, 2000); // Check every 2 seconds
            return () => clearInterval(interval);
        }
    }, [currentStep]);
    // Load user data when coming from email verification
    (0, react_1.useEffect)(() => {
        if (isVerified) {
            const loadUserData = async () => {
                try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                        setSignupData(prev => ({
                            ...prev,
                            firstName: user.user_metadata?.first_name || "",
                            lastName: user.user_metadata?.last_name || "",
                            email: user.email || verifiedEmail || "",
                        }));
                    }
                }
                catch (error) {
                    console.error('Error loading user data:', error);
                }
            };
            loadUserData();
        }
    }, [isVerified, verifiedEmail]);
    // Prevent navigation away from signup if not complete
    (0, react_1.useEffect)(() => {
        const handleBeforeUnload = (e) => {
            if (!isSignupComplete && (isAuthenticated || isVerified || isGoogle)) {
                e.preventDefault();
                e.returnValue = 'Are you sure you want to leave? Your signup is not complete.';
                return 'Are you sure you want to leave? Your signup is not complete.';
            }
        };
        const handlePopState = (e) => {
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
    async function handleNameSubmit(values) {
        setSignupData(prev => ({ ...prev, ...values }));
        // For Google OAuth users, skip email and password steps
        if (isGoogle) {
            setCurrentStep("profile");
        }
        else {
            setCurrentStep("email");
        }
    }
    async function handleEmailSubmit(values) {
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
    async function handlePasswordSubmit(values) {
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
                        last_name: signupData.lastName,
                        name: `${signupData.firstName} ${signupData.lastName}`,
                    },
                },
            });
            if (error) {
                setServerMessage(error.message);
                return;
            }
            // Move to verification step
            setCurrentStep("verification");
        }
        catch (error) {
            setServerMessage("An unexpected error occurred. Please try again.");
        }
        finally {
            setLoading(false);
        }
    }
    // Username validation
    const validateUsername = async (value) => {
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
                }
                else {
                    setUsernameError(null);
                }
            }
            else {
                setUsernameError('Error checking username availability');
            }
        }
        catch (error) {
            console.error('Error checking username:', error);
            setUsernameError('Error checking username availability');
        }
        finally {
            setIsCheckingUsername(false);
        }
    };
    const handleUsernameChange = (value) => {
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
    async function handleProfileSubmit(values) {
        console.log('=== PROFILE SUBMIT DEBUG ===');
        console.log('Form values:', values);
        console.log('Username from signupData:', signupData.username);
        console.log('Username error:', usernameError);
        console.log('============================');
        if (usernameError)
            return;
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
                    firstName: updatedSignupData.firstName,
                    lastName: updatedSignupData.lastName,
                    name: `${updatedSignupData.firstName} ${updatedSignupData.lastName}`,
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
        }
        catch (error) {
            setServerMessage("An unexpected error occurred. Please try again.");
        }
        finally {
            setLoading(false);
        }
    }
    async function handleGoogleSignIn() {
        setOauthLoading(true);
        setServerMessage("");
        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: `${window.location.origin}/auth/callback?newUser=true`,
                },
            });
            if (error)
                setServerMessage(`Google sign in failed: ${error.message}`);
        }
        finally {
            setOauthLoading(false);
        }
    }
    function goBack() {
        if (currentStep === "email") {
            setCurrentStep("name");
        }
        else if (currentStep === "password") {
            setCurrentStep("email");
        }
        else if (currentStep === "verification") {
            setCurrentStep("password");
        }
        else if (currentStep === "profile") {
            // For Google OAuth users, go back to name step
            // For regular users, go back to verification step
            if (isGoogle) {
                setCurrentStep("name");
            }
            else {
                setCurrentStep("verification");
            }
        }
        else if (currentStep === "confirmation") {
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
    const handleLogoClick = (e) => {
        if (hasFormData()) {
            const confirmed = window.confirm("You've started filling out the signup form. Are you sure you want to leave and go to the home page? Your progress will be lost.");
            if (!confirmed) {
                e.preventDefault();
            }
        }
    };
    return (<div className="w-full max-w-md mx-auto">
      {/* Logo */}
      <div className="flex justify-center mb-4 -mt-8">
        <link_1.default href="/" onClick={handleLogoClick} className="hover:opacity-80 transition-opacity cursor-pointer">
          <Logo_1.default withText size="lg"/>
        </link_1.default>
      </div>
      
      {/* Progress indicator */}
      <div className="flex justify-center mb-6">
        {isGoogleUser ? (
        // Simplified progress for Google OAuth users
        <div className="flex items-center space-x-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "name" ? "bg-primary text-primary-foreground" :
                ["profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.User className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${["profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "profile" ? "bg-primary text-primary-foreground" :
                currentStep === "confirmation" ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.Camera className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${currentStep === "confirmation" ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "confirmation" ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.CheckCircle className="w-4 h-4"/>
            </div>
          </div>) : (
        // Full progress for regular email signup
        <div className="flex items-center space-x-2">
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "name" ? "bg-primary text-primary-foreground" :
                ["email", "password", "verification", "profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.User className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${["email", "password", "verification", "profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "email" ? "bg-primary text-primary-foreground" :
                ["password", "verification", "profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.Mail className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${["password", "verification", "profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "password" ? "bg-primary text-primary-foreground" :
                ["verification", "profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.User className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${["verification", "profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "verification" ? "bg-primary text-primary-foreground" :
                ["profile", "confirmation"].includes(currentStep) ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.CheckCircle className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${["profile", "confirmation"].includes(currentStep) ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "profile" ? "bg-primary text-primary-foreground" :
                currentStep === "confirmation" ? "bg-primary/20 text-primary" :
                    "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.Camera className="w-4 h-4"/>
            </div>
            <div className={`w-6 h-0.5 ${currentStep === "confirmation" ? "bg-primary" : "bg-muted"}`}/>
            <div className={`flex items-center justify-center w-8 h-8 rounded-full ${currentStep === "confirmation" ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"}`}>
              <lucide_react_1.CheckCircle className="w-4 h-4"/>
            </div>
          </div>)}
      </div>

      {/* Show different message for verified users */}
      {isVerified && (<div className="text-center mb-4">
          <div className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-full text-sm font-medium">
            <lucide_react_1.CheckCircle className="w-4 h-4 mr-2"/>
            Email verified! Now let's set up your profile
          </div>
        </div>)}

      <div className="relative overflow-hidden">
        {/* Step 1: Name */}
        <div className={`transition-all duration-500 ease-in-out ${currentStep === "name"
            ? "translate-x-0 opacity-100"
            : "translate-x-full opacity-0 absolute inset-0"}`}>
          <card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>What's your name?</card_1.CardTitle>
              <card_1.CardDescription>
                Tell us your first and last name
              </card_1.CardDescription>
            </card_1.CardHeader>
            <card_1.CardContent className="space-y-4">
              <form onSubmit={nameForm.handleSubmit(handleNameSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="firstName" className="block text-sm font-medium">
                      First Name
                    </label>
                    <input_1.Input id="firstName" {...nameForm.register("firstName")} aria-invalid={!!firstNameError} aria-describedby={firstNameError ? "firstName-error" : undefined}/>
                    {firstNameError ? (<p id="firstName-error" className="text-sm text-destructive mt-1">
                        {firstNameError}
                      </p>) : null}
                  </div>

                  <div>
                    <label htmlFor="lastName" className="block text-sm font-medium">
                      Last Name
                    </label>
                    <input_1.Input id="lastName" {...nameForm.register("lastName")} aria-invalid={!!lastNameError} aria-describedby={lastNameError ? "lastName-error" : undefined}/>
                    {lastNameError ? (<p id="lastName-error" className="text-sm text-destructive mt-1">
                        {lastNameError}
                      </p>) : null}
                  </div>
                </div>

                <button_1.Button type="submit" className="w-full">
                  Continue
                </button_1.Button>
              </form>

              {/* Only show Google OAuth option for non-Google users */}
              {!isGoogleUser && (<>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t"/>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                    </div>
                  </div>

                  <button_1.Button type="button" onClick={handleGoogleSignIn} disabled={oauthLoading} variant="outline" className="w-full">
                    <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {oauthLoading ? "Continuing..." : "Continue with Google"}
                  </button_1.Button>
                </>)}
            </card_1.CardContent>
          </card_1.Card>
        </div>

        {/* Step 2: Email */}
        <div className={`transition-all duration-500 ease-in-out ${currentStep === "email"
            ? "translate-x-0 opacity-100"
            : currentStep === "name"
                ? "-translate-x-full opacity-0 absolute inset-0"
                : "translate-x-full opacity-0 absolute inset-0"}`}>
          <card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>What's your email?</card_1.CardTitle>
              <card_1.CardDescription>
                We'll use this to sign you in and send you updates
              </card_1.CardDescription>
            </card_1.CardHeader>
            <card_1.CardContent className="space-y-4">
              <form onSubmit={emailForm.handleSubmit(handleEmailSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium">
                    Email
                  </label>
                  <input_1.Input id="email" type="email" {...emailForm.register("email")} aria-invalid={!!emailError} aria-describedby={emailError ? "email-error" : undefined}/>
                  {emailError ? (<p id="email-error" className="text-sm text-destructive mt-1">
                      {emailError}
                    </p>) : null}
                </div>

                <div>
                  <label htmlFor="confirmEmail" className="block text-sm font-medium">
                    Confirm Email
                  </label>
                  <input_1.Input id="confirmEmail" type="email" {...emailForm.register("confirmEmail")} aria-invalid={!!confirmEmailError} aria-describedby={confirmEmailError ? "confirmEmail-error" : undefined} className={`${emailForm.watch("confirmEmail") &&
            emailForm.watch("confirmEmail") === emailForm.watch("email")
            ? "border-green-500 focus:border-green-500 focus:ring-green-500"
            : emailForm.watch("confirmEmail") &&
                emailForm.watch("confirmEmail") !== emailForm.watch("email")
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : ""}`}/>
                  {confirmEmailError ? (<p id="confirmEmail-error" className="text-sm text-destructive mt-1">
                      {confirmEmailError}
                    </p>) : emailForm.watch("confirmEmail") &&
            emailForm.watch("confirmEmail") === emailForm.watch("email") ? (<p className="text-sm text-green-600 mt-1">✓ Emails match</p>) : null}
                </div>

                <div className="flex space-x-2">
                  <button_1.Button type="button" variant="outline" onClick={goBack} className="flex-1">
                    Back
                  </button_1.Button>
                  <button_1.Button type="submit" className="flex-1">
                    Continue
                  </button_1.Button>
                </div>
              </form>
            </card_1.CardContent>
          </card_1.Card>
        </div>

        {/* Step 3: Password */}
        <div className={`transition-all duration-500 ease-in-out ${currentStep === "password"
            ? "translate-x-0 opacity-100"
            : currentStep === "email"
                ? "-translate-x-full opacity-0 absolute inset-0"
                : "translate-x-full opacity-0 absolute inset-0"}`}>
          <card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>Create a password</card_1.CardTitle>
              <card_1.CardDescription>
                Choose a strong password to secure your account
              </card_1.CardDescription>
            </card_1.CardHeader>
            <card_1.CardContent className="space-y-4">
              <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="password" className="block text-sm font-medium">
                    Password
                  </label>
                  <input_1.Input id="password" type="password" {...passwordForm.register("password")} aria-invalid={!!passwordError} aria-describedby={passwordError ? "password-error" : undefined}/>
                  {passwordError ? (<p id="password-error" className="text-sm text-destructive mt-1">
                      {passwordError}
                    </p>) : null}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium">
                    Confirm Password
                  </label>
                  <input_1.Input id="confirmPassword" type="password" {...passwordForm.register("confirmPassword")} aria-invalid={!!confirmPasswordError} aria-describedby={confirmPasswordError ? "confirmPassword-error" : undefined} className={`${passwordForm.watch("confirmPassword") &&
            passwordForm.watch("confirmPassword") === passwordForm.watch("password")
            ? "border-green-500 focus:border-green-500 focus:ring-green-500"
            : passwordForm.watch("confirmPassword") &&
                passwordForm.watch("confirmPassword") !== passwordForm.watch("password")
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : ""}`}/>
                  {confirmPasswordError ? (<p id="confirmPassword-error" className="text-sm text-destructive mt-1">
                      {confirmPasswordError}
                    </p>) : passwordForm.watch("confirmPassword") &&
            passwordForm.watch("confirmPassword") === passwordForm.watch("password") ? (<p className="text-sm text-green-600 mt-1">✓ Passwords match</p>) : null}
                </div>

                <div className="flex space-x-2">
                  <button_1.Button type="button" variant="outline" onClick={goBack} className="flex-1">
                    Back
                  </button_1.Button>
                  <button_1.Button type="submit" className="flex-1">
                    Continue
                  </button_1.Button>
                </div>
              </form>
            </card_1.CardContent>
          </card_1.Card>
        </div>

        {/* Step 4: Email Verification */}
        <div className={`transition-all duration-500 ease-in-out ${currentStep === "verification"
            ? "translate-x-0 opacity-100"
            : currentStep === "password"
                ? "-translate-x-full opacity-0 absolute inset-0"
                : "translate-x-full opacity-0 absolute inset-0"}`}>
          <card_1.Card>
            <card_1.CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <lucide_react_1.Mail className="w-8 h-8 text-blue-600"/>
              </div>
              <card_1.CardTitle>Check your email</card_1.CardTitle>
              <card_1.CardDescription>
                We've sent a verification link to <strong>{signupData.email}</strong>
              </card_1.CardDescription>
            </card_1.CardHeader>
            <card_1.CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to verify your account and continue setting up your profile.
                </p>
                <p className="text-sm text-muted-foreground">
                  Once verified, you'll be able to upload an avatar and set your username.
                </p>
                {isVerifying && (<div className="flex items-center justify-center space-x-2 mt-4">
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                    <span className="text-sm text-muted-foreground">Waiting for verification...</span>
                  </div>)}
              </div>

              <div className="flex space-x-2">
                <button_1.Button type="button" variant="outline" onClick={goBack} className="flex-1">
                  Back
                </button_1.Button>
                <button_1.Button type="button" onClick={() => window.location.reload()} className="flex-1">
                  Resend email
                </button_1.Button>
              </div>
            </card_1.CardContent>
          </card_1.Card>
        </div>

        {/* Step 5: Profile Setup */}
        <div className={`transition-all duration-500 ease-in-out ${currentStep === "profile"
            ? "translate-x-0 opacity-100"
            : currentStep === "verification"
                ? "-translate-x-full opacity-0 absolute inset-0"
                : "translate-x-full opacity-0 absolute inset-0"}`}>
          <card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>
                {isVerified ? "Complete your profile" : "Set up your profile"}
              </card_1.CardTitle>
              <card_1.CardDescription>
                {isVerified
            ? "Choose your username and tell us about yourself to finish setting up your account"
            : "Choose your username and tell us about yourself"}
              </card_1.CardDescription>
            </card_1.CardHeader>
            <card_1.CardContent className="space-y-4">
              <form onSubmit={profileForm.handleSubmit(handleProfileSubmit)} className="space-y-4">
                {/* Avatar Section */}
                <SimpleAvatarUploader_1.SimpleAvatarUploader onImageChange={(url) => setAvatarUrl(url)} currentImage={avatarUrl} className="w-full" uploadPath="avatars" maxSize={5 * 1024 * 1024} // 5MB
     acceptedTypes={['image/jpeg', 'image/png', 'image/webp']} initials={signupData.firstName.charAt(0).toUpperCase()}/>

                {/* Username with real-time validation */}
                <div>
                  <label htmlFor="username" className="block text-sm font-medium">
                    Username
                  </label>
                  <div className="relative">
                    <input id="username" type="text" value={signupData.username} onChange={(e) => {
            const value = e.target.value;
            console.log('USERNAME CHANGED:', value);
            setSignupData(prev => ({ ...prev, username: value }));
            validateUsername(value);
        }} placeholder="Choose a username" className="w-full p-2 border rounded pr-10"/>
                    {isCheckingUsername && (<div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                      </div>)}
                  </div>
                  
                  {/* Real-time username feedback */}
                  {signupData.username && (<div className="mt-2">
                      {usernameError ? (<p className="text-sm text-red-600">{usernameError}</p>) : isCheckingUsername ? (<p className="text-sm text-blue-600">Checking availability...</p>) : (<p className="text-sm text-green-600">@{signupData.username}</p>)}
                    </div>)}
                </div>

                {/* Bio */}
                <div>
                  <label htmlFor="bio" className="block text-sm font-medium">
                    Bio <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <input_1.Input id="bio" value={signupData.bio} onChange={(e) => setSignupData(prev => ({ ...prev, bio: e.target.value }))} placeholder="Tell us about yourself" aria-invalid={!!bioError} aria-describedby={bioError ? "bio-error" : undefined}/>
                  {bioError ? (<p id="bio-error" className="text-sm text-destructive mt-1">
                      {bioError}
                    </p>) : null}
                </div>

                <div className="flex space-x-2">
                  <button_1.Button type="button" variant="outline" onClick={goBack} className="flex-1">
                    Back
                  </button_1.Button>
                  <button_1.Button type="submit" disabled={loading || !!usernameError || isCheckingUsername} className="flex-1">
                    {loading
            ? (isVerified ? "Saving profile..." : "Creating account...")
            : (isVerified ? "Complete setup" : "Create account")}
                  </button_1.Button>
                </div>
              </form>
            </card_1.CardContent>
          </card_1.Card>
        </div>

        {/* Step 6: Confirmation */}
        <div className={`transition-all duration-500 ease-in-out ${currentStep === "confirmation"
            ? "translate-x-0 opacity-100"
            : currentStep === "profile"
                ? "-translate-x-full opacity-0 absolute inset-0"
                : "translate-x-full opacity-0 absolute inset-0"}`}>
          <card_1.Card>
            <card_1.CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <lucide_react_1.CheckCircle className="w-8 h-8 text-green-600"/>
              </div>
              <card_1.CardTitle>Check your email</card_1.CardTitle>
              <card_1.CardDescription>
                We've sent a confirmation link to <strong>{signupData.email}</strong>
              </card_1.CardDescription>
            </card_1.CardHeader>
            <card_1.CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  Click the link in your email to verify your account and complete the signup process.
                </p>
                <p className="text-sm text-muted-foreground">
                  You can close this page - we'll redirect you automatically once you click the link.
                </p>
              </div>

              <div className="flex space-x-2">
                <button_1.Button type="button" variant="outline" onClick={goBack} className="flex-1">
                  Back
                </button_1.Button>
                <button_1.Button type="button" onClick={() => window.location.reload()} className="flex-1">
                  Try again
                </button_1.Button>
              </div>
            </card_1.CardContent>
          </card_1.Card>
        </div>
      </div>

      {serverMessage ? (<alert_1.Alert className="mt-4">
          <alert_1.AlertDescription>{serverMessage}</alert_1.AlertDescription>
        </alert_1.Alert>) : null}
    </div>);
}
