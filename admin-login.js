// ========== ADMIN LOGIN COM SUPABASE AUTH + MFA ==========

class AdminLoginManager {
  constructor() {
    this.stage = 'email'; // email, mfa
    this.sessionId = null;
  }

  async init() {
    document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
    document.getElementById('verifyMfaBtn').addEventListener('click', () => this.verifyMFA());
    document.getElementById('forgotPasswordLink').addEventListener('click', (e) => this.handleForgotPassword(e));

    // Verificar se já está logado
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      window.location.href = '/admin.html';
    }
  }

  showError(message) {
    const errorEl = document.getElementById('errorMessage');
    errorEl.textContent = message;
    errorEl.classList.add('show');
    setTimeout(() => errorEl.classList.remove('show'), 5000);
  }

  setLoading(isLoading) {
    const btn = document.getElementById('loginBtn');
    const loading = document.getElementById('loading');

    if (isLoading) {
      btn.style.display = 'none';
      loading.style.display = 'block';
      btn.disabled = true;
    } else {
      btn.style.display = 'block';
      loading.style.display = 'none';
      btn.disabled = false;
    }
  }

  async handleLogin(e) {
    e.preventDefault();
    this.setLoading(true);

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
      // 1. Tentar login com email/password
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        // Log security event
        await supabase.from('security_events').insert([{
          event_type: 'failed_auth',
          severity: 'medium',
          details: { email, reason: error.message }
        }]);

        this.showError('Email ou senha incorretos');
        this.setLoading(false);
        return;
      }

      // 2. Verificar se usuário é admin (tem cliente owner_id)
      const { data: adminCheck, error: checkError } = await supabase
        .from('clients')
        .select('owner_id')
        .eq('owner_id', data.user.id)
        .limit(1);

      if (checkError || !adminCheck || adminCheck.length === 0) {
        // Logout se não for admin
        await supabase.auth.signOut();

        // Log security event
        await supabase.from('security_events').insert([{
          event_type: 'unauthorized_access',
          severity: 'high',
          user_id: data.user.id,
          details: { email, reason: 'Not an admin user' }
        }]);

        this.showError('Usuário não é administrador');
        this.setLoading(false);
        return;
      }

      // 3. Verificar se MFA está ativo
      if (data.user.factors && data.user.factors.length > 0) {
        // MFA ativo - pedir código
        this.stage = 'mfa';
        this.sessionId = data.session.id;

        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('mfaSection').classList.add('active');

        this.setLoading(false);
        return;
      }

      // 4. Login bem-sucedido (sem MFA)
      await this.completeLogin(data.user, email);

    } catch (err) {
      console.error('Login error:', err);
      this.showError('Erro ao fazer login. Tente novamente.');
      this.setLoading(false);
    }
  }

  async verifyMFA() {
    this.setLoading(true);
    const mfaCode = document.getElementById('mfaCode').value;

    if (mfaCode.length !== 6) {
      this.showError('Código deve ter 6 dígitos');
      this.setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: '1', // Placeholder (usando TOTP)
        token: mfaCode,
        type: 'totp'
      });

      if (error) {
        await supabase.from('security_events').insert([{
          event_type: 'failed_mfa',
          severity: 'medium',
          user_id: data?.user?.id,
          details: { reason: error.message }
        }]);

        this.showError('Código MFA inválido');
        this.setLoading(false);
        return;
      }

      await this.completeLogin(data.user, data.user.email);

    } catch (err) {
      console.error('MFA verification error:', err);
      this.showError('Erro ao verificar MFA');
      this.setLoading(false);
    }
  }

  async completeLogin(user, email) {
    try {
      // Log successful login
      await supabase.from('security_events').insert([{
        event_type: 'login',
        severity: 'low',
        user_id: user.id,
        details: { email, timestamp: new Date().toISOString() }
      }]);

      // Redirect para admin
      window.location.href = '/admin.html';

    } catch (err) {
      console.error('Error completing login:', err);
      this.showError('Erro ao finalizar login');
      this.setLoading(false);
    }
  }

  async handleForgotPassword(e) {
    e.preventDefault();

    const email = document.getElementById('email').value;
    if (!email) {
      this.showError('Digite seu email para resetar a senha');
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/admin-reset-password.html`
      });

      if (error) throw error;

      this.showError('Email de reset enviado. Verifique sua caixa de entrada.');

    } catch (err) {
      console.error('Forgot password error:', err);
      this.showError('Erro ao enviar email de reset');
    }
  }
}

// Init quando página carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const login = new AdminLoginManager();
    login.init();
  });
} else {
  const login = new AdminLoginManager();
  login.init();
}
