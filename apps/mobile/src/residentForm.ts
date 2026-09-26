/** Checks for the resident sign-up form (residentLogin.tsx; tests/public-map.test.ts). */

/** Why a new-account form cannot be sent yet, or null. */
export function registrationProblem(f: { name: string; email: string; phone: string; password: string; confirm: string }): string | null {
  if (f.name.trim().length < 2) return 'Enter your name.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return 'Enter a valid email address.';
  if (f.phone.trim() && !/^\+?[0-9 ]{10,16}$/.test(f.phone.trim())) return 'Enter the phone number with country code, e.g. +91 98765 43210.';
  if (f.password.length < 8) return 'Use at least 8 characters for the password.';
  if (f.password !== f.confirm) return 'The two passwords do not match.';
  return null;
}

/** +91 is assumed for a 10-digit Indian mobile number typed without a country code. */
export const canonicalPhone = (raw: string): string | undefined => {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (!digits) return undefined;
  return digits.startsWith('+') ? digits : digits.length === 10 ? `+91${digits}` : `+${digits}`;
};
