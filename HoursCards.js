/*! LifeMapz — Hours view cards with drag + up/down controls - FIXED + DELEGATED */
(function (global) {
  'use strict';

  function escapeHtml(txt) {
    const d = document.createElement('div');
    d.textContent = txt == null ? '' : String(txt);
    return d.innerHTML;
  }

  function timeInfo(ts) {
    if (global.app && typeof global.app.renderTimeInfo === 'function') {
      return global.app.renderTimeInfo(ts);
    }
    let html = `<div class="task-time-info"><i class="fas fa-clock"></i> ${ts?.startTime || ''} - ${ts?.endTime || ''}`;
    if (ts?.date) { try { html += ` • ${new Date(ts.date).toLocaleDateString()}`; } catch {} }
    if (ts?.repeat && ts.repeat !== 'none') html += ` • <span class="repeat-badge">${ts.repeat}</span>`;
    html += `</div>`;
    return html;
  }

  function renderCard(t) {
    return `
      <div class="lmz-card task-item" data-id="${t.id}">
        <div class="lmz-card-handle" title="Drag to reorder" aria-label="Drag handle"
             style="cursor:grab;display:flex;align-items:center;justify-content:center;width:34px;min-width:34px;height:34px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-tertiary);">
          <i class="fas fa-grip-vertical"></i>
        </div>

        <div class="task-content" style="padding-left:8px;">
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-meta">${escapeHtml(t.description)}</div>` : ''}
          ${t.timeSettings ? timeInfo(t.timeSettings) : ''}
          ${t.cascadesTo && t.cascadesTo.length > 0 ? `<div class="task-meta"><small>Cascades to: ${t.cascadesTo.join(', ')}</small></div>` : ''}
        </div>

        <div class="task-actions" style="display:flex;gap:6px;">
          <button type="button" class="task-btn lmz-move-up"   title="Move up (Alt+↑)"   data-action="move-up"><i class="fas fa-arrow-up"></i></button>
          <button type="button" class="task-btn lmz-move-down" title="Move down (Alt+↓)" data-action="move-down"><i class="fas fa-arrow-down"></i></button>
          <button type="button" class="task-btn lmz-edit"      title="Edit"              data-action="edit"><i class="fas fa-edit"></i></button>
          <button type="button" class="task-btn lmz-delete"    title="Delete"            data-action="delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  const HoursCards = {
    _container: null,
    _onClick: null,
    _sortable: null,

    mount(container, tasks, opts = {}) {
      if (!container) { console.warn('HoursCards: container not found'); return; }
      if (!Array.isArray(tasks)) tasks = [];

      // Clean up any previous instance
      this.unmount();

      this._container = container;

      // Render
      container.innerHTML = tasks.map(renderCard).join('') || '<div class="empty-state">No tasks yet. Click + to add one.</div>';

      // Delegated click handler (CSP-safe, minimal bindings)
      this._onClick = (e) => {
        const btn = e.target.closest('.task-btn[data-action]');
        if (!btn || !container.contains(btn)) return;
        e.preventDefault();
        e.stopPropagation();

        const card = btn.closest('.lmz-card');
        if (!card) return;

        const action = btn.dataset.action;
        const id = card.dataset.id;

        if (action === 'move-up') {
          const prev = card.previousElementSibling;
          if (prev && prev.classList.contains('lmz-card')) {
            container.insertBefore(card, prev);
            if (typeof opts.onReorder === 'function') {
              const ids = Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              opts.onReorder(ids);
            }
          }
        } else if (action === 'move-down') {
          const next = card.nextElementSibling;
          if (next && next.classList.contains('lmz-card')) {
            container.insertBefore(next, card);
            if (typeof opts.onReorder === 'function') {
              const ids = Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              opts.onReorder(ids);
            }
          }
        } else if (action === 'edit') {
          if (typeof opts.onEdit === 'function') opts.onEdit(id);
        } else if (action === 'delete') {
          if (typeof opts.onDelete === 'function') opts.onDelete(id);
        }
      };
      container.addEventListener('click', this._onClick);

      // Enable drag & drop if available
      if (window.DnD && typeof window.DnD.list === 'function') {
        this._sortable = window.DnD.list(container, {
          itemSelector: '.lmz-card',
          handleSelector: '.lmz-card-handle',
          onReorder: () => {
            if (typeof opts.onReorder === 'function') {
              const ids = Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              opts.onReorder(ids);
            }
          }
        });
      }

      return this;
    },

    unmount() {
      if (this._container && this._onClick) {
        this._container.removeEventListener('click', this._onClick);
      }
      this._onClick = null;
      if (this._sortable && typeof this._sortable.destroy === 'function') {
        this._sortable.destroy();
      }
      this._sortable = null;
      this._container = null;
    },

    destroy() { this.unmount(); }
  };

  global.HoursCards = HoursCards;
  console.log('HoursCards loaded (fixed, delegated, buttons are type="button")');
})(window);
