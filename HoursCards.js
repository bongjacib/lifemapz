/*! LifeMapz — Hours view cards with drag + up/down controls - INLINE ONCLICK VERSION */
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
          <button class="task-btn lmz-move-up" title="Move up (Alt+↑)" data-action="move-up" onclick="window.HoursCards.handleButtonClick(this)"><i class="fas fa-arrow-up"></i></button>
          <button class="task-btn lmz-move-down" title="Move down (Alt+↓)" data-action="move-down" onclick="window.HoursCards.handleButtonClick(this)"><i class="fas fa-arrow-down"></i></button>
          <button class="task-btn lmz-edit" title="Edit" data-action="edit" onclick="window.HoursCards.handleButtonClick(this)"><i class="fas fa-edit"></i></button>
          <button class="task-btn lmz-delete" title="Delete" data-action="delete" onclick="window.HoursCards.handleButtonClick(this)"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  // Global callback storage
  const HoursCardsCallbacks = {
    onReorder: null,
    onEdit: null,
    onDelete: null,
    container: null
  };

  // Global click handler - this will always be available
  function handleButtonClick(button) {
    console.log('HOURSCARDS BUTTON CLICKED:', button.dataset.action);
    
    if (!HoursCardsCallbacks.container) {
      console.error('HoursCards: No container registered');
      return;
    }

    const card = button.closest('.lmz-card');
    if (!card) {
      console.error('HoursCards: No card found for button');
      return;
    }

    const id = card.dataset.id;
    const action = button.dataset.action;

    console.log('Processing action:', action, 'for task:', id);

    switch(action) {
      case 'move-up':
        console.log('Moving task up');
        const prev = card.previousElementSibling;
        if (prev && prev.classList.contains('lmz-card')) {
          HoursCardsCallbacks.container.insertBefore(card, prev);
          if (typeof HoursCardsCallbacks.onReorder === 'function') {
            const ids = Array.from(HoursCardsCallbacks.container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
            HoursCardsCallbacks.onReorder(ids);
          }
        }
        break;

      case 'move-down':
        console.log('Moving task down');
        const next = card.nextElementSibling;
        if (next && next.classList.contains('lmz-card')) {
          HoursCardsCallbacks.container.insertBefore(next, card);
          if (typeof HoursCardsCallbacks.onReorder === 'function') {
            const ids = Array.from(HoursCardsCallbacks.container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
            HoursCardsCallbacks.onReorder(ids);
          }
        }
        break;

      case 'edit':
        console.log('Editing task:', id);
        if (typeof HoursCardsCallbacks.onEdit === 'function') {
          HoursCardsCallbacks.onEdit(id);
        } else {
          console.error('HoursCards: onEdit callback not available');
        }
        break;

      case 'delete':
        console.log('Deleting task:', id);
        if (typeof HoursCardsCallbacks.onDelete === 'function') {
          HoursCardsCallbacks.onDelete(id);
        } else {
          console.error('HoursCards: onDelete callback not available');
        }
        break;
    }
  }

  const HoursCards = {
    handleButtonClick: handleButtonClick,

    mount(container, tasks, opts = {}) {
      if (!container) {
        console.warn('HoursCards: container not found');
        return;
      }
      
      if (!Array.isArray(tasks)) {
        console.warn('HoursCards: tasks must be an array');
        tasks = [];
      }
      
      console.log('HoursCards: mounting', tasks.length, 'tasks with callbacks:', {
        hasOnReorder: typeof opts.onReorder === 'function',
        hasOnEdit: typeof opts.onEdit === 'function',
        hasOnDelete: typeof opts.onDelete === 'function'
      });
      
      // Store callbacks and container globally
      HoursCardsCallbacks.onReorder = opts.onReorder || null;
      HoursCardsCallbacks.onEdit = opts.onEdit || null;
      HoursCardsCallbacks.onDelete = opts.onDelete || null;
      HoursCardsCallbacks.container = container;
      
      const html = tasks.map(renderCard).join('') || '<div class="empty-state">No tasks yet. Click + to add one.</div>';
      container.innerHTML = html;

      console.log('HoursCards: buttons should have onclick handlers now');

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
      HoursCardsCallbacks.onReorder = null;
      HoursCardsCallbacks.onEdit = null;
      HoursCardsCallbacks.onDelete = null;
      HoursCardsCallbacks.container = null;
      if (HoursCards._sortable && typeof HoursCards._sortable.destroy === 'function') {
        HoursCards._sortable.destroy();
        HoursCards._sortable = null;
      }
    }
  };

  global.HoursCards = HoursCards;
  console.log('HoursCards loaded with inline onclick support');
})(window);