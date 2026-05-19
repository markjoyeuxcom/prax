/* ═══════════════════════════════════════════════════════════
   TASK BOARD — script.js
   Vanilla JS Kanban board with drag-and-drop & localStorage
═══════════════════════════════════════════════════════════ */

// ── Column definitions ──────────────────────────────────────────
const COLUMNS = [
    { id: 'high-priority', label: 'High Priority',     emoji: '🔴', color: '#f87171' },
    { id: 'in-progress',   label: 'In Progress',       emoji: '🟠', color: '#fb923c' },
    { id: 'planned',       label: 'Planned',           emoji: '🟡', color: '#facc15' },
    { id: 'completed',     label: 'Completed',         emoji: '🟢', color: '#4ade80' },
    { id: 'notes',         label: 'Notes / Reminders', emoji: '⚪', color: '#94a3b8' },
];

const TABS = [
    { id: 'personal', label: 'Personal' },
    { id: 'work',     label: 'Work' },
];

// Priority sort order (low number = higher priority = rendered first)
const PRIORITY_ORDER  = { high: 0, medium: 1, low: 2 };
const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

// ── State ───────────────────────────────────────────────────────
let tasks        = [];          // array of task objects
let editingId    = null;        // task ID currently being edited (null = new)
let draggedId    = null;        // task ID being dragged
let searchQuery  = '';          // live search string
let activeTab    = 'personal';  // active tab filter

// ── LocalStorage helpers ────────────────────────────────────────
function saveTasks() {
    localStorage.setItem('moomora_tasks', JSON.stringify(tasks));
}

function loadTasks() {
    try {
        tasks = JSON.parse(localStorage.getItem('moomora_tasks')) || [];
    } catch {
        tasks = [];
    }
    tasks = tasks.map(t => t.tab ? t : { ...t, tab: 'personal' });
}

// ── Utility ─────────────────────────────────────────────────────

// Generate a unique ID
function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Escape HTML to prevent XSS when rendering user content
function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Format a YYYY-MM-DD string to DD/MM/YYYY
function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
}

// Today's date as YYYY-MM-DD
function today() {
    return new Date().toISOString().split('T')[0];
}

// Is a task overdue? (has a past due date and isn't completed)
function isOverdue(task) {
    return task.dueDate && task.column !== 'completed' && task.dueDate < today();
}

// ── Task queries ────────────────────────────────────────────────

// Get all tasks for a column, sorted by priority
function getByColumn(columnId) {
    return tasks
        .filter(t => t.column === columnId && t.tab === activeTab)
        .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

// Get tasks filtered by the current search query
function getVisible(columnId) {
    const colTasks = getByColumn(columnId);
    if (!searchQuery) return colTasks;
    const q = searchQuery.toLowerCase();
    return colTasks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description && t.description.toLowerCase().includes(q))
    );
}

// ── CRUD ─────────────────────────────────────────────────────────

function addTask(data) {
    tasks.push({ id: uid(), ...data });
    saveTasks();
    renderBoard();
}

function editTask(id, data) {
    const i = tasks.findIndex(t => t.id === id);
    if (i !== -1) { tasks[i] = { ...tasks[i], ...data }; }
    saveTasks();
    renderBoard();
}

function removeTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    saveTasks();
    renderBoard();
}

function moveTask(id, newColumn) {
    editTask(id, { column: newColumn });
}

// ── Board rendering ──────────────────────────────────────────────

function renderBoard() {
    const board = document.getElementById('board');
    board.innerHTML = '';
    COLUMNS.forEach(col => board.appendChild(buildColumn(col)));
    setupDragDrop();
}

function renderTabs() {
    const container = document.getElementById('tabs');
    container.innerHTML = TABS.map(tab =>
        `<button class="tab-btn ${activeTab === tab.id ? 'active' : ''}" data-tab="${tab.id}">${tab.label}</button>`
    ).join('');
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeTab = btn.dataset.tab;
            searchQuery = '';
            document.getElementById('searchInput').value = '';
            renderTabs();
            renderBoard();
        });
    });
}

