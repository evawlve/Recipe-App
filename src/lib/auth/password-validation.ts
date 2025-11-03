import zxcvbn from 'zxcvbn';

export interface PasswordStrength {
  score: number; // 0-4 (0 = weak, 4 = very strong)
  feedback: {
    warning: string;
    suggestions: string[];
  };
  isValid: boolean;
  crackTime: string;
}

/**
 * Password requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * - zxcvbn score of at least 2 (fair)
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  minZxcvbnScore: 2, // 0-4 scale, 2 = fair
};

export function validatePassword(password: string, userInputs: string[] = []): PasswordStrength {
  // Use zxcvbn to evaluate password strength
  // userInputs can include email, username, name, etc. to prevent using personal info
  const result = zxcvbn(password, userInputs);

  const checks = {
    minLength: password.length >= PASSWORD_REQUIREMENTS.minLength,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
    goodScore: result.score >= PASSWORD_REQUIREMENTS.minZxcvbnScore,
  };

  const isValid = Object.values(checks).every(check => check);

  // Build custom feedback
  const suggestions: string[] = [];
  if (!checks.minLength) {
    suggestions.push(`Use at least ${PASSWORD_REQUIREMENTS.minLength} characters`);
  }
  if (!checks.hasUppercase) {
    suggestions.push('Include at least one uppercase letter');
  }
  if (!checks.hasLowercase) {
    suggestions.push('Include at least one lowercase letter');
  }
  if (!checks.hasNumber) {
    suggestions.push('Include at least one number');
  }
  if (!checks.hasSpecial) {
    suggestions.push('Include at least one special character (!@#$%^&*...)');
  }
  if (!checks.goodScore && result.feedback.suggestions.length > 0) {
    suggestions.push(...result.feedback.suggestions);
  }

  return {
    score: result.score,
    feedback: {
      warning: result.feedback.warning || '',
      suggestions,
    },
    isValid,
    crackTime: String(result.crack_times_display.offline_slow_hashing_1e4_per_second),
  };
}

export function getPasswordStrengthLabel(score: number): string {
  switch (score) {
    case 0:
      return 'Very Weak';
    case 1:
      return 'Weak';
    case 2:
      return 'Fair';
    case 3:
      return 'Strong';
    case 4:
      return 'Very Strong';
    default:
      return 'Unknown';
  }
}

export function getPasswordStrengthColor(score: number): string {
  switch (score) {
    case 0:
      return 'rgb(239, 68, 68)'; // red-500
    case 1:
      return 'rgb(249, 115, 22)'; // orange-500
    case 2:
      return 'rgb(234, 179, 8)'; // yellow-500
    case 3:
      return 'rgb(34, 197, 94)'; // green-500
    case 4:
      return 'rgb(22, 163, 74)'; // green-600
    default:
      return 'rgb(156, 163, 175)'; // gray-400
  }
}

