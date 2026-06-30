import CryptoJS from "crypto-js";

// Salt for additional security (should be unique per application)
const SALT = "kandora-portal-2025";

export class PasswordHasher {
  /**
   * Hash a password with SHA-256 and application salt
   */
  static hashPassword(password: string): string {
    // Combine password with salt and hash with SHA-256
    const combined = password + SALT;
    return CryptoJS.SHA256(combined).toString(CryptoJS.enc.Hex);
  }

  /**
   * Validate password strength
   */
  static validatePassword(password: string): {
    valid: boolean;
    message?: string;
  } {
    if (password.length < 6) {
      return {
        valid: false,
        message: "Password must be at least 6 characters long",
      };
    }

    if (password.length > 100) {
      return {
        valid: false,
        message: "Password must be less than 100 characters long",
      };
    }

    // Optional: Add more validation rules (uppercase, numbers, special chars)
    return { valid: true };
  }
}
