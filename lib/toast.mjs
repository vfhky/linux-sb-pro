// lib/toast.mjs
// Pure factory function for toast notifications. Zero external dependencies.
// Inlined into the public build by build.mjs.

const ICONS = { success: '✓', error: '✗', info: 'ℹ' };

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function createToastManager(opts) {
  if (opts === void 0) opts = {};
  var maxVisible = opts.maxVisible != null ? opts.maxVisible : 3;
  var gap = opts.gap != null ? opts.gap : 8;
  var durationMs = opts.durationMs != null ? opts.durationMs : 3000;
  var containerId = opts.containerId || 'lsb-toast-container';

  // Clamp duration to safe range.
  if (durationMs < 1000) durationMs = 1000;
  if (durationMs > 30000) durationMs = 30000;

  var container = null;
  var queue = [];

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = containerId;
    document.documentElement.appendChild(container);
    return container;
  }

  function show(message, options) {
    if (!message || typeof message !== 'string') return;
    if (options === void 0) options = {};
    var type = options.type || 'info';
    var dur = options.durationMs != null ? options.durationMs : durationMs;
    if (dur < 1000) dur = 1000;
    if (dur > 30000) dur = 30000;

    var ctr = ensureContainer();
    var el = document.createElement('div');
    el.className = 'lsb-toast';
    el.dataset.type = type;
    el.innerHTML = '<span class="lsb-toast-icon">' + (ICONS[type] || ICONS.info) + '</span>' +
                   '<span class="lsb-toast-msg">' + escapeHtml(message) + '</span>';
    el.addEventListener('click', function () { dismiss(el); });

    ctr.appendChild(el);
    queue.push(el);

    while (queue.length > maxVisible) {
      dismissEl(queue.shift());
    }

    var timer = setTimeout(function () { dismiss(el); }, dur);
    el._lsbToastTimer = timer;

    return el;
  }

  function dismiss(el) {
    if (!el || el._lsbToastDismissed) return;
    el._lsbToastDismissed = true;
    clearTimeout(el._lsbToastTimer);
    el.classList.add('lsb-toast-out');
    setTimeout(function () { dismissEl(el); }, 200);
  }

  function dismissEl(el) {
    var idx = queue.indexOf(el);
    if (idx >= 0) queue.splice(idx, 1);
    if (el.parentNode) el.parentNode.removeChild(el);
  }

  function destroy() {
    while (queue.length) { dismissEl(queue[0]); }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }

  return { show: show, dismiss: dismiss, destroy: destroy };
}
