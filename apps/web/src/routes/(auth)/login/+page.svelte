<script lang="ts">
  /**
   * Login page placeholder
   */
</script>

<svelte:head>
  <title>Sign In | Revelations</title>
</svelte:head>

<div class="auth-card">
  <h1>Sign In</h1>
  <p>Sign in to your account to continue</p>

  <form class="auth-form">
    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" />
    </div>

    <div class="form-group">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" placeholder="••••••••" />
    </div>

    <button type="submit" class="submit-btn">Sign In</button>
  </form>

  <div class="auth-links">
    <a href="/forgot-password">Forgot password?</a>
    <span>·</span>
    <a href="/register">Create account</a>
  </div>
</div>


