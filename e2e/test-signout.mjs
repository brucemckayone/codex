// Quick test script to manually test sign-out endpoint

const testEmail = `test-${Date.now()}@example.com`;
const testPassword = 'SecurePassword123!';

// 1. Register
const registerResp = await fetch('http://localhost:42069/api/auth/sign-up/email', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: testEmail,
    password: testPassword,
    name: 'Test User',
  }),
});

console.log('Register status:', registerResp.status);
const cookies = registerResp.headers.get('set-cookie');
console.log('Set-Cookie header:', cookies);

// 2. Extract token from KV (E2E flow)
await new Promise(resolve => setTimeout(resolve, 500));
const tokenResp = await fetch(`http://localhost:42069/api/test/verification-token/${encodeURIComponent(testEmail)}`);
const { token } = await tokenResp.json();

// 3. Verify email
const verifyResp = await fetch(`http://localhost:42069/api/auth/verify-email?token=${token}&callbackURL=/`);
console.log('Verify status:', verifyResp.status);
const verifyCookies = verifyResp.headers.get('set-cookie');
console.log('Verify cookies:', verifyCookies);

// Extract session cookies
const sessionTokenMatch = verifyCookies?.match(/better-auth\.session_token=([^;]+)/);
const sessionDataMatches = [...verifyCookies.matchAll(/better-auth\.session_data=([^;]*)/g)];
const sessionData = sessionDataMatches[sessionDataMatches.length - 1]?.[1];

const cookieToSend = `better-auth.session_token=${sessionTokenMatch[1]}; better-auth.session_data=${sessionData}`;
console.log('Cookie to send:', cookieToSend);

// 4. Verify session works
const sessionResp = await fetch('http://localhost:42069/api/auth/get-session', {
  headers: { Cookie: cookieToSend },
});
console.log('Session check status:', sessionResp.status);
const sessionData2 = await sessionResp.json();
console.log('Session user:', sessionData2?.user?.email);

// 5. Sign out
const signOutResp = await fetch('http://localhost:42069/api/auth/sign-out', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': cookieToSend,
  },
  body: JSON.stringify({}),
});

console.log('Sign out status:', signOutResp.status);
const signOutBody = await signOutResp.text();
console.log('Sign out response:', signOutBody);
