<script lang="ts">
  /**
   * Forgot password page placeholder
   */
</script>

<svelte:head>
  <title>Reset Password | Revelations</title>
</svelte:head>

<div class="auth-card">
  <h1>Reset Password</h1>
  <p>Enter your email to receive a password reset link</p>

  <form class="auth-form">
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" />
    </div>

    <button type="submit" class="submit-btn">Send Reset Link</button>
  </form>

  <div class="auth-links">
    <a href="/login">Back to sign in</a>
  </div>
</div>