// Build a full column element
function buildColumn(col) {
    const allTasks     = getByColumn(col.id);
    const visibleTasks = getVisible(col.id);

    const el = document.createElement('div');
    el.className = 'column';
    el.dataset.columnId = col.id;

    el.innerHTML = `
        <div class="column-header" style="border-top-color:${col.color}">
            <div class="column-title">
                <span>${col.emoji}</span>
                <span>${col.label}</span>
                <span class="task-count">${allTasks.length}</span>
            </div>
            <button class="add-col-btn" title="Add task to this column">+</button>
        </div>
        <div class="task-list" data-column="${col.id}">
            ${visibleTasks.length === 0
                ? `<div class="empty-col">${searchQuery ? 'No matching tasks' : 'No tasks yet'}</div>`
                : visibleTasks.map(buildTaskHTML).join('')
            }
        </div>
    `;

    // + button in header → open modal pre-set to this column
    el.querySelector('.add-col-btn').addEventListener('click', () => openModal(null, col.id));

    // Clicking a card body → edit; clicking × → delete
    el.querySelectorAll('.task-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.delete-btn')) return; // handled below
            openModal(card.dataset.taskId);
        });
        card.querySelector('.delete-btn').addEventListener('click', e => {
            e.stopPropagation();
            if (confirm('Delete this task?')) removeTask(card.dataset.taskId);
        });
    });

    return el;
}

// Build the HTML string for a single task card
function buildTaskHTML(task) {
    const overdue   = isOverdue(task);
    const duePart   = task.dueDate
        ? `<span class="due-date ${overdue ? 'overdue' : ''}">
               ${overdue ? '⚠️ Overdue — ' : '📅 '}${fmtDate(task.dueDate)}
           </span>`
        : '';
    const descPart  = task.description
        ? `<div class="task-desc">${esc(task.description)}</div>`
        : '';

    return `
        <div class="task-card ${overdue ? 'overdue-card' : ''}"
             data-task-id="${task.id}"
             draggable="true">
            <div class="task-header">
                <span class="priority-badge priority-${task.priority}">
                    ${PRIORITY_LABELS[task.priority]}
                </span>
                <button class="delete-btn" title="Delete task">×</button>
            </div>
            <div class="task-title">${esc(task.title)}</div>
            ${descPart}
            ${duePart}
        </div>
    `;
}

// ── Drag & Drop ──────────────────────────────────────────────────

function setupDragDrop() {
    // ── Draggable cards ──
    document.querySelectorAll('.task-card').forEach(card => {

        card.addEventListener('dragstart', e => {
            draggedId = card.dataset.taskId;
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dragend', () => {
            draggedId = null;
            card.classList.remove('dragging');
            // Clear all drag-over highlights
            document.querySelectorAll('.task-list.drag-over')
                    .forEach(l => l.classList.remove('drag-over'));
        });
    });

    // ── Drop zones (each column's task list) ──
    document.querySelectorAll('.task-list').forEach(list => {

        list.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            list.classList.add('drag-over');
        });

        list.addEventListener('dragleave', e => {
            // Only remove highlight when leaving the list entirely (not entering a child)
            if (!list.contains(e.relatedTarget)) {
                list.classList.remove('drag-over');
            }
        });

        list.addEventListener('drop', e => {
            e.preventDefault();
            list.classList.remove('drag-over');
            if (draggedId && list.dataset.column) {
                moveTask(draggedId, list.dataset.column);
            }
        });
    });
}

// ── Task Modal ───────────────────────────────────────────────────

// Open the modal. taskId=null → add mode; taskId set → edit mode.
// defaultColumn is used when adding from a specific column's + button.
function openModal(taskId = null, defaultColumn = 'planned') {
    editingId = taskId;
    const task = taskId ? tasks.find(t => t.id === taskId) : null;

    document.getElementById('modalTitle').textContent  = task ? 'Edit Task' : 'Add Task';
    document.getElementById('deleteTaskBtn').classList.toggle('hidden', !task);

    // Pre-fill fields
    document.getElementById('taskTitle').value    = task?.title       || '';
    document.getElementById('taskDesc').value     = task?.description || '';
    document.getElementById('taskPriority').value = task?.priority    || 'medium';
    document.getElementById('taskDueDate').value  = task?.dueDate     || '';
    document.getElementById('taskColumn').value   = task?.column      || defaultColumn;
    document.getElementById('taskTab').value      = task?.tab         || activeTab;

    document.getElementById('taskModal').classList.remove('hidden');
    document.getElementById('taskTitle').focus();
}

function closeModal() {
    document.getElementById('taskModal').classList.add('hidden');
    editingId = null;
}

