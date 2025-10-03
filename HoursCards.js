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
          <button class="task-btn lmz-move-up" title="Move up (Alt+↑)" data-action="move-up"><i class="fas fa-arrow-up"></i></button>
          <button class="task-btn lmz-move-down" title="Move down (Alt+↓)" data-action="move-down"><i class="fas fa-arrow-down"></i></button>
          <button class="task-btn lmz-edit" title="Edit" data-action="edit"><i class="fas fa-edit"></i></button>
          <button class="task-btn lmz-delete" title="Delete" data-action="delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  }

  function bindCardControls(container, onReorder, onEdit, onDelete) {
    console.log('Binding card controls');
    
    function order() {
      return Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
    }

    // Use event delegation for better performance and reliability
    container.addEventListener('click', (e) => {
      const button = e.target.closest('.task-btn');
      if (!button) return;
      
      const card = button.closest('.lmz-card');
      if (!card) return;
      
      const id = card.dataset.id;
      const action = button.dataset.action;
      
      console.log('Button clicked:', action, 'for task:', id);
      
      e.stopPropagation();
      
      switch (action) {
        case 'move-up':
          console.log('Move up clicked');
          const prev = card.previousElementSibling;
          if (prev && prev.classList.contains('lmz-card')) {
            container.insertBefore(card, prev);
            if (typeof onReorder === 'function') {
              onReorder(order());
            }
          }
          break;
          
        case 'move-down':
          console.log('Move down clicked');
          const next = card.nextElementSibling;
          if (next && next.classList.contains('lmz-card')) {
            container.insertBefore(next, card);
            if (typeof onReorder === 'function') {
              onReorder(order());
            }
          }
          break;
          
        case 'edit':
          console.log('Edit clicked');
          if (typeof onEdit === 'function') {
            onEdit(id);
          }
          break;
          
        case 'delete':
          console.log('Delete clicked');
          if (typeof onDelete === 'function') {
            onDelete(id);
          }
          break;
      }
    });

    // Also handle Alt+Arrow keyboard shortcuts
    container.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      
      const card = e.target.closest('.lmz-card');
      if (!card) return;
      
      e.preventDefault();
      
      if (e.key === 'ArrowUp') {
        const prev = card.previousElementSibling;
        if (prev && prev.classList.contains('lmz-card')) {
          container.insertBefore(card, prev);
          if (typeof onReorder === 'function') {
            onReorder(order());
          }
        }
      } else if (e.key === 'ArrowDown') {
        const next = card.nextElementSibling;
        if (next && next.classList.contains('lmz-card')) {
          container.insertBefore(next, card);
          if (typeof onReorder === 'function') {
            onReorder(order());
          }
        }
      }
    });
  }

  const HoursCards = {
    /**
     * Mounts cards into the provided container.
     * @param {HTMLElement} container - the #hours-tasks container
     * @param {Array} tasks - already-filtered, already-ordered tasks for the selected Hours day
     * @param {Object} opts - { onReorder(ids), onEdit(id), onDelete(id) }
     */
    mount(container, tasks, opts = {}) {
      if (!container) {
        console.warn('HoursCards: container not found');
        return;
      }
      
      if (!Array.isArray(tasks)) {
        console.warn('HoursCards: tasks must be an array');
        tasks = [];
      }
      
      console.log('HoursCards: mounting', tasks.length, 'tasks with options:', opts);
      
      const html = tasks.map(renderCard).join('') || '<div class="empty-state">No tasks yet. Click + to add one.</div>';
      container.innerHTML = html;

      // Wire up button controls
      bindCardControls(container, opts.onReorder, opts.onEdit, opts.onDelete);

      // Enable drag & drop (desktop) + Alt+Arrow keyboard fallback
      if (window.DnD && typeof window.DnD.list === 'function') {
        console.log('HoursCards: enabling DnD');
        HoursCards._sortable = window.DnD.list(container, {
          itemSelector: '.lmz-card',
          handleSelector: '.lmz-card-handle',
          onReorder: (data) => { 
            console.log('HoursCards: reorder', data);
            if (typeof opts.onReorder === 'function') {
              const ids = Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
              opts.onReorder(ids);
            }
          }
        });
      } else {
        console.warn('HoursCards: DnD not available');
      }
      
      return HoursCards;
    },

    /**
     * Clean up and destroy the HoursCards instance
     */
    destroy() {
      if (HoursCards._sortable && typeof HoursCards._sortable.destroy === 'function') {
        HoursCards._sortable.destroy();
        HoursCards._sortable = null;
      }
    }
  };

  // Export to global scope
  global.HoursCards = HoursCards;
})(window);