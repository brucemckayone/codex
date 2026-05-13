/**
 * Stripe Connect Requirements — Humanization Map
 *
 * Maps Stripe's dotted field paths (returned in
 * `Account.requirements.currently_due` / `eventually_due` / `past_due`) to
 * short human-readable labels for display in the studio UI.
 *
 * Unknown fields are returned as-is so we still surface SOMETHING actionable
 * — the operator can copy the dotted path into Stripe Dashboard's requirements
 * panel to resolve it. New unknown fields should be added here as they appear
 * in production; the `humanizeRequirement` helper is the single hook the UI
 * calls — never inline these strings in components.
 *
 * Stripe API contract verified via Context7 + installed types (stripe@19.3.1)
 * on 2026-05-13: `Stripe.Account.Requirements.currently_due: Array<string> | null`
 * — see `node_modules/stripe/types/Accounts.d.ts:1228-1268`.
 */
export const REQUIREMENT_HUMANIZATION: Record<string, string> = {
  // ─── Business profile ─────────────────────────────────────────────────────
  'business_profile.url': 'Business website URL',
  'business_profile.mcc': 'Business category code',
  'business_profile.name': 'Business name',
  'business_profile.product_description': 'Product or service description',
  'business_profile.support_address': 'Support address',
  'business_profile.support_email': 'Support email',
  'business_profile.support_phone': 'Support phone number',
  'business_profile.support_url': 'Support website',
  business_type: 'Business type',

  // ─── Company ──────────────────────────────────────────────────────────────
  'company.name': 'Company name',
  'company.tax_id': 'Tax ID / VAT number',
  'company.registration_number': 'Company registration number',
  'company.phone': 'Company phone number',
  'company.address.city': 'Company city',
  'company.address.country': 'Company country',
  'company.address.line1': 'Company street address',
  'company.address.line2': 'Company address (line 2)',
  'company.address.postal_code': 'Company postal code',
  'company.address.state': 'Company state or province',
  'company.directors_provided': 'Confirm all company directors',
  'company.executives_provided': 'Confirm all company executives',
  'company.owners_provided': 'Confirm all beneficial owners',
  'company.verification.document': 'Company verification document',

  // ─── Individual ───────────────────────────────────────────────────────────
  'individual.first_name': 'First name',
  'individual.last_name': 'Last name',
  'individual.email': 'Email address',
  'individual.phone': 'Phone number',
  'individual.dob.day': 'Date of birth (day)',
  'individual.dob.month': 'Date of birth (month)',
  'individual.dob.year': 'Date of birth (year)',
  'individual.ssn_last_4': 'Last 4 digits of SSN',
  'individual.id_number': 'Government ID number',
  'individual.address.city': 'Address city',
  'individual.address.country': 'Address country',
  'individual.address.line1': 'Street address',
  'individual.address.line2': 'Address (line 2)',
  'individual.address.postal_code': 'Postal code',
  'individual.address.state': 'State or province',
  'individual.verification.document': 'Identity verification document',
  'individual.verification.additional_document': 'Additional identity document',

  // ─── External account (bank / card) ───────────────────────────────────────
  external_account: 'Bank account or debit card for payouts',

  // ─── Terms of Service acceptance ──────────────────────────────────────────
  'tos_acceptance.date': 'Terms of Service acceptance date',
  'tos_acceptance.ip': 'IP address for Terms of Service acceptance',
  'tos_acceptance.user_agent': 'User agent for Terms of Service acceptance',
} as const;

/**
 * Humanize a Stripe dotted requirement path.
 *
 * Returns the mapped label if known, otherwise the raw path so the operator
 * still has something they can paste into Stripe Dashboard. Callers may pass
 * the returned path to telemetry to expand the map over time.
 *
 * @param fieldPath - Dotted Stripe requirement key (e.g. 'business_profile.url')
 * @returns Human-readable label, or the raw path if unmapped
 */
export function humanizeRequirement(fieldPath: string): string {
  return REQUIREMENT_HUMANIZATION[fieldPath] ?? fieldPath;
}

/**
 * Type guard: did `humanizeRequirement` find a mapping?
 *
 * Useful for telemetry — log unmapped paths so the map can be expanded.
 */
export function isKnownRequirement(fieldPath: string): boolean {
  return fieldPath in REQUIREMENT_HUMANIZATION;
}
