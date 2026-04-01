/**
 * Navigation utilities
 *
 * Helpers for programmatic navigation actions (form POSTs, etc.)
 */

/**
 * Submit a POST form programmatically.
 * Used for actions like logout where a form POST is needed
 * but no visible <form> element exists.
 */
export function submitFormPost(action: string): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = action;
  document.body.appendChild(form);
  form.submit();
}
