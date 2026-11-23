import { describe, expect, it } from 'vitest';
import { dbErrorFacts } from '../db-errors';

/** drizzle's failed-query shape, built by hand as message-for-log.test.ts does. */
function failedQuery(cause: unknown): Error {
  return Object.assign(
    new Error(
      'Failed query: select "id" from "refunds" where "stripe_charge_id" = $1 for update\nparams: ch_secret'
    ),
    { cause }
  );
}

/** What the driver rejects with: an Error carrying the Postgres code. */
function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('dbErrorFacts', () => {
  it("names a lock given up by its cause's code and the driver's reason, never the query or its params", () => {
    const facts = dbErrorFacts(
      failedQuery(pgError('canceling statement due to lock timeout', '55P03'))
    );

    expect(facts).toEqual({
      code: '55P03',
      lockTimeout: true,
      reason: 'canceling statement due to lock timeout',
    });
    expect(JSON.stringify(facts)).not.toContain('Failed query');
    expect(JSON.stringify(facts)).not.toContain('ch_secret');
  });

  it('reads the code off a driver error that is not wrapped', () => {
    expect(
      dbErrorFacts(
        pgError('duplicate key value violates unique constraint', '23505')
      )
    ).toEqual({
      code: '23505',
      lockTimeout: false,
      reason: 'duplicate key value violates unique constraint',
    });
  });

  it('has no code for an error that is not the database', () => {
    expect(dbErrorFacts(new Error('the cover failed'))).toEqual({
      code: null,
      lockTimeout: false,
      reason: 'the cover failed',
    });
    expect(dbErrorFacts('a string')).toMatchObject({
      code: null,
      lockTimeout: false,
    });
  });

  it("finds the driver's code under a service's wrapper, whose own code is not the database's", () => {
    // handleError's InternalServiceError, over drizzle's wrapper, over the driver.
    const wrapped = Object.assign(new Error('An unexpected error occurred'), {
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      cause: failedQuery(
        pgError('canceling statement due to lock timeout', '55P03')
      ),
    });

    expect(dbErrorFacts(wrapped)).toEqual({
      code: '55P03',
      lockTimeout: true,
      reason: 'canceling statement due to lock timeout',
    });
  });

  it("keeps a wrapper's own message when no link down its chain is the database's", () => {
    // A service's typed defect over a parse failure: nothing Postgres in it.
    const wrapped = Object.assign(
      new Error(
        "A payment's failed refunds were read as something other than a list of ids"
      ),
      {
        code: 'INTERNAL_ERROR',
        statusCode: 500,
        cause: new SyntaxError('Unexpected token o in JSON at position 1'),
      }
    );

    expect(dbErrorFacts(wrapped)).toEqual({
      code: null,
      lockTimeout: false,
      reason:
        "A payment's failed refunds were read as something other than a list of ids",
    });
  });

  it('gives no code for a Stripe error, only its reason', () => {
    const stripe = Object.assign(new Error('No such charge'), {
      code: 'resource_missing',
      statusCode: 404,
    });

    expect(dbErrorFacts(stripe)).toEqual({
      code: null,
      lockTimeout: false,
      reason: 'No such charge',
    });
  });

  it('withholds a failed query the driver gave no reason for', () => {
    const facts = dbErrorFacts(failedQuery(undefined));

    expect(facts.code).toBeNull();
    expect(facts.reason).not.toContain('Failed query');
  });
});
