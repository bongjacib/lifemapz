// In hours-fix.js - add at the top:
console.log('🔧 hours-fix.js loading...');
/*! hours-fix.js — Fixes Hours view edit/delete buttons */
(function () {
  'use strict';
  
  function fixHoursView() {
    console.log('Applying Hours view fixes...');
    
    // Fix 1: Ensure proper event delegation for action buttons
    const hoursContainer = document.getElementById('hours-tasks');
    if (!hoursContainer) {
      console.warn('Hours container not found');
      return;
    }
    
    // Remove any existing click listeners and re-add with proper delegation
    hoursContainer.removeEventListener('click', handleHoursClick);
    hoursContainer.addEventListener('click', handleHoursClick);
    
    // Fix 2: Ensure drag handlers don't interfere with button clicks
    const cards = hoursContainer.querySelectorAll('.lmz-card, .task-item');
    cards.forEach(card => {
      const buttons = card.querySelectorAll('.task-btn, [data-action]');
      buttons.forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          e.preventDefault();
        });
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          handleActionButtonClick(e);
        });
      });
    });
    
    console.log('Hours view fixes applied');
  }
  
  function handleHoursClick(e) {
    const btn = e.target.closest('.task-btn[data-action]') || 
                e.target.closest('.task-btn') ||
                e.target.closest('[data-action]');
    
    if (!btn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    handleActionButtonClick(e);
  }
  
  function handleActionButtonClick(e) {
    const btn = e.target.closest('.task-btn[data-action]') || 
                e.target.closest('.task-btn') ||
                e.target.closest('[data-action]');
    
    if (!btn) return;
    
    const card = btn.closest('.lmz-card') || btn.closest('.task-item');
    if (!card) return;
    
    const taskId = card.dataset.id;
    const action = btn.dataset.action || 
                  (btn.classList.contains('lmz-edit') ? 'edit' :
                   btn.classList.contains('lmz-delete') ? 'delete' : null);
    
    console.log('Action clicked:', action, 'Task ID:', taskId);
    
    if (!action || !taskId) return;
    
    if (action === 'edit' && window.app && window.app.editTask) {
      window.app.editTask(taskId);
    } else if (action === 'delete' && window.app && window.app.deleteTask) {
      window.app.deleteTask(taskId);
    }
  }
  
  // Apply fixes when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixHoursView);
  } else {
    fixHoursView();
  }
  
  // Also fix the HoursCards component directly
  if (window.HoursCards && window.HoursCards.mount) {
    const originalMount = window.HoursCards.mount;
    window.HoursCards.mount = function(container, tasks, opts = {}) {
      const result = originalMount.call(this, container, tasks, opts);
      
      // Enhanced click handling for HoursCards
      if (container && opts.onEdit && opts.onDelete) {
        container.removeEventListener('click', handleHoursCardsClick);
        container.addEventListener('click', handleHoursCardsClick);
      }
      
      return result;
    };
  }
  
  function handleHoursCardsClick(e) {
    const btn = e.target.closest('.task-btn[data-action]');
    if (!btn) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const card = btn.closest('.lmz-card');
    if (!card) return;
    
    const taskId = card.dataset.id;
    const action = btn.dataset.action;
    
    console.log('HoursCards action:', action, 'id:', taskId);
    
    if (!action || !taskId) return;
    
    // Find the app instance and call the appropriate method
    if (window.app) {
      if (action === 'edit' && window.app.editTask) {
        window.app.editTask(taskId);
      } else if (action === 'delete' && window.app.deleteTask) {
        window.app.deleteTask(taskId);
      }
    }
  }
  
  // Re-apply fixes when views change (for SPA navigation)
  const originalSwitchView = window.LifeMapzApp?.prototype?.switchView;
  if (originalSwitchView) {
    window.LifeMapzApp.prototype.switchView = function(viewName) {
      const result = originalSwitchView.call(this, viewName);
      
      // Re-apply hours fixes when switching to horizons view
      if (viewName === 'horizons') {
        setTimeout(fixHoursView, 100);
      }
      
      return result;
    };
  }
  
  console.log('Hours view fix loaded ✅');
})();