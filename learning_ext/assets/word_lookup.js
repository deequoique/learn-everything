(function () {
  function installWordLookup() {
    if (window.__leWordLookupInstalled) return;
    window.__leWordLookupInstalled = true;

    var popupId = "le-lookup-popup";
    var courseSelector = "#le-guide-md, #le-center-content, .le-lookup-zone";
    var readyMarker = document.getElementById("le-word-lookup-ready");
    if (!readyMarker) {
      readyMarker = document.createElement("div");
      readyMarker.id = "le-word-lookup-ready";
      readyMarker.style.display = "none";
      document.documentElement.appendChild(readyMarker);
    }

    function nodeElement(node) {
      if (!node) return null;
      return node.nodeType === 1 ? node : node.parentElement;
    }

    function normalizeSelection() {
      var selection = window.getSelection ? window.getSelection() : null;
      var text = selection ? selection.toString().trim().replace(/\s+/g, " ") : "";
      return { selection: selection, text: text };
    }

    function selectionIsInCourse(selection, eventTarget) {
      var target = eventTarget && eventTarget.closest ? eventTarget : nodeElement(eventTarget);
      var anchor = nodeElement(selection && selection.anchorNode);
      var focus = nodeElement(selection && selection.focusNode);
      return Boolean(
        (target && target.closest && target.closest(courseSelector)) ||
        (anchor && anchor.closest && anchor.closest(courseSelector)) ||
        (focus && focus.closest && focus.closest(courseSelector))
      );
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (ch) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[ch];
      });
    }

    function ensurePopup() {
      var popup = document.getElementById(popupId);
      if (popup) return popup;
      popup = document.createElement("div");
      popup.id = popupId;
      popup.style.cssText = [
        "position:fixed",
        "z-index:99999",
        "display:none",
        "max-width:280px",
        "padding:12px",
        "border:1px solid #E5E7EB",
        "border-radius:8px",
        "background:#FFFFFF",
        "color:#111827",
        "box-shadow:0 12px 28px rgba(0,0,0,0.18)",
        "font:13px/1.45 -apple-system,BlinkMacSystemFont,\"Microsoft YaHei\",sans-serif",
      ].join(";");
      document.body.appendChild(popup);
      return popup;
    }

    function setNativeValue(input, value) {
      var proto = input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) descriptor.set.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function expandTermResult() {
      var panel = document.getElementById("le-term-result");
      if (!panel) return;
      var button = panel.querySelector("button.label-wrap, button");
      var body = button ? button.nextElementSibling : null;
      if (button && body && window.getComputedStyle(body).display === "none") {
        button.click();
      }
    }

    function triggerExplain(term) {
      var input = document.querySelector("#le-selected-term textarea, #le-selected-term input");
      if (!input) return;
      setNativeValue(input, "");
      window.setTimeout(function () {
        setNativeValue(input, term);
        expandTermResult();
      }, 30);
    }

    function hidePopup() {
      var popup = document.getElementById(popupId);
      if (popup) popup.style.display = "none";
    }

    document.addEventListener("mousedown", function (event) {
      var popup = document.getElementById(popupId);
      if (popup && !popup.contains(event.target)) hidePopup();
    });

    document.addEventListener("mouseup", function (event) {
      window.setTimeout(function () {
        var current = normalizeSelection();
        if (
          !current.text ||
          current.text.length > 80 ||
          !selectionIsInCourse(current.selection, event.target)
        ) {
          hidePopup();
          return;
        }

        var popup = ensurePopup();
        var safeText = current.text.length > 24
          ? current.text.slice(0, 24) + "..."
          : current.text;
        popup.innerHTML = ""
          + '<div style="font-weight:700;margin-bottom:4px;">是否需要名词解释？</div>'
          + '<div style="color:#4B5563;margin-bottom:10px;">' + escapeHtml(safeText) + "</div>"
          + '<div style="display:flex;gap:8px;align-items:center;">'
          + '<button type="button" data-le-lookup-confirm="1" style="border:0;border-radius:6px;background:#4F46E5;color:white;padding:6px 10px;font-weight:700;cursor:pointer;">解释这个名词</button>'
          + '<button type="button" data-le-lookup-cancel="1" style="border:1px solid #E5E7EB;border-radius:6px;background:white;color:#374151;padding:6px 10px;cursor:pointer;">取消</button>'
          + "</div>";
        popup.querySelector("[data-le-lookup-confirm]").onclick = function () {
          triggerExplain(current.text);
          hidePopup();
        };
        popup.querySelector("[data-le-lookup-cancel]").onclick = hidePopup;

        var x = Math.min(event.clientX + 12, window.innerWidth - 300);
        var y = Math.min(event.clientY + 12, window.innerHeight - 120);
        popup.style.left = Math.max(8, x) + "px";
        popup.style.top = Math.max(8, y) + "px";
        popup.style.display = "block";
      }, 0);
    });
  }

  window.__leInstallWordLookup = installWordLookup;
  installWordLookup();
})();
