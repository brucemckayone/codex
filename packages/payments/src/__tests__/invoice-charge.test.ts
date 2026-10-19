/**
 * The shared invoice → charge resolver (Codex-2hxff.50). One case per step of
 * the chain. The first is the shape Stripe sends for a card-paid invoice
 * (sandbox invoice in_1USC217wyGmo4sh63iTqUPkW, 2026-10-19), which the course
 * path used to resolve to null.
 */

import { createMockStripe, createMockStripeInvoice } from '@codex/test-utils';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { resolveInvoiceCharge } from '../invoice-charge';

function invoiceWith(payment: Record<string, unknown> | null): Stripe.Invoice {
  return createMockStripeInvoice({
    id: 'in_resolver',
    payments: { data: payment ? [{ payment }] : [] },
  }) as unknown as Stripe.Invoice;
}

describe('resolveInvoiceCharge', () => {
  it('a card-paid payment names only the PaymentIntent: the charge is its latest_charge', async () => {
    const stripe = createMockStripe();
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: 'pi_card',
      latest_charge: 'ch_card',
    } as never);

    const charge = await resolveInvoiceCharge(
      stripe,
      invoiceWith({ type: 'payment_intent', payment_intent: 'pi_card' })
    );

    expect(charge).toBe('ch_card');
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_card');
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
  });

  it('a payment that names its charge: returned without asking Stripe', async () => {
    const stripe = createMockStripe();

    const charge = await resolveInvoiceCharge(
      stripe,
      invoiceWith({ type: 'charge', charge: 'ch_direct' })
    );

    expect(charge).toBe('ch_direct');
    expect(stripe.invoices.retrieve).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('no inline payments: the invoice is expanded and its PaymentIntent resolves the charge', async () => {
    const stripe = createMockStripe();
    vi.mocked(stripe.invoices.retrieve).mockResolvedValueOnce({
      id: 'in_resolver',
      payments: {
        data: [
          { payment: { type: 'payment_intent', payment_intent: 'pi_exp' } },
        ],
      },
    } as never);
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: 'pi_exp',
      latest_charge: 'ch_exp',
    } as never);

    const charge = await resolveInvoiceCharge(stripe, invoiceWith(null));

    expect(charge).toBe('ch_exp');
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_resolver', {
      expand: ['payments'],
    });
  });

  it('a PaymentIntent with no latest_charge yet: charges.list closes the gap', async () => {
    const stripe = createMockStripe();
    vi.mocked(stripe.paymentIntents.retrieve).mockResolvedValueOnce({
      id: 'pi_race',
      latest_charge: null,
    } as never);
    vi.mocked(stripe.charges.list).mockResolvedValueOnce({
      object: 'list',
      data: [{ id: 'ch_listed' }],
      has_more: false,
    } as never);

    const charge = await resolveInvoiceCharge(
      stripe,
      invoiceWith({ type: 'payment_intent', payment_intent: 'pi_race' })
    );

    expect(charge).toBe('ch_listed');
    expect(stripe.charges.list).toHaveBeenCalledWith({
      payment_intent: 'pi_race',
      limit: 1,
    });
  });

  it('nothing to resolve, even expanded: null', async () => {
    const stripe = createMockStripe();

    const charge = await resolveInvoiceCharge(stripe, invoiceWith(null));

    expect(charge).toBeNull();
    expect(stripe.invoices.retrieve).toHaveBeenCalledOnce();
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });
});
