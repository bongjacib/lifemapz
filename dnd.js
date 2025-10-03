/* Lightweight drag & drop list helper (mouse, touch, keyboard)
   Exposes: window.DnD.list(container, { itemSelector, handleSelector, onReorder })
   v1.1.0 — STRICT handle-only start (no fallback), never preventDefault unless dragging
*/
(function (root) {
  function list(container, {
    itemSelector = ".task-item",
    handleSelector = "[data-drag-handle]",
    onReorder = null
  } = {}) {
    const el = typeof container === "string" ? document.querySelector(container) : container;
    if (!el) return { destroy() {} };

    const items = () => Array.from(el.querySelectorAll(itemSelector));
    const indexOf = (node) => items().indexOf(node);

    let dragEl = null, placeholder = null, startIndex = -1, offsetY = 0;

    function moveAt(clientY) {
      const y = clientY - offsetY + window.scrollY;
      dragEl.style.top = `${y}px`;
      dragEl.style.left = `${placeholder.getBoundingClientRect().left}px`;
    }

    function onPointerDown(e) {
      // STRICT: only begin drag if the pointer is on the handle
      const handle = e.target.closest(handleSelector);
      if (!handle) return;

      dragEl = handle.closest(itemSelector);
      if (!dragEl) return;

      // Begin dragging
      if (e.cancelable) e.preventDefault();

      const pointY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = dragEl.getBoundingClientRect();
      offsetY = pointY - rect.top;
      startIndex = indexOf(dragEl);

      // visual state
      placeholder = document.createElement("div");
      placeholder.className = "drag-placeholder";
      placeholder.style.height = `${rect.height}px`;
      dragEl.after(placeholder);

      dragEl.classList.add("dragging");
      dragEl.style.position = "absolute";
      dragEl.style.width = `${rect.width}px`;
      dragEl.style.zIndex = "1000";
      dragEl.style.pointerEvents = "none";
      moveAt(pointY);

      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("touchmove", onPointerMove, { passive: false });
      document.addEventListener("touchend", onPointerUp);
    }

    function onPointerMove(e) {
      if (!dragEl) return;
      if (e.cancelable) e.preventDefault();
      const pointY = e.touches ? e.touches[0].clientY : e.clientY;
      moveAt(pointY);

      const siblings = items().filter(n => n !== dragEl);
      let target = null, before = true;
      for (const sib of siblings) {
        const r = sib.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        if (pointY < mid) { target = sib; before = true; break; }
        target = sib; before = false;
      }

      if (!target) el.appendChild(placeholder);
      else if (before) el.insertBefore(placeholder, target);
      else target.after(placeholder);
    }

    function onPointerUp(e) {
      if (!dragEl) return;

      // finalize
      placeholder.replaceWith(dragEl);
      dragEl.classList.remove("dragging");
      dragEl.style.cssText = "";
      const endIndex = indexOf(dragEl);

      // cleanup
      placeholder = null;
      dragEl = null;

      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("touchmove", onPointerMove);
      document.removeEventListener("touchend", onPointerUp);

      if (typeof onReorder === "function" && startIndex !== endIndex && startIndex !== -1 && endIndex !== -1) {
        onReorder({ from: startIndex, to: endIndex, ids: items().map(n => n.dataset.id) });
      }
      startIndex = -1;
    }

    // Keyboard support (unchanged)
    el.addEventListener("keydown", (e) => {
      if (!(e.target && e.target.closest(itemSelector))) return;
      if (!(e.key === "ArrowUp" || e.key === "ArrowDown")) return;
      const row = e.target.closest(itemSelector);
      if (!row) return;
      e.preventDefault();

      const arr = items();
      const i = indexOf(row);
      const j = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return;

      if (e.key === "ArrowUp") arr[j].before(row); else arr[j].after(row);
      onReorder && onReorder({ from: i, to: j, ids: items().map(n => n.dataset.id) });
      row.focus();
    });

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("touchstart", onPointerDown, { passive: false });

    return {
      destroy() {
        el.removeEventListener("pointerdown", onPointerDown);
        el.removeEventListener("touchstart", onPointerDown);
      }
    };
  }

  // expose global
  root.DnD = { list };
})(window);
