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
    console.log('Binding card controls with callbacks:', {
      hasOnReorder: typeof onReorder === 'function',
      hasOnEdit: typeof onEdit === 'function', 
      hasOnDelete: typeof onDelete === 'function'
    });

    function order() {
      return Array.from(container.querySelectorAll('.lmz-card')).map(n => n.dataset.id);
    }

    // Use a single event listener for the container
    container.addEventListener('click', function(e) {
      console.log('=== CLICK EVENT ===');
      console.log('Clicked element:', e.target);
      console.log('Button element:', e.target.closest('.task-btn'));
      
      const button = e.target.closest('.task-btn');
      if (!button) {
        console.log('No button found');
        return;
      }
      
      const card = button.closest('.lmz-card');
      if (!card) {
        console.log('No card found');
        return;
      }
      
      const id = card.dataset.id;
      const action = button.dataset.action;
      
      console.log('Action:', action, 'Task ID:', id);
      
      e.preventDefault();
      e.stopPropagation();
      
      switch (action) {
        case 'move-up':
          console.log('Processing move-up');
          const prev = card.previousElementSibling;
          if (prev && prev.classList.contains('lmz-card')) {
            container.insertBefore(card, prev);
            if (typeof onReorder === 'function') {
              console.log('Calling onReorder');
              onReorder(order());
            }
          }
          break;
          
        case 'move-down':
          console.log('Processing move-down');
          const next = card.nextElementSibling;
          if (next && next.classList.contains('lmz-card')) {
            container.insertBefore(next, card);
            if (typeof onReorder === 'function') {
              console.log('Calling onReorder');
              onReorder(order());
            }
          }
          break;
          
        case 'edit':
          console.log('Processing edit, calling onEdit with id:', id);
          if (typeof onEdit === 'function') {
            onEdit(id);
          } else {
            console.error('onEdit is not a function!');
          }
          break;
          
        case 'delete':
          console.log('Processing delete, calling onDelete with id:', id);
          if (typeof onDelete === 'function') {
            onDelete(id);
          } else {
            console.error('onDelete is not a function!');
          }
          break;
          
        default:
          console.log('Unknown action:', action);
      }
    });
  }

  const HoursCards = {
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
      
      const html = tasks.map(renderCard).join('') || '<div class="empty-state">No tasks yet. Click + to add one.</div>';
      container.innerHTML = html;

      // Wire up button controls with the provided options
      bindCardControls(container, opts.onReorder, opts.onEdit, opts.onDelete);

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
      if (HoursCards._sortable && typeof HoursCards._sortable.destroy === 'function') {
        HoursCards._sortable.destroy();
        HoursCards._sortable = null;
      }
    }
  };

  global.HoursCards = HoursCards;
})(window);