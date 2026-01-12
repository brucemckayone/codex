<script lang="ts">
  /**
   * Register page placeholder
   */
</script>

<svelte:head>
  <title>Create Account | Revelations</title>
</svelte:head>

<div class="auth-card">
  <h1>Create Account</h1>
  <p>Join to access content and connect with creators</p>

  <form class="auth-form">
    <div class="form-group">
      <label for="name">Name</label>
      <input type="text" id="name" name="name" placeholder="Your name" />
    </div>

    <div class="form-group">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" placeholder="you@example.com" />
    </div>

    <div class="form-group">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" placeholder="••••••••" />
    </div>

    <button type="submit" class="submit-btn">Create Account</button>
  </form>

  <div class="auth-links">
    <span>Already have an account?</span>
    <a href="/login">Sign in</a>
  </div>
</div>


