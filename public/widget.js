/* Shraddha Message — website chat widget. Embed: <script src="https://YOUR-PANEL/widget.js" async></script> */
(function () {
  "use strict";
  if (window.__smWidgetLoaded) return;
  window.__smWidgetLoaded = true;

  var script =
    document.currentScript ||
    (function () {
      var s = document.querySelectorAll("script[src]");
      for (var i = s.length - 1; i >= 0; i--) if (/\/widget\.js(\?|$)/.test(s[i].src)) return s[i];
      return null;
    })();
  if (!script) return;
  var BASE = new URL(script.src, location.href).origin;
  var KEY = "smw:" + BASE + ":";
  var OPEN_MS = 4000;
  var CLOSED_MS = 30000;

  /* ---------------------------------------------------------------- storage */
  function get(k) {
    try {
      return localStorage.getItem(KEY + k);
    } catch (e) {
      return null;
    }
  }
  function set(k, v) {
    try {
      localStorage.setItem(KEY + k, v);
    } catch (e) {
      /* private mode */
    }
  }
  function newId() {
    var a = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(a);
    var s = "";
    for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
    return "v" + s;
  }
  var visitorId = get("vid");
  if (!visitorId || !/^[A-Za-z0-9_-]{8,64}$/.test(visitorId)) {
    visitorId = newId();
    set("vid", visitorId);
  }

  /* ---------------------------------------------------------------- state */
  var cfg = null;
  var isOpen = false;
  var started = get("started") === "1"; // visitor has sent at least one message
  var seen = {}; // message id -> true
  var lastAt = 0; // ms timestamp of the newest message seen
  var unread = 0;
  var timer = null;
  var loadedOnce = false;
  var els = {};

  function api(path, opts) {
    return fetch(BASE + path, opts).then(function (r) {
      return r.json().then(
        function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Request failed");
          return d;
        },
        function () {
          throw new Error("Request failed");
        },
      );
    });
  }

  /* ---------------------------------------------------------------- UI */
  function css(c) {
    return (
      ":host{all:initial}" +
      "*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}" +
      ".btn{position:fixed;right:20px;bottom:20px;width:58px;height:58px;border-radius:50%;border:0;background:" + c + ";color:#fff;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .15s}" +
      ".btn:hover{transform:scale(1.06)}" +
      ".btn svg{width:28px;height:28px}" +
      ".badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#e5484d;color:#fff;font-size:12px;font-weight:600;line-height:20px;text-align:center;display:none}" +
      ".panel{position:fixed;right:20px;bottom:90px;width:370px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.2);display:none;flex-direction:column;overflow:hidden;z-index:2147483647;color:#222;font-size:14px}" +
      ".panel.open{display:flex}" +
      ".head{background:" + c + ";color:#fff;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:8px}" +
      ".title{font-weight:600;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".x{background:transparent;border:0;color:#fff;cursor:pointer;opacity:.85;padding:4px;display:flex}" +
      ".x:hover{opacity:1}.x svg{width:20px;height:20px}" +
      ".list{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}" +
      ".m{max-width:82%;padding:8px 12px;border-radius:16px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}" +
      ".in{align-self:flex-end;background:" + c + ";color:#fff;border-bottom-right-radius:4px}" +
      ".out{align-self:flex-start;background:#fff;color:#222;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.06)}" +
      ".m a{color:inherit;text-decoration:underline}" +
      ".m.pending{opacity:.6}" +
      ".m.err{background:#ffebeb;color:#b42318}" +
      ".t{display:block;font-size:10px;opacity:.65;margin-top:3px}" +
      ".name{padding:10px 12px 0;background:#fff;border-top:1px solid #eee}" +
      ".name label{display:block;font-size:12px;color:#666;margin-bottom:4px}" +
      ".foot{display:flex;gap:8px;padding:10px 12px;background:#fff;align-items:flex-end}" +
      ".name+.foot{border-top:0}.foot{border-top:1px solid #eee}" +
      "input,textarea{width:100%;border:1px solid #ddd;border-radius:18px;padding:9px 14px;font-size:16px;outline:none;color:#222;background:#fff}" +
      "input:focus,textarea:focus{border-color:" + c + "}" +
      "textarea{resize:none;max-height:120px;min-height:40px;line-height:1.35}" +
      ".send{flex:none;width:40px;height:40px;border-radius:50%;border:0;background:" + c + ";color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}" +
      ".send:disabled{opacity:.5;cursor:default}.send svg{width:18px;height:18px}" +
      ".pw{font-size:10px;color:#aaa;text-align:center;padding:0 0 6px;background:#fff}" +
      "@media (max-width:480px){.panel{right:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.btn{right:16px;bottom:16px}.panel.open~.btn{display:none}}"
    );
  }

  var ICON_CHAT =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20l1.3-3.9A9 8 0 1 1 7.7 19L3 20"/></svg>';
  var ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  var ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14L21 3M21 3l-6.5 18a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1L21 3"/></svg>';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  function fillText(node, text) {
    var re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement("a");
      a.href = m[1];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = m[1];
      node.appendChild(a);
      last = m.index + m[1].length;
    }
    if (last < text.length) node.appendChild(document.createTextNode(text.slice(last)));
  }

  function timeOf(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }

  function bubble(dir, text, iso, extra) {
    var b = el("div", "m " + (dir === "in" ? "in" : "out") + (extra ? " " + extra : ""));
    fillText(b, text);
    if (iso) {
      var t = el("span", "t");
      t.textContent = timeOf(iso);
      b.appendChild(t);
    }
    return b;
  }

  function scrollDown() {
    els.list.scrollTop = els.list.scrollHeight;
  }

  function addMessages(list) {
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var at = Date.parse(m.createdAt) || 0;
      if (at > lastAt) lastAt = at;
      if (seen[m.id]) continue;
      seen[m.id] = true;
      // drop the optimistic copy of our own message
      if (m.direction === "in") {
        var p = els.list.querySelector('.pending[data-text="' + cssEscape(m.body) + '"]');
        if (p) p.parentNode.removeChild(p);
      }
      els.list.appendChild(bubble(m.direction, m.body, m.createdAt));
      if (m.direction === "out") added++;
    }
    if (list.length) scrollDown();
    return added;
  }

  function cssEscape(s) {
    return String(s).replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ");
  }

  function setBadge() {
    els.badge.style.display = unread > 0 && !isOpen ? "block" : "none";
    els.badge.textContent = unread > 9 ? "9+" : String(unread);
  }

  function build() {
    var host = el("div");
    host.id = "sm-chat-widget";
    document.body.appendChild(host);
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = el("style");
    style.textContent = css(cfg.color);
    root.appendChild(style);

    var panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", cfg.title);
    var head = el("div", "head");
    var title = el("div", "title");
    title.textContent = cfg.title || "Chat with us";
    var x = el("button", "x", ICON_X);
    x.setAttribute("aria-label", "Close chat");
    head.appendChild(title);
    head.appendChild(x);

    var list = el("div", "list");
    if (cfg.greeting) list.appendChild(bubble("out", cfg.greeting));

    var nameRow = el("div", "name");
    var nameLabel = el("label");
    nameLabel.textContent = "Your name (optional)";
    var nameInput = el("input");
    nameInput.type = "text";
    nameInput.maxLength = 80;
    nameInput.placeholder = "e.g. Priya";
    nameInput.autocomplete = "name";
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);
    if (started || get("name") !== null) nameRow.style.display = "none";

    var foot = el("form", "foot");
    var ta = el("textarea");
    ta.rows = 1;
    ta.placeholder = "Type a message…";
    ta.maxLength = 2000;
    var send = el("button", "send", ICON_SEND);
    send.type = "submit";
    send.setAttribute("aria-label", "Send");
    foot.appendChild(ta);
    foot.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(nameRow);
    panel.appendChild(foot);

    var btn = el("button", "btn", ICON_CHAT);
    btn.setAttribute("aria-label", "Open chat");
    var badge = el("span", "badge");
    btn.appendChild(badge);

    root.appendChild(panel);
    root.appendChild(btn);

    els = { panel: panel, list: list, ta: ta, send: send, btn: btn, badge: badge, nameRow: nameRow, nameInput: nameInput };

    btn.addEventListener("click", function () {
      toggle(!isOpen);
    });
    x.addEventListener("click", function () {
      toggle(false);
    });
    ta.addEventListener("input", function () {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    });
    ta.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
    foot.addEventListener("submit", function (e) {
      e.preventDefault();
      submit();
    });
    panel.addEventListener("keydown", function (e) {
      if (e.key === "Escape") toggle(false);
    });
  }

  function toggle(open) {
    isOpen = open;
    els.panel.className = "panel" + (open ? " open" : "");
    els.btn.innerHTML = open ? ICON_X : ICON_CHAT;
    els.btn.appendChild(els.badge);
    els.btn.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    if (open) {
      unread = 0;
      setTimeout(function () {
        (els.nameRow.style.display !== "none" ? els.nameInput : els.ta).focus();
      }, 50);
      scrollDown();
    }
    setBadge();
    schedule(0);
  }

  function submit() {
    var text = els.ta.value.replace(/^\s+|\s+$/g, "");
    if (!text || els.send.disabled) return;
    var body = { visitorId: visitorId, text: text };
    if (!started) {
      var nm = els.nameInput.value.replace(/^\s+|\s+$/g, "");
      if (nm) body.name = nm;
      set("name", nm);
    }
    var pending = bubble("in", text, null, "pending");
    pending.setAttribute("data-text", text);
    els.list.appendChild(pending);
    scrollDown();
    els.ta.value = "";
    els.ta.style.height = "auto";
    els.send.disabled = true;
    api("/api/widget/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (d) {
        if (!started) {
          started = true;
          set("started", "1");
          els.nameRow.style.display = "none";
        }
        if (d && d.id && !seen[d.id]) {
          seen[d.id] = true;
          pending.className = "m in";
          pending.removeAttribute("data-text");
          var t = el("span", "t");
          t.textContent = timeOf(d.createdAt);
          pending.appendChild(t);
        }
        schedule(1500);
      })
      .catch(function (err) {
        pending.className = "m in err";
        pending.removeAttribute("data-text");
        var t = el("span", "t");
        t.textContent = (err && err.message) || "Not sent";
        pending.appendChild(t);
      })
      .then(function () {
        els.send.disabled = false;
        els.ta.focus();
      });
  }

  function poll() {
    if (!started) return schedule();
    api("/api/widget/messages?visitorId=" + encodeURIComponent(visitorId) + "&after=" + (loadedOnce ? lastAt : 0))
      .then(function (d) {
        var n = addMessages((d && d.messages) || []);
        if (loadedOnce && !isOpen && n) {
          unread += n;
          setBadge();
        }
        loadedOnce = true;
      })
      .catch(function () {
        /* retry on next tick */
      })
      .then(function () {
        schedule();
      });
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    var wait = typeof ms === "number" ? ms : isOpen && !document.hidden ? OPEN_MS : CLOSED_MS;
    timer = setTimeout(poll, wait);
  }

  function init() {
    api("/api/widget/config")
      .then(function (c) {
        if (!c || !c.enabled) return;
        cfg = c;
        build();
        schedule(started ? 0 : CLOSED_MS);
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden && isOpen) schedule(0);
        });
      })
      .catch(function () {
        /* widget unavailable */
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
