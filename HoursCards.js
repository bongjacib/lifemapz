/*! LifeMapz — Hours view cards with drag + up/down controls */
(function (global) {
  function escapeHtml(txt) {
    const d = document.createElement('div');
    d.textContent = txt == null ? '' : String(txt);
    return d.innerHTML;
  }

  function timeInfo(ts) {
    if (global.app && typeof global.app.renderTimeInfo === 'function') {
      return global.app.renderTimeInfo(ts);
    }
    // minimal fallback
    let html = `<div class="task-time-info"><i class="fas fa-clock"></i> ${ts?.startTime || ''} - ${ts?.endTime || ''}`;
    if (ts?.date) {
      try { html += ` • ${new Date(ts.date).toLocaleDateString()}`; } catch {}
    }
    if (ts?.repeat && ts.repeat !== 'none') {
      html += ` • <span class="repeat-badge">${ts.repeat}</span>`;
    }
    html += `</div>`;
    return html;
  }

  function renderCard(t) {
    return `
      <div class="lmz-card task-item" data-id="${t.id}">
        <div class="lmz-card-handle" title="Drag to reorder" aria-label="Drag handle" style="cursor:grab;display:flex;align-items:center;justify-content:center;width:34px;min-width:34px;height:34px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-tertiary);">
          <i class="fas fa-grip-vertical"></i>
        </div>

        <div class="task-content" style="padding-left:8px;">
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-meta">${escapeHtml(t.description)}</div>` : ''}
          ${t.timeSettings ? timeInfo(t.timeSettings) : ''}
          ${t.cascadesTo && t.cascadesTo.length > 0
            ? `<div class="task-meta"><small>Cascades to: ${t.cascadesTo.join(', ')}</small></div>`
            : ''}
        </div>

        <div class="task-actions" style="display:flex;gap:6px;">
          <button class="task-btn lmz-move-up" title="Move up (Alt+↑)"><i class="fas fa-arrow-up"></i></button>
          <button class="task-btn lmz-move-down" title="Move down (Alt+↓)"><i class="fas fa-arrow-down"></i></button>
          <button class="task-btn lmz-edit" title="Edit"><i class="fas fa-edit"></i></button>
          <button class="task-btn lmz-delete" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  function bindCardControls(container, onReorder, onEdit, onDelete) {
    const list = container;

    function order() {
      return Array.from(list.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
    }

    list.addEventListener('click', (e) => {
      const card = e.target.closest('.lmz-card');
      if (!card) return;
      const id = card.dataset.id;

      if (e.target.closest('.lmz-edit')) {
        if (typeof onEdit === 'function') onEdit(id);
        return;
      }
      if (e.target.closest('.lmz-delete')) {
        if (typeof onDelete === 'function') onDelete(id);
        return;
      }
      if (e.target.closest('.lmz-move-up')) {
        const prev = card.previousElementSibling;
        if (prev) list.insertBefore(card, prev);
        if (typeof onReorder === 'function') onReorder(order());
        return;
      }
      if (e.target.closest('.lmz-move-down')) {
        const next = card.nextElementSibling;
        if (next) list.insertBefore(next, card);
        if (typeof onReorder === 'function') onReorder(order());
        return;
      }
    }, false);
  }

  const HoursCards = {
    /**
     * Mounts cards into the provided container.
     * @param {HTMLElement} container - the #hours-tasks container
     * @param {Array} tasks - already-filtered, already-ordered tasks for the selected Hours day
     * @param {Object} opts - { onReorder(ids), onEdit(id), onDelete(id) }
     */
    mount(container, tasks, opts = {}) {
      if (!container) return;
      if (!Array.isArray(tasks)) tasks = [];
      const html = tasks.map(renderCard).join('') || '<div class="empty-state">No tasks yet. Click + to add one.</div>';
      container.innerHTML = html;

      // Wire up button controls
      bindCardControls(container, opts.onReorder, opts.onEdit, opts.onDelete);

      // Enable drag & drop (desktop) + Alt+Arrow keyboard fallback
      if (window.DND && typeof window.DND.sortable === 'function') {
        HoursCards._sortable = window.DND.sortable(container, {
          items: '.lmz-card',
          handle: '.lmz-card-handle',
          onUpdate: (ids) => { if (typeof opts.onReorder === 'function') opts.onReorder(ids); }
        });
      }
    }
  };

  global.HoursCards = HoursCards;
})(window);
