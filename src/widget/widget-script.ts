/**
 * The embeddable chat widget, served at GET /widget.js. Plain JS with no dependencies so it can
 * be dropped into any site with one <script> tag. Rules for editing this file:
 *  - this is a String.raw template: never use backticks or ${...} inside the JS below;
 *  - only ever put text into the page via textContent (messages come from untrusted visitors).
 */
export const WIDGET_SCRIPT = String.raw`(function () {
  var script = document.currentScript;
  if (!script) return;
  var key = script.getAttribute('data-key');
  if (!key) { console.warn('[SocialBox] data-key is missing'); return; }
  var api = new URL(script.src).origin;
  var storeKey = 'socialbox_widget_' + key;

  var MAX_FILE = 5 * 1024 * 1024;
  var state = { open: false, token: null, config: null, server: [], pending: [], unread: false, seenAgent: 0, timer: null, online: true, agentTyping: false, profile: null, lastTyping: 0 };

  try { state.token = localStorage.getItem(storeKey); } catch (e) {}
  try { state.profile = JSON.parse(localStorage.getItem(storeKey + '_profile') || 'null'); } catch (e) {}

  function request(path, method, body) {
    var headers = {};
    var isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (!isForm) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    return fetch(api + path, { method: method || 'GET', headers: headers, body: body ? (isForm ? body : JSON.stringify(body)) : undefined })
      .then(function (res) {
        if (res.status === 401) {
          state.token = null;
          try { localStorage.removeItem(storeKey); } catch (e) {}
        }
        if (!res.ok) { var err = new Error('HTTP ' + res.status); err.status = res.status; throw err; }
        return res.status === 204 ? null : res.json();
      });
  }

  function ensureSession() {
    if (state.token) return Promise.resolve();
    return request('/widget/' + encodeURIComponent(key) + '/sessions', 'POST').then(function (data) {
      state.token = data.token;
      try { localStorage.setItem(storeKey, data.token); } catch (e) {}
    });
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var el = {};

  function build() {
    var color = state.config.color;
    var host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;right:0;bottom:0;';
    var root = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent =
      '*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.bubble{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:' + color + ';color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center}' +
      '.bubble svg{width:26px;height:26px}' +
      '.dot{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#ef4444;border:2px solid #fff;display:none}' +
      '.panel{position:fixed;right:20px;bottom:90px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden}' +
      '.panel.open{display:flex}' +
      '.head{background:' + color + ';color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;font-size:15px;font-weight:600}' +
      '.close{background:none;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:0 4px}' +
      '.list{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#f8fafc}' +
      '.msg{max-width:80%;padding:8px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}' +
      '.msg.agent{align-self:flex-start;background:#fff;color:#111827;border:1px solid #e5e7eb;border-bottom-left-radius:4px}' +
      '.msg.me{align-self:flex-end;background:' + color + ';color:#fff;border-bottom-right-radius:4px}' +
      '.msg.failed{opacity:.6;cursor:pointer}' +
      '.note{align-self:flex-end;font-size:11px;color:#b91c1c;margin-top:-4px}' +
      '.form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb;background:#fff}' +
      '.input{flex:1;border:1px solid #d1d5db;border-radius:20px;padding:9px 14px;font-size:14px;outline:none}' +
      '.input:focus{border-color:' + color + '}' +
      '.send{border:0;border-radius:20px;padding:0 16px;background:' + color + ';color:#fff;font-size:14px;cursor:pointer}' +
      '.attach{border:0;background:none;color:#6b7280;cursor:pointer;padding:0 4px;display:flex;align-items:center}' +
      '.attach svg{width:20px;height:20px}' +
      '.banner{background:#fef3c7;color:#92400e;font-size:12px;padding:8px 14px;display:none;border-bottom:1px solid #fde68a}' +
      '.typing{align-self:flex-start;font-size:12px;color:#6b7280;padding:2px 4px}' +
      '.file{display:block;margin-top:4px;font-size:12px;color:inherit;text-decoration:underline;word-break:break-all}' +
      '.pre{flex:1;padding:18px;display:none;flex-direction:column;gap:10px;background:#f8fafc;overflow-y:auto}' +
      '.pre p{margin:0 0 4px;font-size:14px;color:#374151}' +
      '.pre label{font-size:12px;color:#374151;display:block;margin-bottom:3px}' +
      '.pre .input{width:100%;border-radius:8px}' +
      '.pre .send{padding:10px 16px;border-radius:8px}' +
      '.err{color:#b91c1c;font-size:12px;min-height:14px}';
    root.appendChild(style);

    var panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', state.config.title);

    var head = document.createElement('div');
    head.className = 'head';
    var title = document.createElement('span');
    title.textContent = state.config.title;
    var close = document.createElement('button');
    close.className = 'close';
    close.setAttribute('aria-label', 'Close chat');
    close.textContent = '×';
    close.onclick = function () { setOpen(false); };
    head.appendChild(title);
    head.appendChild(close);

    var banner = document.createElement('div');
    banner.className = 'banner';

    var list = document.createElement('div');
    list.className = 'list';
    list.setAttribute('aria-live', 'polite');

    var pre = document.createElement('form');
    pre.className = 'pre';
    var preIntro = document.createElement('p');
    preIntro.textContent = 'Before we start, tell us a little about you.';
    pre.appendChild(preIntro);
    var nameInput = null, emailInput = null;
    function field(labelText, type, required) {
      var wrap = document.createElement('div');
      var label = document.createElement('label');
      label.textContent = labelText;
      var inputEl = document.createElement('input');
      inputEl.className = 'input';
      inputEl.type = type;
      inputEl.required = required;
      inputEl.maxLength = type === 'email' ? 254 : 80;
      wrap.appendChild(label);
      wrap.appendChild(inputEl);
      pre.appendChild(wrap);
      return inputEl;
    }
    if (state.config.askName) nameInput = field('Your name', 'text', true);
    if (state.config.askEmail) emailInput = field('Your email', 'email', true);
    var preErr = document.createElement('div');
    preErr.className = 'err';
    var preGo = document.createElement('button');
    preGo.className = 'send';
    preGo.type = 'submit';
    preGo.textContent = 'Start chat';
    pre.appendChild(preErr);
    pre.appendChild(preGo);
    pre.onsubmit = function (e) {
      e.preventDefault();
      var profile = {
        name: nameInput ? nameInput.value.trim() : undefined,
        email: emailInput ? emailInput.value.trim() : undefined
      };
      if ((nameInput && !profile.name) || (emailInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))) {
        preErr.textContent = 'Please fill in the details above.';
        return;
      }
      state.profile = profile;
      try { localStorage.setItem(storeKey + '_profile', JSON.stringify(profile)); } catch (e2) {}
      render();
      el.input.focus();
    };

    var form = document.createElement('form');
    form.className = 'form';
    var input = document.createElement('input');
    input.className = 'input';
    input.placeholder = 'Type a message...';
    input.maxLength = 2000;
    input.setAttribute('aria-label', 'Message');
    var send = document.createElement('button');
    send.className = 'send';
    send.type = 'submit';
    send.textContent = 'Send';
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.style.display = 'none';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx';
    fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      if (f.size > MAX_FILE) { alert('Files can be at most 5 MB.'); return; }
      var text = input.value.trim();
      input.value = '';
      sendMessage(text, f);
    };
    var attach = document.createElement('button');
    attach.type = 'button';
    attach.className = 'attach';
    attach.setAttribute('aria-label', 'Attach a file');
    attach.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
    attach.onclick = function () { fileInput.click(); };
    input.addEventListener('input', function () { notifyTyping(); });
    form.appendChild(attach);
    form.appendChild(fileInput);
    form.appendChild(input);
    form.appendChild(send);
    form.onsubmit = function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendMessage(text);
    };

    panel.appendChild(head);
    panel.appendChild(banner);
    panel.appendChild(list);
    panel.appendChild(pre);
    panel.appendChild(form);

    var bubble = document.createElement('button');
    bubble.className = 'bubble';
    bubble.setAttribute('aria-label', 'Open chat');
    bubble.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    var dot = document.createElement('span');
    dot.className = 'dot';
    bubble.appendChild(dot);
    bubble.onclick = function () { setOpen(!state.open); };

    root.appendChild(panel);
    root.appendChild(bubble);
    document.body.appendChild(host);
    el = { host: host, panel: panel, list: list, input: input, dot: dot, banner: banner, pre: pre, form: form, nameInput: nameInput, emailInput: emailInput };
  }

  function bubbleEl(text, cls) {
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    return div;
  }

  function needsProfile() {
    var c = state.config;
    return (c.askName || c.askEmail) && !state.profile && state.server.length === 0 && state.pending.length === 0;
  }

  function addFiles(node, files) {
    (files || []).forEach(function (f) {
      var a = document.createElement('a');
      a.className = 'file';
      a.href = f.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = f.name + (f.size ? ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)' : '');
      node.appendChild(a);
    });
  }

  function render() {
    if (!el.list) return;
    var gate = needsProfile();
    el.pre.style.display = gate ? 'flex' : 'none';
    el.list.style.display = gate ? 'none' : 'flex';
    el.form.style.display = gate ? 'none' : 'flex';
    var offline = !state.online && state.config.offlineMessage;
    el.banner.style.display = offline ? 'block' : 'none';
    el.banner.textContent = offline ? state.config.offlineMessage : '';
    var nearBottom = el.list.scrollHeight - el.list.scrollTop - el.list.clientHeight < 60;
    el.list.textContent = '';

    var seen = {};
    state.server.forEach(function (m) { if (m.clientId) seen[m.clientId] = true; });
    var items = state.server.slice();
    state.pending = state.pending.filter(function (p) { return !seen[p.clientId]; });

    if (items.length === 0 && state.pending.length === 0) {
      el.list.appendChild(bubbleEl(state.config.greeting, 'agent'));
    }
    items.forEach(function (m) {
      var node = bubbleEl(m.content, m.direction === 'INBOUND' ? 'me' : 'agent');
      addFiles(node, m.attachments);
      el.list.appendChild(node);
    });
    state.pending.forEach(function (p) {
      var node = bubbleEl(p.content, 'me' + (p.failed ? ' failed' : ''));
      if (p.file) { var fnode = document.createElement('span'); fnode.className = 'file'; fnode.textContent = p.file.name; node.appendChild(fnode); }
      el.list.appendChild(node);
      if (p.failed) {
        node.title = 'Click to retry';
        node.onclick = function () { retry(p); };
        var note = document.createElement('div');
        note.className = 'note';
        note.textContent = 'Not sent — click to retry';
        el.list.appendChild(note);
      }
    });
    if (state.agentTyping) {
      var typing = document.createElement('div');
      typing.className = 'typing';
      typing.textContent = 'Typing...';
      el.list.appendChild(typing);
    }
    if (nearBottom || state.open) el.list.scrollTop = el.list.scrollHeight;
  }

  // The workspace disconnected the channel (or this site was removed from the allowed list):
  // take the widget off the page instead of leaving a bubble that silently can't send.
  function unavailable(e) {
    if (!e || (e.status !== 404 && e.status !== 403)) return false;
    clearTimeout(state.timer);
    state.gone = true;
    if (el.host && el.host.parentNode) el.host.parentNode.removeChild(el.host);
    return true;
  }

  function poll() {
    if (state.gone) return Promise.resolve();
    return ensureSession()
      .then(function () { return request('/widget/messages'); })
      .then(function (data) {
        state.server = data.messages;
        state.online = data.online !== false;
        state.agentTyping = !!data.agentTyping;
        var agent = data.messages.filter(function (m) { return m.direction === 'OUTBOUND'; }).length;
        if (!state.open && agent > state.seenAgent) state.unread = true;
        if (state.open || !state.unread) state.seenAgent = agent;
        el.dot.style.display = state.unread && !state.open ? 'block' : 'none';
        render();
      })
      .catch(function (e) { unavailable(e); });
  }

  function schedule() {
    if (state.gone) return;
    clearTimeout(state.timer);
    var delay = state.open && !document.hidden ? (state.agentTyping ? 1500 : 3000) : 15000;
    state.timer = setTimeout(function () { poll().then(schedule); }, delay);
  }

  function setOpen(open) {
    state.open = open;
    el.panel.classList.toggle('open', open);
    if (open) {
      state.unread = false;
      el.dot.style.display = 'none';
      render();
      el.input.focus();
      poll().then(schedule);
    } else {
      schedule();
    }
  }

  function deliver(p) {
    p.failed = false;
    render();
    return ensureSession()
      .then(function () {
        var profile = state.profile || {};
        if (p.file) {
          var form = new FormData();
          form.append('id', p.clientId);
          form.append('text', p.content || '');
          form.append('pageUrl', location.href);
          if (profile.name) form.append('name', profile.name);
          if (profile.email) form.append('email', profile.email);
          form.append('file', p.file);
          return request('/widget/messages/upload', 'POST', form);
        }
        var body = { id: p.clientId, text: p.content, pageUrl: location.href };
        if (profile.name) body.name = profile.name;
        if (profile.email) body.email = profile.email;
        return request('/widget/messages', 'POST', body);
      })
      .then(function () { return poll(); })
      .catch(function (e) { if (!unavailable(e)) { p.failed = true; render(); } });
  }

  function notifyTyping() {
    var now = Date.now();
    if (!state.token || now - state.lastTyping < 2500) return;
    state.lastTyping = now;
    request('/widget/typing', 'POST').catch(function () {});
  }

  function sendMessage(text, file) {
    var p = { clientId: uid(), content: text, file: file || null, failed: false };
    state.pending.push(p);
    deliver(p);
  }

  function retry(p) { deliver(p); }

  request('/widget/' + encodeURIComponent(key) + '/config')
    .then(function (config) {
      state.config = config;
      build();
      render();
      if (state.token) poll().then(schedule); else schedule();
      window.SocialBoxWidget = { open: function () { setOpen(true); }, close: function () { setOpen(false); } };
    })
    .catch(function (e) { console.warn('[SocialBox] chat unavailable (' + (e && e.status) + ')'); });
})();
`;
