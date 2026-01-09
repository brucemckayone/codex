import { describe, expect, it } from 'vitest';
import { InMemoryEmailProvider } from '../in-memory-provider';

describe('InMemoryEmailProvider', () => {
  it('stores sent emails in memory', async () => {
    const provider = new InMemoryEmailProvider();

    const result = await provider.send(
      {
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
        text: 'Hello',
      },
      { email: 'from@example.com', name: 'Sender' }
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toMatch(/^inmem-/);
    expect(provider.count).toBe(1);
  });

  it('getSentEmails returns all sent emails', async () => {
    const provider = new InMemoryEmailProvider();

    await provider.send(
      { to: 'a@test.com', subject: 'A', html: 'A', text: 'A' },
      { email: 'from@test.com' }
    );
    await provider.send(
      { to: 'b@test.com', subject: 'B', html: 'B', text: 'B' },
      { email: 'from@test.com' }
    );

    const emails = provider.getSentEmails();
    expect(emails).toHaveLength(2);
    expect(emails[0].message.to).toBe('a@test.com');
    expect(emails[1].message.to).toBe('b@test.com');
  });

  it('getLastEmail returns most recent email', async () => {
    const provider = new InMemoryEmailProvider();

    await provider.send(
      { to: 'first@test.com', subject: 'First', html: 'F', text: 'F' },
      { email: 'from@test.com' }
    );
    await provider.send(
      { to: 'last@test.com', subject: 'Last', html: 'L', text: 'L' },
      { email: 'from@test.com' }
    );

    const last = provider.getLastEmail();
    expect(last?.message.to).toBe('last@test.com');
    expect(last?.message.subject).toBe('Last');
  });

  it('getEmailsTo filters by recipient', async () => {
    const provider = new InMemoryEmailProvider();

    await provider.send(
      { to: 'alice@test.com', subject: 'To Alice', html: 'A', text: 'A' },
      { email: 'from@test.com' }
    );
    await provider.send(
      { to: 'bob@test.com', subject: 'To Bob', html: 'B', text: 'B' },
      { email: 'from@test.com' }
    );
    await provider.send(
      { to: 'alice@test.com', subject: 'Again Alice', html: 'A2', text: 'A2' },
      { email: 'from@test.com' }
    );

    const aliceEmails = provider.getEmailsTo('alice@test.com');
    expect(aliceEmails).toHaveLength(2);
    expect(aliceEmails[0].message.subject).toBe('To Alice');
    expect(aliceEmails[1].message.subject).toBe('Again Alice');
  });

  it('getEmailsWithSubject filters by subject', async () => {
    const provider = new InMemoryEmailProvider();

    await provider.send(
      { to: 'a@test.com', subject: 'Welcome to Codex', html: 'W', text: 'W' },
      { email: 'from@test.com' }
    );
    await provider.send(
      { to: 'b@test.com', subject: 'Password Reset', html: 'P', text: 'P' },
      { email: 'from@test.com' }
    );
    await provider.send(
      { to: 'c@test.com', subject: 'Welcome back', html: 'WB', text: 'WB' },
      { email: 'from@test.com' }
    );

    const welcomeEmails = provider.getEmailsWithSubject('Welcome');
    expect(welcomeEmails).toHaveLength(2);
  });

  it('clear removes all stored emails', async () => {
    const provider = new InMemoryEmailProvider();

    await provider.send(
      { to: 'test@test.com', subject: 'Test', html: 'T', text: 'T' },
      { email: 'from@test.com' }
    );

    expect(provider.count).toBe(1);
    provider.clear();
    expect(provider.count).toBe(0);
    expect(provider.getSentEmails()).toHaveLength(0);
  });

  it('getLastEmail returns undefined when empty', () => {
    const provider = new InMemoryEmailProvider();
    expect(provider.getLastEmail()).toBeUndefined();
  });

  it('name property returns in-memory', () => {
    const provider = new InMemoryEmailProvider();
    expect(provider.name).toBe('in-memory');
  });
});
