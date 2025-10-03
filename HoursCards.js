/*! LifeMapz — Hours view cards with drag + up/down controls */
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
          <button class="task-btn lmz-move-up" title="Move up (Alt+↑)" data-action="move-up" onclick="window.HoursCards._handleButtonClick(this)"><i class="fas fa-arrow-up"></i></button>
          <button class="task-btn lmz-move-down" title="Move down (Alt+↓)" data-action="move-down" onclick="window.HoursCards._handleButtonClick(this)"><i class="fas fa-arrow-down"></i></button>
          <button class="task-btn lmz-edit" title="Edit" data-action="edit" onclick="window.HoursCards._handleButtonClick(this)"><i class="fas fa-edit"></i></button>
          <button class="task-btn lmz-delete" title="Delete" data-action="delete" onclick="window.HoursCards._handleButtonClick(this)"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  const HoursCards = {
    _currentCallbacks: null,
    _currentContainer: null,

    _handleButtonClick(button) {
      console.log('ONCLICK HANDLER:', button.dataset.action);
      if (!HoursCards._currentCallbacks) {
        console.error('No callbacks registered');
        return;
      }

      const card = button.closest('.lmz-card');
      if (!card) {
        console.error('No card found');
        return;
      }

      const id = card.dataset.id;
      const action = button.dataset.action;

      switch(action) {
        case 'move-up':
          const prev = card.previousElementSibling;
          if (prev && prev.classList.contains('lmz-card')) {
            HoursCards._currentContainer.insertBefore(card, prev);
            if (typeof HoursCards._currentCallbacks.onReorder === 'function') {
              const ids = Array.from(HoursCards._currentContainer.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              HoursCards._currentCallbacks.onReorder(ids);
            }
          }
          break;

        case 'move-down':
          const next = card.nextElementSibling;
          if (next && next.classList.contains('lmz-card')) {
            HoursCards._currentContainer.insertBefore(next, card);
            if (typeof HoursCards._currentCallbacks.onReorder === 'function') {
              const ids = Array.from(HoursCards._currentContainer.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              HoursCards._currentCallbacks.onReorder(ids);
            }
          }
          break;

        case 'edit':
          if (typeof HoursCards._currentCallbacks.onEdit === 'function') {
            HoursCards._currentCallbacks.onEdit(id);
          }
          break;

        case 'delete':
          if (typeof HoursCards._currentCallbacks.onDelete === 'function') {
            HoursCards._currentCallbacks.onDelete(id);
          }
          break;
      }
    },

    mount(container, tasks, opts = {}) {
      if (!container) {
        console.warn('HoursCards: container not found');
        return;
      }
      
      if (!Array.isArray(tasks)) {
        console.warn('HoursCards: tasks must be an array');
        tasks = [];
      }
      
      console.log('HoursCards: mounting', tasks.length, 'tasks');
      
      // Store callbacks and container for onclick handlers
      HoursCards._currentCallbacks = {
        onReorder: opts.onReorder,
        onEdit: opts.onEdit,
        onDelete: opts.onDelete
      };
      HoursCards._currentContainer = container;
      
      const html = tasks.map(renderCard).join('') || '<div class="empty-state">No tasks yet. Click + to add one.</div>';
      container.innerHTML = html;

      // Enable drag & drop
      if (window.DnD && typeof window.DnD.list === 'function') {
        console.log('HoursCards: enabling DnD');
        HoursCards._sortable = window.DnD.list(container, {
          itemSelector: '.lmz-card',
          handleSelector: '.lmz-card-handle',
          onReorder: (data) => { 
            console.log('HoursCards: DnD reorder', data);
            if (typeof opts.onReorder === 'function') {
              const ids = Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              opts.onReorder(ids);
            }
          }
        });
      }
      
      return HoursCards;
    },

    destroy() {
      HoursCards._currentCallbacks = null;
      HoursCards._currentContainer = null;
      if (HoursCards._sortable && typeof HoursCards._sortable.destroy === 'function') {
        HoursCards._sortable.destroy();
        HoursCards._sortable = null;
      }
    }
  };

  global.HoursCards = HoursCards;
})(window);