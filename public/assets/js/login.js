/* Espace administrateur — connexion */
(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var errorBox = document.getElementById('loginError');
  var submit = document.getElementById('loginSubmit');
  var toggle = document.getElementById('togglePassword');
  var password = document.getElementById('password');
  var lockTimer = null;

  if (toggle && password) {
    toggle.addEventListener('click', function () {
      var isPassword = password.type === 'password';
      password.type = isPassword ? 'text' : 'password';
      toggle.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    });
  }

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.add('is-visible');
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = '';
    errorBox.classList.remove('is-visible');
  }

  function lock(seconds) {
    var remaining = Math.max(1, Number(seconds) || 60);
    if (submit) submit.disabled = true;
    if (lockTimer) clearInterval(lockTimer);
    function render() {
      showError('Trop de tentatives. Nouvelle tentative possible dans ' + remaining + ' seconde' + (remaining > 1 ? 's' : '') + '.');
      remaining -= 1;
      if (remaining < 0) {
        clearInterval(lockTimer);
        lockTimer = null;
        if (submit) submit.disabled = false;
        clearError();
      }
    }
    render();
    lockTimer = setInterval(render, 1000);
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearError();
      var username = form.username.value.trim();
      var pass = form.password.value;
      if (!username || !pass) {
        showError('Renseignez votre identifiant et votre mot de passe.');
        return;
      }
      if (submit) { submit.disabled = true; submit.style.opacity = '0.65'; }

      fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username: username, password: pass })
      }).then(function (res) {
        return res.json().then(function (json) { return { status: res.status, json: json }; });
      }).then(function (result) {
        if (result.status === 200 && result.json.ok) {
          window.location.href = '/admin/dashboard';
          return;
        }
        if (result.status === 429) {
          lock(result.json.retryAfter || 900);
          return;
        }
        showError(result.json.error || 'Connexion impossible.');
        if (submit) { submit.disabled = false; submit.style.opacity = '1'; }
        form.password.value = '';
        form.password.focus();
      }).catch(function () {
        showError('Impossible de joindre le serveur. Vérifiez qu\'il est bien démarré.');
        if (submit) { submit.disabled = false; submit.style.opacity = '1'; }
      });
    });
  }
})();