// Called on form submit — save new or updated task
function saveTask() {
    const title = document.getElementById('taskTitle').value.trim();
    if (!title) { document.getElementById('taskTitle').focus(); return; }

    const data = {
        title,
        description: document.getElementById('taskDesc').value.trim(),
        priority:    document.getElementById('taskPriority').value,
        dueDate:     document.getElementById('taskDueDate').value || null,
        column:      document.getElementById('taskColumn').value,
        tab:         document.getElementById('taskTab').value,
    };

    if (editingId) {
        editTask(editingId, data);
    } else {
        addTask(data);
    }
    closeModal();
}

// ── Daily Summary ────────────────────────────────────────────────

// Build the summary text string
function buildSummary() {
    const dateLabel = new Date().toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    const tabLabel = TABS.find(t => t.id === activeTab)?.label || activeTab;

    let text = `Daily Summary (${tabLabel}) — ${dateLabel}\n`;
    text += '─'.repeat(44) + '\n\n';

    let hasContent = false;

    COLUMNS.forEach(col => {
        const colTasks = getByColumn(col.id);
        if (colTasks.length === 0) return;
        hasContent = true;

        text += `${col.emoji}  ${col.label}\n`;
        colTasks.forEach(t => {
            const due      = t.dueDate ? ` (due ${fmtDate(t.dueDate)})` : '';
            const priority = `[${PRIORITY_LABELS[t.priority]}]`;
            const overdueFlag = isOverdue(t) ? ' ⚠️ OVERDUE' : '';
            text += `  •  ${t.title}  ${priority}${due}${overdueFlag}\n`;
            if (t.description) text += `     ${t.description}\n`;
        });
        text += '\n';
    });

    if (!hasContent) text += '  No tasks yet.\n\n';
    text += '─'.repeat(44);
    return text;
}

function openSummary() {
    document.getElementById('summaryText').textContent = buildSummary();
    document.getElementById('summaryModal').classList.remove('hidden');
}

function closeSummary() {
    document.getElementById('summaryModal').classList.add('hidden');
}

function copySummary() {
    navigator.clipboard.writeText(document.getElementById('summaryText').textContent)
        .then(() => {
            const btn = document.getElementById('copySummaryBtn');
            btn.textContent = '✅ Copied!';
            setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
        });
}

function exportSummary() {
    const text = document.getElementById('summaryText').textContent;
    const blob = new Blob([text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `daily-summary-${today()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

// Auto-show the summary once per day on first load (only if tasks exist)
function checkDailySummary() {
    const lastShown = localStorage.getItem('moomora_last_summary');
    const tabHasTasks = COLUMNS.some(col => getByColumn(col.id).length > 0);
    if (lastShown !== today() && tabHasTasks) {
        localStorage.setItem('moomora_last_summary', today());
        setTimeout(openSummary, 600); // short delay so board renders first
    }
}

// ── Search ────────────────────────────────────────────────────────

function handleSearch(e) {
    searchQuery = e.target.value.trim();
    renderBoard();
}

// ── Event listeners ───────────────────────────────────────────────

function setupListeners() {
    // Header: add task
    document.getElementById('addTaskBtn').addEventListener('click', () => openModal());

    // Header: daily summary
    document.getElementById('summaryBtn').addEventListener('click', openSummary);

    // Task form submit
    document.getElementById('taskForm').addEventListener('submit', e => {
        e.preventDefault();
        saveTask();
    });

    // Modal: cancel
    document.getElementById('cancelBtn').addEventListener('click', closeModal);

    // Modal: delete task
    document.getElementById('deleteTaskBtn').addEventListener('click', () => {
        if (confirm('Delete this task?')) {
            removeTask(editingId);
            closeModal();
        }
    });

    // Summary modal buttons
    document.getElementById('copySummaryBtn').addEventListener('click', copySummary);
    document.getElementById('exportSummaryBtn').addEventListener('click', exportSummary);
    document.getElementById('closeSummaryBtn').addEventListener('click', closeSummary);

    // Close any modal by clicking the backdrop
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', e => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                editingId = null;
            }
        });
    });

    // Keyboard: Escape closes open modals
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            editingId = null;
        }
    });

    // Search bar
    document.getElementById('searchInput').addEventListener('input', handleSearch);
}

// ── Initialise ────────────────────────────────────────────────────

function init() {
    loadTasks();
    renderTabs();
    renderBoard();
    setupListeners();
    checkDailySummary();
}

init();
