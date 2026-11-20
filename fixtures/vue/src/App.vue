<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import TaskRow from './TaskRow.vue';
import type { Task } from './types';

const filters = { all: 'All', active: 'Active', done: 'Done' };
type Filter = keyof typeof filters;

const stored = localStorage.getItem('tasks');
const tasks = ref<Task[]>(
  stored
    ? JSON.parse(stored)
    : [
        { id: 1, title: 'Buy milk', done: false },
        { id: 2, title: 'Write report', done: true },
      ],
);
const title = ref('');
const filter = ref<Filter>('all');
const detailsOpen = ref(false);
const loading = ref(false);
const suggestions = ref<string[]>([]);
const toast = ref('');
const input = useTemplateRef<HTMLInputElement>('new-task');
let toastTimer: number | undefined;

const visible = computed(() =>
  tasks.value.filter((task) => filter.value === 'all' || task.done === (filter.value === 'done')),
);
const left = computed(() => tasks.value.filter((task) => !task.done).length);

function save() {
  localStorage.setItem('tasks', JSON.stringify(tasks.value));
}

function add() {
  const trimmed = title.value.trim();
  if (!trimmed) return;
  const id = Math.max(0, ...tasks.value.map((task) => task.id)) + 1;
  tasks.value.push({ id, title: trimmed, done: false });
  save();
  window.__aa?.emit('taskAdded', { id, title: trimmed });
  title.value = '';
  input.value?.focus();
  fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: trimmed }),
  });
  toast.value = 'Task added';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = '';
  }, 2000);
}

function toggle(task: Task) {
  task.done = !task.done;
  save();
  window.__aa?.emit('taskToggled', { id: task.id, done: task.done });
}

function remove(task: Task) {
  tasks.value = tasks.value.filter((other) => other.id !== task.id);
  save();
  window.__aa?.emit('taskDeleted', { id: task.id });
  input.value?.focus();
}

function setFilter(value: Filter) {
  filter.value = value;
  window.__aa?.emit('filterChanged', { filter: value });
}

async function load() {
  loading.value = true;
  const response = await fetch('/api/suggestions');
  suggestions.value = await response.json();
  loading.value = false;
}
</script>

<template>
  <main class="app">
    <h1>Tasks</h1>
    <form class="add" aria-label="Add task" @submit.prevent="add">
      <label for="new-task">New task</label>
      <input id="new-task" ref="new-task" v-model="title" name="title" type="text" required>
      <button type="submit" class="btn btn-primary">Add</button>
    </form>
    <div class="filters" role="tablist" aria-label="Filter">
      <button
        v-for="(label, value) in filters"
        :key="value"
        type="button"
        role="tab"
        :aria-selected="filter === value"
        class="tab"
        :class="{ 'is-active': filter === value }"
        @click="setFilter(value)"
      >{{ label }}</button>
    </div>
    <ul class="tasks" aria-label="Tasks">
      <TaskRow
        v-for="task in visible"
        :key="task.id"
        :task="task"
        @toggle="toggle(task)"
        @delete="remove(task)"
      />
    </ul>
    <p class="count" aria-live="polite">{{ left }} {{ left === 1 ? 'task' : 'tasks' }} left</p>
    <button
      type="button"
      class="btn details-toggle"
      :aria-expanded="detailsOpen"
      aria-controls="details"
      @click="detailsOpen = !detailsOpen"
    >Details</button>
    <section id="details" class="details" :hidden="!detailsOpen">
      <p>Tasks are stored in this browser.</p>
    </section>
    <button
      type="button"
      class="btn load"
      :disabled="loading"
      :aria-busy="loading || undefined"
      @click="load"
    >Load suggestions</button>
    <ul class="suggestions" aria-label="Suggestions">
      <li v-for="suggestion in suggestions" :key="suggestion">{{ suggestion }}</li>
    </ul>
    <div class="toast" role="status">{{ toast }}</div>
  </main>
</template>
