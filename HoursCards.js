/*! LifeMapz — Hours view cards with STRICT drag boundaries + fixed actions */
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
      <div class="lmz-card task-item" data-id="${t.id}" draggable="false">
        <!-- DRAG HANDLE ONLY - strict boundaries -->
        <div class="lmz-card-handle" 
             title="Drag to reorder" 
             aria-label="Drag handle"
             data-drag-handle="true"
             style="cursor:grab;display:flex;align-items:center;justify-content:center;width:34px;min-width:34px;height:34px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-tertiary);user-select:none;touch-action:none;">
          <i class="fas fa-grip-vertical" style="pointer-events:none;"></i>
        </div>

        <div class="task-content" style="padding-left:8px;flex:1;">
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${t.description ? `<div class="task-meta">${escapeHtml(t.description)}</div>` : ''}
          ${t.timeSettings ? timeInfo(t.timeSettings) : ''}
          ${t.cascadesTo && t.cascadesTo.length > 0 ? `<div class="task-meta"><small>Cascades to: ${t.cascadesTo.join(', ')}</small></div>` : ''}
        </div>

        <!-- ACTION BUTTONS - non-draggable, strict boundaries -->
        <div class="task-actions" style="display:flex;gap:6px;" draggable="false">
          <button type="button" class="task-btn lmz-move-up" draggable="false" title="Move up (Alt+↑)" data-action="move-up" style="user-select:none;pointer-events:auto;">
            <i class="fas fa-arrow-up"></i>
          </button>
          <button type="button" class="task-btn lmz-move-down" draggable="false" title="Move down (Alt+↓)" data-action="move-down" style="user-select:none;pointer-events:auto;">
            <i class="fas fa-arrow-down"></i>
          </button>
          <button type="button" class="task-btn lmz-edit" draggable="false" title="Edit" data-action="edit" style="user-select:none;pointer-events:auto;">
            <i class="fas fa-edit"></i>
          </button>
          <button type="button" class="task-btn lmz-delete" draggable="false" title="Delete" data-action="delete" style="user-select:none;pointer-events:auto;">
            <i class="fas fa-trash"></i>
          </button>
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

      // FIXED: Proper delegated click handler for action buttons
      this._onClick = (e) => {
        // Only handle clicks on action buttons, NOT the drag handle
        const btn = e.target.closest('.task-btn[data-action]');
        if (!btn || !container.contains(btn)) return;
        
        e.preventDefault();
        e.stopPropagation();

        const card = btn.closest('.lmz-card');
        if (!card) return;

        const action = btn.dataset.action;
        const id = card.dataset.id;

        console.log('HoursCards action:', action, 'id:', id);

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
          if (typeof opts.onEdit === 'function') {
            opts.onEdit(id);
          } else {
            console.warn('HoursCards: onEdit callback not provided');
          }
        } else if (action === 'delete') {
          if (typeof opts.onDelete === 'function') {
            opts.onDelete(id);
          } else {
            console.warn('HoursCards: onDelete callback not provided');
          }
        }
      };
      
      container.addEventListener('click', this._onClick);

      // Enable drag & drop with STRICT handle-only behavior
      if (window.DnD && typeof window.DnD.list === 'function') {
        this._sortable = window.DnD.list(container, {
          itemSelector: '.lmz-card',
          handleSelector: '.lmz-card-handle', // ONLY the handle can initiate drag
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

      if (this._sortable && typeof this._sortable.destroy === 'function') {
        this._sortable.destroy();
      }
      this._sortable = null;
      this._container = null;
    },

    destroy() { this.unmount(); }
  };

  global.HoursCards = HoursCards;
  console.log('HoursCards loaded (strict drag boundaries, fixed actions)');
})(window);