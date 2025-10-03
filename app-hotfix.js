
/*! app-hotfix.js — fixes edit/delete tasks and drag helper typos */
(function () {
  'use strict';
  if (!window.LifeMapzApp || !window.LifeMapzApp.prototype) {
    console.warn('app-hotfix: LifeMapzApp not found; load this after app.js');
    return;
  }
  const P = window.LifeMapzApp.prototype;

  // 1) Fix _getDragAfterElement (bad selector usage in original)
  P._getDragAfterElement = function (container, y) {
    const items = Array.from(container.querySelectorAll(".task-item:not(.dragging)"));
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  };

  // 2) Fix openTaskModal spread typo + ensure cascade checkboxes are correct
  P.openTaskModal = function (taskData = {}) {
    const isEdit = !!taskData.id;

    const titleEl = document.getElementById("task-modal-title");
    const submitText = document.getElementById("task-submit-text");
    if (titleEl) titleEl.textContent = isEdit ? "Edit Task" : "Add Task";
    if (submitText) submitText.textContent = isEdit ? "Update Task" : "Add Task";

    // fixed: spread taskData correctly
    this.currentTaskTimeData = { ...taskData };

    if (isEdit) {
      document.getElementById("edit-task-id").value = taskData.id;
      document.getElementById("task-title").value = taskData.title || "";
      document.getElementById("task-description").value = taskData.description || "";
      document.getElementById("task-horizon").value = taskData.horizon || "hours";
      document.getElementById("task-priority").value = taskData.priority || "medium";

      // Fill cascade checkboxes from existing task
      document.querySelectorAll('input[name="cascade"]').forEach(cb => {
        cb.checked = Array.isArray(taskData.cascadesTo) && taskData.cascadesTo.includes(cb.value);
      });
    } else {
      document.getElementById("edit-task-id").value = "";
      const form = document.getElementById("task-form");
      if (form) form.reset();
      const summary = document.getElementById("time-summary");
      if (summary) summary.textContent = "No time set";
      // never auto-check cascade boxes for a new task
      document.querySelectorAll('input[name="cascade"]').forEach(cb => { cb.checked = false; });
    }

    // ensure cascade options enabled/disabled correctly for selected horizon
    this.updateCascadeOptions?.();

    // show the modal
    if (typeof this.openModal === 'function') this.openModal("task-modal");
  };

  // 3) Fix saveTask order spread typo and keep original behavior
  P.saveTask = function () {
    const form = document.getElementById("task-form");
    if (!form || !form.checkValidity()) { form?.reportValidity?.(); return; }

    const isEdit = !!document.getElementById("edit-task-id").value;
    const taskId = isEdit ? document.getElementById("edit-task-id").value : this.generateId();
    const task = {
      id: taskId,
      title: document.getElementById("task-title").value.trim(),
      description: document.getElementById("task-description").value.trim(),
      horizon: document.getElementById("task-horizon").value,
      priority: document.getElementById("task-priority").value,
      completed: false,
      createdAt: isEdit ? (this.data.tasks.find(t => t.id === taskId)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
      lastModified: new Date().toISOString(),
      cascadesTo: this.getCascadeSelections?.() || [],
      timeSettings: this.currentTaskTimeData?.timeSettings || null
    };

    if (isEdit) {
      const idx = this.data.tasks.findIndex(t => t.id === taskId);
      if (idx !== -1) this.data.tasks[idx] = task;
    } else {
      this.data.tasks.push(task);
    }

    // Hours order persistence (per date)
    if (task.horizon === "hours" && task.timeSettings?.date) {
      const dk = task.timeSettings.date;
      const order = this.getHoursOrder?.(dk) || [];
      if (!order.includes(task.id)) this.setHoursOrder?.(dk, [...order, task.id]); // fixed spread
    }

    this.saveData?.();
    this.closeModal?.("task-modal");
    this.renderCurrentView?.();
    this.showNotification?.(`Task ${isEdit ? "updated" : "added"} successfully`, "success");
  };

  console.log('app-hotfix.js applied ✅');
})();
