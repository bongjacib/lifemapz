/*! LifeMapz — ultra-light Sortable helper (mouse + keyboard) */
(function (global) {
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches(sel)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function indexOf(el) {
    return Array.prototype.indexOf.call(el.parentNode.children, el);
  }

  function moveEl(parent, from, to) {
    if (to < 0 || to >= parent.children.length) return;
    const node = parent.children[from];
    const ref = parent.children[to];
    if (!node || !ref) return;
    parent.insertBefore(node, from < to ? ref.nextSibling : ref);
  }

  function getOrder(container, itemSelector) {
    return Array.from(container.querySelectorAll(itemSelector)).map((n) => n.dataset.id);
  }

  function getDragAfterElement(container, y, itemSelector) {
    const els = [...container.querySelectorAll(itemSelector + ':not(.dnd-dragging)')];
    return els
      .map(el => {
        const rect = el.getBoundingClientRect();
        return { el, offset: y - (rect.top + rect.height / 2) };
      })
      .filter(x => x.offset < 0)
      .sort((a, b) => b.offset - a.offset)[0]?.el || null;
  }

  function sortable(container, opts = {}) {
    const itemSelector = opts.items || '.lmz-card';
    const handleSelector = opts.handle || '.lmz-card-handle';
    const onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : function () {};
    let dragEl = null;
    let allowDragFromHandle = false;

    // Mark items focusable for keyboard reordering
    function armItems() {
      container.querySelectorAll(itemSelector).forEach((el) => {
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'listitem');
        el.setAttribute('aria-grabbed', 'false');
        el.draggable = true; // HTML5 drag (desktop)
      });
    }
    armItems();

    // Only start drag if the mousedown/touchstart came from the handle
    container.addEventListener('mousedown', (e) => {
      const h = closest(e.target, handleSelector);
      allowDragFromHandle = !!h;
    }, true);
    container.addEventListener('touchstart', (e) => {
      const t = e.targetTouches && e.targetTouches[0] ? e.targetTouches[0].target : e.target;
      const h = closest(t, handleSelector);
      allowDragFromHandle = !!h;
    }, { passive: true, capture: true });

    container.addEventListener('dragstart', (e) => {
      const card = closest(e.target, itemSelector);
      if (!card) return e.preventDefault();
      if (!allowDragFromHandle) return e.preventDefault();
      dragEl = card;
      card.classList.add('dnd-dragging');
      card.setAttribute('aria-grabbed', 'true');
      try { e.dataTransfer.setData('text/plain', card.dataset.id || ''); } catch {}
      e.dataTransfer.effectAllowed = 'move';
    });

    container.addEventListener('dragend', () => {
      if (!dragEl) return;
      dragEl.classList.remove('dnd-dragging');
      dragEl.setAttribute('aria-grabbed', 'false');
      dragEl = null;
      allowDragFromHandle = false;
      onUpdate(getOrder(container, itemSelector));
    });

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const after = getDragAfterElement(container, e.clientY, itemSelector);
      if (!dragEl) return;
      if (after == null) {
        container.appendChild(dragEl);
      } else {
        container.insertBefore(dragEl, after);
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      // handled by dragend
    });

    // Keyboard fallback: Alt+ArrowUp/Alt+ArrowDown
    container.addEventListener('keydown', (e) => {
      const card = closest(e.target, itemSelector);
      if (!card) return;
      if (!(e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return;
      e.preventDefault();
      const parent = card.parentElement;
      const from = indexOf(card);
      const to = e.key === 'ArrowUp' ? from - 1 : from + 1;
      moveEl(parent, from, to);
      card.focus();
      onUpdate(getOrder(container, itemSelector));
    });

    // Public refresh (if list re-rendered)
    return {
      refresh: armItems
    };
  }

  global.DND = { sortable };
})(window);
